import { Hono } from "hono";
import { createDb, type Db, type DbStatement } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { newId } from "../lib/id";
import { buildClientDashboardRow, buildDocumentWorkflowActions, buildUncategorizedReceiptActions, sortActions, type DashboardBankTxn, type DashboardReceipt, type DashboardClientMeta } from "../services/dashboard";
import type { AnyDisposition } from "../services/pnl";
import { isValidReadinessState, isProfessionalApprovalState, suggestReadinessState, type TaxReadinessState } from "../services/tax-readiness";
import { runTaxDiagnostics } from "../services/tax-diagnostics";
import { generateChecklist, priorYearChecklistCarryover, isValidChecklistStatus, suggestDocumentType, sha256Hex, isValidDocumentType, isSupportedUpload, MAX_UPLOAD_BYTES, isValidTaxYear } from "../services/documents";
import { getUncategorizedReceiptLines, summarizeUncategorizedReceiptLines, assemblePnlReport, isAccrualUnsupported } from "../services/reporting";
import { canReadSignedRecords, SIGNED_RECORD_DOCUMENT_SQL, signedRecordDocumentSql } from "../services/firm-roles";

export const workspaceRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

async function authorizedClient(c: { env: Env; get(key: "userId" | "userName"): string; req: { param(name: string): string } }) {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  return { db, firm, client };
}

async function insertAudit(db: Db, clientId: string, actorUserId: string, action: string, before: unknown, after: unknown) {
  await db.query(
    `INSERT INTO audit_events (id, client_id, actor_user_id, action, before_json, after_json) VALUES ($1, $2, $3, $4, $5, $6)`,
    [newId("aud"), clientId, actorUserId, action, before ?? null, after ?? null],
  );
}

/**
 * Resolved mirrors the canonical bank-workflow definition (see bank.ts's
 * summary counts): matched OR no_receipt_required both represent a
 * professionally closed-out transaction. Pure/exported so the definition
 * can be unit-tested directly instead of only through the full route.
 */
export function countResolvedBankTxns(bankTxns: Array<{ triage: string | null }>): number {
  return bankTxns.filter((t) => t.triage === "matched" || t.triage === "no_receipt_required").length;
}

/**
 * Canonical single-client readiness/completeness, shared by the client
 * overview and tax readiness so neither can invent a second, narrower
 * approximation (e.g. bank-only triage) of the same P&L completeness
 * signals used everywhere else.
 */
export async function computeCanonicalReadiness(
  db: Db,
  client: { id: string; name: string; legal_name: string | null; updated_at: string },
  currency: string,
  taxYear: number | null,
  accountingBasis: string | null,
  startDate: string | null,
  endDate: string | null,
) {
  const bankRows = await db.query<{
    id: string; txn_date: string | null; description: string | null; amount: number;
    disposition: string; triage: string; category_id: string | null; currency: string;
  }>(
    `SELECT id, txn_date, description, amount, disposition, triage, category_id, currency FROM bank_transactions
     WHERE client_id = $1 AND ($2::date IS NULL OR txn_date >= $2::date) AND ($3::date IS NULL OR txn_date <= $3::date)`,
    [client.id, startDate, endDate],
  );

  const receiptRows = await db.query<{
    id: string; status: string; extracted_merchant: string | null; extracted_date: string | null;
    extracted_currency: string | null; category_id: string | null;
  }>(
    `SELECT r.id, r.status, r.extracted_merchant, r.extracted_date, r.extracted_currency, r.category_id FROM receipts r
     WHERE r.client_id = $1 AND ($2::date IS NULL OR r.extracted_date >= $2::date) AND ($3::date IS NULL OR r.extracted_date <= $3::date)`,
    [client.id, startDate, endDate],
  );

  const matchedDispositionRows = await db.query<{ matched_receipt_id: string; disposition: string }>(
    `SELECT matched_receipt_id, disposition FROM bank_transactions WHERE client_id = $1 AND matched_receipt_id IS NOT NULL`,
    [client.id],
  );
  const dispositionByReceipt = new Map(matchedDispositionRows.map((r) => [r.matched_receipt_id, r.disposition]));

  const meta: DashboardClientMeta = {
    id: client.id, name: client.name, legalName: client.legal_name, taxYear, accountingBasis,
    currency, updatedAt: client.updated_at,
  };
  const bankTxns: DashboardBankTxn[] = bankRows.map((r) => ({
    id: r.id, clientId: client.id, date: r.txn_date ? String(r.txn_date) : null, description: r.description,
    amount: Number(r.amount ?? 0), disposition: r.disposition as AnyDisposition, triage: r.triage || "unmatched",
    categoryId: r.category_id, currency: (r.currency || "USD").toUpperCase(),
  }));
  const receipts: DashboardReceipt[] = receiptRows.map((r) => ({
    id: r.id, clientId: client.id, status: r.status, merchant: r.extracted_merchant,
    date: r.extracted_date ? String(r.extracted_date) : null, currency: (r.extracted_currency || currency).toUpperCase(),
    categoryId: r.category_id, matchedBankDisposition: (dispositionByReceipt.get(r.id) as AnyDisposition | undefined) ?? null,
  }));

  const lineRows = await getUncategorizedReceiptLines(db, [{ clientId: client.id, startDate, endDate }]);
  const { countByClient, receiptsByClient } = summarizeUncategorizedReceiptLines(lineRows);
  const { row, actions } = buildClientDashboardRow(meta, bankTxns, receipts, countByClient.get(client.id) ?? 0);
  const uncategorizedReceiptActions = buildUncategorizedReceiptActions(client.id, client.name, receiptsByClient.get(client.id) ?? []);
  return { row, actions: [...actions, ...uncategorizedReceiptActions], bankTxns, receipts };
}

/** Tax year -> [Jan 1, Dec 31] date bounds, the one place this conversion happens. */
export function taxYearRange(taxYear: number | null): { startDate: string | null; endDate: string | null } {
  if (taxYear === null) return { startDate: null, endDate: null };
  return { startDate: `${taxYear}-01-01`, endDate: `${taxYear}-12-31` };
}

/** Latest meaningful client activity - never the raw clients.updated_at column. Null when nothing meaningful has happened yet. */
async function getLastMeaningfulActivity(db: Db, clientId: string): Promise<string | null> {
  const [row] = await db.query<{ created_at: string }>(
    `SELECT created_at FROM audit_events WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [clientId],
  );
  return row?.created_at ?? null;
}

/** Client HOME/overview: state of the client in one call, no N+1 across tabs. */
workspaceRoutes.get("/:clientId/overview", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);

  const [profileRow] = await db.query<{
    entity_type: string | null; industry: string | null; state: string | null; tax_year: number | null;
    accounting_basis: string | null; default_currency: string; profile: Record<string, unknown>;
  }>(`SELECT entity_type, industry, state, tax_year, accounting_basis, default_currency, profile FROM client_profiles WHERE client_id = $1`, [client.id]);

  const currency = (profileRow?.default_currency || "USD").toUpperCase();
  const taxYear = profileRow?.tax_year ?? null;
  const accountingBasis = profileRow?.accounting_basis ?? null;

  // Canonical period: the client's configured tax year when one exists,
  // all-time otherwise. This is the SAME rule the Operations Command
  // Center uses (buildFirmDashboard), so bookkeeping readiness, the action
  // queue, and document status here always reconcile with the firm-wide
  // dashboard for this client - never a second, narrower approximation.
  const canonicalPeriod = taxYearRange(taxYear);
  const canonical = await computeCanonicalReadiness(db, client, currency, taxYear, accountingBasis, canonicalPeriod.startDate, canonicalPeriod.endDate);

  const [readinessRow] = taxYear
    ? await db.query<{ status: string }>(`SELECT status FROM tax_year_readiness WHERE client_id = $1 AND tax_year = $2`, [client.id, taxYear])
    : [];

  // Selected period: whatever the professional's period selector requested
  // (defaulting to the same canonical period when nothing was specified).
  // Every figure in financialStatus/financialPeriod refers to this SAME
  // range - never a mix of period-scoped income with all-time counts.
  const queryStart = c.req.query("startDate") || null;
  const queryEnd = c.req.query("endDate") || null;
  const selectedStart = queryStart ?? canonicalPeriod.startDate;
  const selectedEnd = queryEnd ?? canonicalPeriod.endDate;
  const selectedIsCanonical = selectedStart === canonicalPeriod.startDate && selectedEnd === canonicalPeriod.endDate;
  const selected = selectedIsCanonical
    ? canonical
    : await computeCanonicalReadiness(db, client, currency, taxYear, accountingBasis, selectedStart, selectedEnd);

  const pnlReport = await assemblePnlReport(db, client.id, selectedStart, selectedEnd);
  const financialPeriod = isAccrualUnsupported(pnlReport)
    ? { unsupported: true as const, warning: pnlReport.warning, periodStart: selectedStart, periodEnd: selectedEnd }
    : {
        unsupported: false as const,
        periodStart: pnlReport.periodStart,
        periodEnd: pnlReport.periodEnd,
        income: pnlReport.income,
        expenses: pnlReport.expenses,
        net: pnlReport.net,
      };
  const resolvedCount = countResolvedBankTxns(selected.bankTxns);

  const { row, actions, bankTxns, receipts } = canonical;
  const lastActivityAt = await getLastMeaningfulActivity(db, client.id);

  const checklistRows = await db.query<{ id: string; tax_year: number; doc_type: string; custom_label: string | null; status: string }>(
    `SELECT id, tax_year, doc_type, custom_label, status FROM document_checklist_items WHERE client_id = $1`,
    [client.id],
  );
  const documentRows = await db.query<{ id: string; filename: string; document_type: string; status: string }>(
    `SELECT id, filename, document_type, status FROM client_documents WHERE client_id = $1`,
    [client.id],
  );

  const documentActions = buildDocumentWorkflowActions(
    client.id, client.name,
    checklistRows.map((r) => ({ id: r.id, clientId: client.id, taxYear: r.tax_year, docType: r.doc_type, customLabel: r.custom_label, status: r.status })),
    documentRows.map((r) => ({ id: r.id, clientId: client.id, filename: r.filename, documentType: r.document_type, status: r.status })),
  );
  const nextActions = sortActions([...actions, ...documentActions]);

  const receiptsAwaitingReview = receipts.filter((r) => r.status === "uploaded" || r.status === "extracting" || r.status === "review").length;
  const filedReceipts = receipts.filter((r) => r.status === "filed").length;
  const documentsAwaitingReview = documentRows.filter((d) => d.status === "needs_review").length;
  const documentsExpected = checklistRows.filter((i) => i.status === "expected" || i.status === "requested").length;

  return c.json({
    header: {
      clientName: client.name, legalName: client.legal_name, entityType: profileRow?.entity_type ?? null,
      industry: profileRow?.industry ?? null, state: profileRow?.state ?? null, taxYear,
      accountingBasis: profileRow?.accounting_basis ?? null, reportingCurrency: currency,
      bookkeepingReadiness: row.readiness, taxReadiness: readinessRow?.status ?? null,
      openActionCount: nextActions.length, lastActivityAt,
    },
    financialStatus: {
      periodStart: selectedStart, periodEnd: selectedEnd,
      pnlCompleteness: selected.row.isComplete, bankTransactionCount: selected.bankTxns.length, resolvedCount,
      missingEvidenceCount: selected.row.missingEvidenceCount, unclassifiedCount: selected.row.unclassifiedCount,
      uncategorizedCount: selected.row.uncategorizedCount, currencyConflictCount: selected.row.currencyConflictCount,
    },
    financialPeriod,
    documentStatus: {
      receiptsReceived: receipts.length, receiptsAwaitingReview, filedReceipts,
      missingEvidence: row.missingEvidenceCount,
      taxDocumentsReceived: checklistRows.filter((i) => i.status === "received" || i.status === "reviewed").length,
      taxDocumentsRequested: documentsExpected, documentsAwaitingReview,
    },
    nextActions,
  });
});


/** Tax-year readiness: distinct from bookkeeping readiness, professional-controlled. */
workspaceRoutes.get("/:clientId/tax-readiness/:taxYear", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const taxYear = Number(c.req.param("taxYear"));
  if (!Number.isInteger(taxYear)) return c.json({ error: "taxYear must be an integer" }, 400);

  const [readiness] = await db.query<{ status: string; notes: string | null; updated_at: string }>(
    `SELECT status, notes, updated_at FROM tax_year_readiness WHERE client_id = $1 AND tax_year = $2`,
    [client.id, taxYear],
  );
  const checklist = await db.query<{ id: string; doc_type: string; custom_label: string | null; status: string; updated_at: string }>(
    `SELECT id, doc_type, custom_label, status, updated_at FROM document_checklist_items WHERE client_id = $1 AND tax_year = $2 ORDER BY created_at`,
    [client.id, taxYear],
  );

  const [profileRow] = await db.query<{ accounting_basis: string | null; default_currency: string; profile: Record<string, unknown> }>(
    `SELECT accounting_basis, default_currency, profile FROM client_profiles WHERE client_id = $1`,
    [client.id],
  );
  const taxPrepRequired = Boolean((profileRow?.profile ?? {}).taxPrepRequired);
  const totalChecklistItems = checklist.filter((i) => i.status !== "not_applicable").length;
  const receivedOrReviewed = checklist.filter((i) => i.status === "received" || i.status === "reviewed").length;

  const currency = (profileRow?.default_currency || "USD").toUpperCase();
  const { startDate, endDate } = taxYearRange(taxYear);
  const { row: readinessRow } = await computeCanonicalReadiness(db, client, currency, taxYear, profileRow?.accounting_basis ?? null, startDate, endDate);
  // "Bookkeeping complete" for tax-readiness purposes is the SAME bar as
  // Ready everywhere else - not just completeness.isComplete, which alone
  // misses receipt/bank disposition conflicts and receipts still awaiting
  // review, both of which item 1 requires this to account for.
  const bookkeepingComplete = readinessRow.readiness === "ready";

  const suggestedStatus = suggestReadinessState({
    taxPrepRequired,
    bookkeepingComplete,
    totalChecklistItems,
    receivedOrReviewedChecklistItems: receivedOrReviewed,
  });

  return c.json({
    taxYear,
    status: readiness?.status ?? "not_started",
    suggestedStatus,
    bookkeepingComplete,
    notes: readiness?.notes ?? null,
    checklist,
    updatedAt: readiness?.updated_at ?? null,
  });
});

/**
 * Professional control remains required, but Folio must never let the
 * status say something that is not deterministically true yet: ready for
 * preparation / preparation started / complete all require bookkeeping to
 * actually be complete and no tax diagnostic errors (M7 gate), and
 * ready_for_preparation additionally requires no required checklist item
 * still sitting at expected/requested.
 */
export async function checkReadinessTransitionAllowed(db: Db, client: { id: string; name: string; legal_name: string | null; updated_at: string }, taxYear: number, status: TaxReadinessState): Promise<{ ok: true } | { ok: false; reasons: string[] }> {
  if (!isProfessionalApprovalState(status)) return { ok: true };

  const [profileRow] = await db.query<{ accounting_basis: string | null; default_currency: string }>(
    `SELECT accounting_basis, default_currency FROM client_profiles WHERE client_id = $1`,
    [client.id],
  );
  const currency = (profileRow?.default_currency || "USD").toUpperCase();
  const { startDate, endDate } = taxYearRange(taxYear);
  const { row } = await computeCanonicalReadiness(db, client, currency, taxYear, profileRow?.accounting_basis ?? null, startDate, endDate);

  const diagnostics = await runTaxDiagnostics(db, client.id, taxYear);

  let outstandingChecklistItems = 0;
  if (status === "ready_for_preparation") {
    const [outstanding] = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM document_checklist_items WHERE client_id = $1 AND tax_year = $2 AND status IN ('expected', 'requested')`,
      [client.id, taxYear],
    );
    outstandingChecklistItems = parseInt(outstanding?.count ?? "0", 10);
  }

  const reasons = readinessBlockers(status, {
    bookkeepingReady: row.readiness === "ready",
    hasDiagnosticErrors: diagnostics.some((d) => d.severity === "error"),
    outstandingChecklistItems,
  });
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/**
 * The gate's decision, separated from data loading so the Tax Workbench can
 * show the exact same blockers from facts it has already loaded (it is close
 * to the Workers 50-subrequest cap and must not reload them).
 */
export function readinessBlockers(
  status: TaxReadinessState,
  facts: { bookkeepingReady: boolean; hasDiagnosticErrors: boolean; outstandingChecklistItems: number },
): string[] {
  if (!isProfessionalApprovalState(status)) return [];
  const reasons: string[] = [];
  if (!facts.bookkeepingReady) reasons.push("bookkeeping_incomplete");
  if (facts.hasDiagnosticErrors) reasons.push("tax_diagnostics_errors");
  if (status === "ready_for_preparation" && facts.outstandingChecklistItems > 0) reasons.push("checklist_items_outstanding");
  return reasons;
}

workspaceRoutes.put("/:clientId/tax-readiness/:taxYear", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const taxYear = Number(c.req.param("taxYear"));
  if (!Number.isInteger(taxYear)) return c.json({ error: "taxYear must be an integer" }, 400);
  const body = (await c.req.json()) as { status?: string; notes?: string | null };
  if (!body.status || !isValidReadinessState(body.status)) {
    return c.json({ error: "status must be a valid tax readiness state" }, 400);
  }
  const status: TaxReadinessState = body.status;

  const transitionCheck = await checkReadinessTransitionAllowed(db, client, taxYear, status);
  if (!transitionCheck.ok) {
    return c.json({ error: "This status cannot be set yet.", code: "TAX_READINESS_BLOCKED", reasons: transitionCheck.reasons }, 409);
  }

  const [before] = await db.query<{ status: string; notes: string | null }>(
    `SELECT status, notes FROM tax_year_readiness WHERE client_id = $1 AND tax_year = $2`,
    [client.id, taxYear],
  );

  await db.query(
    `INSERT INTO tax_year_readiness (id, client_id, tax_year, status, notes, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (client_id, tax_year) DO UPDATE SET status = $4, notes = $5, updated_at = NOW()`,
    [newId("txr"), client.id, taxYear, status, body.notes ?? null],
  );
  await insertAudit(db, client.id, c.get("userId"), "tax_readiness_changed", before ?? null, { status, notes: body.notes ?? null });
  return c.json({ ok: true, status });
});

/** Deterministic checklist generation from known client context - not one universal list. */
workspaceRoutes.post("/:clientId/tax-readiness/:taxYear/checklist/generate", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const taxYear = Number(c.req.param("taxYear"));
  if (!Number.isInteger(taxYear)) return c.json({ error: "taxYear must be an integer" }, 400);

  const [profileRow] = await db.query<{ entity_type: string | null; profile: Record<string, unknown> }>(
    `SELECT entity_type, profile FROM client_profiles WHERE client_id = $1`,
    [client.id],
  );
  const professional = (profileRow?.profile ?? {}) as { taxPrepRequired?: boolean; priorYearReturnAvailable?: boolean };
  const [bankActivityRow] = await db.query<{ has_activity: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM bank_transactions WHERE client_id = $1) AS has_activity`,
    [client.id],
  );

  const generated = generateChecklist({
    entityType: profileRow?.entity_type ?? null,
    taxPrepRequired: Boolean(professional.taxPrepRequired),
    hasBankActivity: Boolean(bankActivityRow?.has_activity),
    priorYearReturnAvailable: typeof professional.priorYearReturnAvailable === "boolean" ? professional.priorYearReturnAvailable : null,
  });

  const existing = await db.query<{ doc_type: string }>(
    `SELECT doc_type FROM document_checklist_items WHERE client_id = $1 AND tax_year = $2`,
    [client.id, taxYear],
  );
  const existingTypes = new Set(existing.map((r) => r.doc_type));
  const toInsert = generated.filter((item) => !existingTypes.has(item.docType));

  for (const item of toInsert) {
    await db.query(
      `INSERT INTO document_checklist_items (id, client_id, tax_year, doc_type, custom_label, status) VALUES ($1, $2, $3, $4, $5, 'expected')`,
      [newId("chk"), client.id, taxYear, item.docType, item.customLabel],
    );
  }
  if (toInsert.length > 0) {
    await insertAudit(db, client.id, c.get("userId"), "checklist_generated", { existingCount: existing.length }, { addedCount: toInsert.length, taxYear });
  }
  return c.json({ added: toInsert.length, skippedExisting: generated.length - toInsert.length });
});

/** Organizer prefill: expect this year every document the client had on last year's checklist. */
workspaceRoutes.post("/:clientId/tax-readiness/:taxYear/checklist/prefill-prior-year", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const taxYear = Number(c.req.param("taxYear"));
  if (!Number.isInteger(taxYear)) return c.json({ error: "taxYear must be an integer" }, 400);

  const rowsFor = (year: number) => db.query<{ doc_type: string; custom_label: string | null; status: string }>(
    `SELECT doc_type, custom_label, status FROM document_checklist_items WHERE client_id = $1 AND tax_year = $2 ORDER BY created_at`,
    [client.id, year],
  );
  const toInsert = priorYearChecklistCarryover(await rowsFor(taxYear - 1), await rowsFor(taxYear));
  if (toInsert.length > 0) {
    // One statement, not one per item: each query is a subrequest and the free plan caps them at 50.
    const params: unknown[] = [client.id, taxYear];
    const values = toInsert.map((item) => {
      params.push(newId("chk"), item.docType, item.customLabel);
      const n = params.length;
      return `($${n - 2}, $1, $2, $${n - 1}, $${n}, 'expected')`;
    });
    await db.query(
      `INSERT INTO document_checklist_items (id, client_id, tax_year, doc_type, custom_label, status) VALUES ${values.join(", ")}`,
      params,
    );
    await insertAudit(db, client.id, c.get("userId"), "checklist_prefilled_from_prior_year", null, { addedCount: toInsert.length, taxYear, fromTaxYear: taxYear - 1 });
  }
  return c.json({ added: toInsert.length });
});

workspaceRoutes.post("/:clientId/checklist", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const body = (await c.req.json()) as { taxYear?: number; docType?: string; customLabel?: string | null };
  if (!body.taxYear || !Number.isInteger(body.taxYear)) return c.json({ error: "taxYear is required" }, 400);
  const docType = body.docType && body.docType.trim() ? body.docType.trim() : "other";
  if (docType === "other" && !body.customLabel) return c.json({ error: "customLabel is required for a custom checklist item" }, 400);

  const id = newId("chk");
  await db.query(
    `INSERT INTO document_checklist_items (id, client_id, tax_year, doc_type, custom_label, status) VALUES ($1, $2, $3, $4, $5, 'expected')`,
    [id, client.id, body.taxYear, docType, body.customLabel ?? null],
  );
  await insertAudit(db, client.id, c.get("userId"), "checklist_item_added", null, { id, docType, customLabel: body.customLabel ?? null, taxYear: body.taxYear });
  return c.json({ id });
});

workspaceRoutes.patch("/:clientId/checklist/:itemId", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const body = (await c.req.json()) as { status?: string };
  if (!body.status || !isValidChecklistStatus(body.status)) return c.json({ error: "status must be a valid checklist state" }, 400);

  const [before] = await db.query<{ status: string }>(
    `SELECT status FROM document_checklist_items WHERE id = $1 AND client_id = $2`,
    [c.req.param("itemId"), client.id],
  );
  if (!before) return c.json({ error: "Not found" }, 404);

  await db.query(
    `UPDATE document_checklist_items SET status = $1, updated_at = NOW() WHERE id = $2 AND client_id = $3`,
    [body.status, c.req.param("itemId"), client.id],
  );
  await insertAudit(db, client.id, c.get("userId"), "checklist_item_status_changed", before, { status: body.status });
  return c.json({ ok: true });
});

/** General document intake beyond receipts. Original files stay private in R2. */
workspaceRoutes.get("/:clientId/documents", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const status = c.req.query("status") || null;
  const hideSigned = !canReadSignedRecords(c.get("firmRole") ?? "read_only");
  const documents = await db.query(
    `SELECT id, filename, content_type, size_bytes, document_type, tax_year, document_date, source_label, checklist_item_id, status, duplicate_of_document_id, uploaded_at, reviewed_at
     FROM client_documents WHERE client_id = $1 AND ($2::text IS NULL OR status = $2)
       AND ($3::boolean = false OR NOT ${SIGNED_RECORD_DOCUMENT_SQL}) ORDER BY uploaded_at DESC LIMIT 200`,
    [client.id, status, hideSigned],
  );
  return c.json({ documents });
});

workspaceRoutes.post("/:clientId/documents", async (c) => {
  const { db, client, firm } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);

  const form = await c.req.formData();
  const entry = form.get("file");
  if (!entry || typeof entry === "string") return c.json({ error: "file is required" }, 400);
  const file = entry as File;
  if (file.size <= 0) return c.json({ error: "file is empty" }, 400);
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: `File exceeds the ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB upload limit`, code: "FILE_TOO_LARGE" }, 413);
  }
  if (!isSupportedUpload(file.name, file.type || null)) {
    return c.json({ error: "Unsupported file type. Supported: PDF, PNG, JPG, JPEG, HEIC, DOCX, XLSX, CSV.", code: "UNSUPPORTED_FILE_TYPE" }, 415);
  }
  const taxYearValue = form.get("taxYear");
  let taxYear: number | null = null;
  if (typeof taxYearValue === "string" && taxYearValue.trim()) {
    const parsed = Number(taxYearValue);
    if (!isValidTaxYear(parsed)) return c.json({ error: "taxYear must be an integer between 2000 and 2100" }, 400);
    taxYear = parsed;
  }

  const bytes = await file.arrayBuffer();
  const hash = await sha256Hex(bytes);
  const [existingMatch] = await db.query<{ id: string }>(
    `SELECT id FROM client_documents WHERE client_id = $1 AND source_hash = $2 ORDER BY uploaded_at ASC LIMIT 1`,
    [client.id, hash],
  );

  const documentId = newId("doc");
  const key = `documents/${firm.id}/${client.id}/${documentId}/${file.name}`;
  await c.env.RECEIPTS.put(key, bytes, {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
    customMetadata: { filename: file.name, clientId: client.id },
  });

  const suggestedType = suggestDocumentType(file.name);
  await db.query(
    `INSERT INTO client_documents
      (id, client_id, filename, r2_key, content_type, size_bytes, document_type, tax_year, source_hash, duplicate_of_document_id, status, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'needs_review', $11)`,
    [documentId, client.id, file.name, key, file.type || null, file.size, suggestedType, taxYear, hash, existingMatch?.id ?? null, c.get("userId")],
  );
  await insertAudit(db, client.id, c.get("userId"), "document_uploaded", null, { documentId, filename: file.name, suggestedType, duplicateOf: existingMatch?.id ?? null });

  return c.json({ id: documentId, suggestedType, duplicateOf: existingMatch?.id ?? null });
});

workspaceRoutes.get("/:clientId/documents/:documentId/source", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const hideSigned = !canReadSignedRecords(c.get("firmRole") ?? "read_only");
  const [document] = await db.query<{ r2_key: string; content_type: string | null; filename: string }>(
    `SELECT r2_key, content_type, filename FROM client_documents WHERE id = $1 AND client_id = $2
       AND ($3::boolean = false OR NOT ${SIGNED_RECORD_DOCUMENT_SQL})`,
    [c.req.param("documentId"), client.id, hideSigned],
  );
  if (!document) return c.json({ error: "Not found" }, 404);
  const object = await c.env.RECEIPTS.get(document.r2_key);
  if (!object) return c.json({ error: "Source object missing" }, 404);
  const filename = document.filename.replace(/["\r\n]/g, "");
  const contentType = document.content_type || object.httpMetadata?.contentType || "application/octet-stream";
  const isSafeInline = contentType.startsWith("application/pdf") || contentType.startsWith("image/");
  return new Response(object.body, {
    headers: {
      "content-type": contentType,
      "content-disposition": isSafeInline ? `inline; filename="${filename}"` : `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "SAMEORIGIN",
    },
  });
});

export type DocumentReviewAction = {
  action: "confirm" | "correct" | "assign_client" | "assign_document_type" | "assign_tax_year" | "match_checklist" | "mark_duplicate" | "mark_not_needed";
  documentType?: string;
  taxYear?: number | null;
  checklistItemId?: string | null;
  targetClientId?: string;
  duplicateOfDocumentId?: string | null;
};

/**
 * confirm/mark_duplicate/mark_not_needed resolve the review queue's reason
 * for showing this document, so the item leaves the queue. Every other
 * action is a correction the professional makes ON an item that remains
 * under review - it must stay visible with refreshed data, never
 * disappear as a side effect of, say, fixing its tax year.
 */
export const TERMINAL_REVIEW_ACTIONS = new Set<DocumentReviewAction["action"]>(["confirm", "mark_duplicate", "mark_not_needed"]);

/**
 * Shared review-action handler used by both the client-scoped and
 * cross-client review endpoints. Every mutating branch verifies that any
 * checklist item, duplicate target, or destination client it touches
 * belongs to the same firm and (for checklist/duplicate relationships) the
 * document's own client - API checks here are the first line of defense,
 * backed by the database-level composite foreign keys added in migration
 * 0010. All writes for one professional decision, including the audit
 * event, land in a single db.transaction so a partial failure can never
 * leave the decision half-applied or its audit trail missing.
 */
export async function applyDocumentReviewAction(
  db: Db,
  firmId: string,
  documentId: string,
  actorUserId: string,
  body: DocumentReviewAction,
  hideSigned: boolean,
): Promise<{ ok: true; terminal: boolean } | { ok: false; status: number; error: string }> {
  // hideSigned: the caller's role cannot read signed records, so a signed
  // record is treated as not found (no metadata, no changes).
  const [document] = await db.query<{ id: string; client_id: string; status: string; document_type: string; tax_year: number | null; firm_id: string }>(
    `SELECT cd.id, cd.client_id, cd.status, cd.document_type, cd.tax_year, c.firm_id
     FROM client_documents cd JOIN clients c ON c.id = cd.client_id
     WHERE cd.id = $1 AND c.firm_id = $2 AND ($3::boolean = false OR NOT ${signedRecordDocumentSql("cd")})`,
    [documentId, firmId, hideSigned],
  );
  if (!document) return { ok: false, status: 404, error: "Not found" };

  const before = { status: document.status, documentType: document.document_type, taxYear: document.tax_year };
  let clientIdForAudit = document.client_id;
  const writes: DbStatement[] = [];

  async function checklistItemBelongsToClient(checklistItemId: string, clientId: string): Promise<boolean> {
    const [item] = await db.query<{ id: string }>(
      `SELECT id FROM document_checklist_items WHERE id = $1 AND client_id = $2`,
      [checklistItemId, clientId],
    );
    return Boolean(item);
  }

  switch (body.action) {
    case "confirm": {
      if (body.taxYear != null && !isValidTaxYear(body.taxYear)) return { ok: false, status: 400, error: "taxYear must be an integer between 2000 and 2100" };
      const documentType = body.documentType && isValidDocumentType(body.documentType) ? body.documentType : document.document_type;
      writes.push({
        query: `UPDATE client_documents SET status = 'confirmed', document_type = $1, tax_year = COALESCE($2, tax_year), reviewed_by = $3, reviewed_at = NOW() WHERE id = $4`,
        params: [documentType, body.taxYear ?? null, actorUserId, documentId],
      });
      break;
    }
    case "correct": {
      if (body.documentType && !isValidDocumentType(body.documentType)) return { ok: false, status: 400, error: "Invalid documentType" };
      if (body.taxYear != null && !isValidTaxYear(body.taxYear)) return { ok: false, status: 400, error: "taxYear must be an integer between 2000 and 2100" };
      if (body.checklistItemId && !(await checklistItemBelongsToClient(body.checklistItemId, document.client_id))) {
        return { ok: false, status: 404, error: "Checklist item not found for this client" };
      }
      writes.push({
        query: `UPDATE client_documents SET document_type = COALESCE($1, document_type), tax_year = COALESCE($2, tax_year), checklist_item_id = COALESCE($3, checklist_item_id) WHERE id = $4`,
        params: [body.documentType ?? null, body.taxYear ?? null, body.checklistItemId ?? null, documentId],
      });
      break;
    }
    case "assign_document_type": {
      if (!body.documentType || !isValidDocumentType(body.documentType)) return { ok: false, status: 400, error: "Invalid documentType" };
      writes.push({ query: `UPDATE client_documents SET document_type = $1 WHERE id = $2`, params: [body.documentType, documentId] });
      break;
    }
    case "assign_tax_year": {
      if (typeof body.taxYear !== "number" || !isValidTaxYear(body.taxYear)) {
        return { ok: false, status: 400, error: "taxYear must be an integer between 2000 and 2100" };
      }
      writes.push({ query: `UPDATE client_documents SET tax_year = $1 WHERE id = $2`, params: [body.taxYear, documentId] });
      break;
    }
    case "assign_client": {
      if (!body.targetClientId) return { ok: false, status: 400, error: "targetClientId is required" };
      const [target] = await db.query<{ id: string }>(`SELECT id FROM clients WHERE id = $1 AND firm_id = $2`, [body.targetClientId, firmId]);
      if (!target) return { ok: false, status: 404, error: "Target client not found in this firm" };
      // A checklist match or duplicate target is always specific to the client
      // it was set under, so both relationships are cleared on reassignment -
      // never left silently pointing at the old client's rows.
      writes.push({
        query: `UPDATE client_documents SET client_id = $1, checklist_item_id = NULL, duplicate_of_document_id = NULL WHERE id = $2`,
        params: [body.targetClientId, documentId],
      });
      clientIdForAudit = body.targetClientId;
      break;
    }
    case "match_checklist": {
      if (!body.checklistItemId) return { ok: false, status: 400, error: "checklistItemId is required" };
      if (!(await checklistItemBelongsToClient(body.checklistItemId, document.client_id))) {
        return { ok: false, status: 404, error: "Checklist item not found for this client" };
      }
      writes.push({ query: `UPDATE client_documents SET checklist_item_id = $1 WHERE id = $2`, params: [body.checklistItemId, documentId] });
      writes.push({ query: `UPDATE document_checklist_items SET status = 'received', updated_at = NOW() WHERE id = $1`, params: [body.checklistItemId] });
      break;
    }
    case "mark_duplicate": {
      if (body.duplicateOfDocumentId) {
        if (body.duplicateOfDocumentId === documentId) {
          return { ok: false, status: 400, error: "A document cannot be marked a duplicate of itself" };
        }
        const [target] = await db.query<{ id: string }>(
          `SELECT cd.id FROM client_documents cd JOIN clients c ON c.id = cd.client_id
           WHERE cd.id = $1 AND cd.client_id = $2 AND c.firm_id = $3`,
          [body.duplicateOfDocumentId, document.client_id, firmId],
        );
        if (!target) return { ok: false, status: 404, error: "Duplicate target not found for this client" };
      }
      writes.push({
        query: `UPDATE client_documents SET status = 'duplicate', duplicate_of_document_id = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3`,
        params: [body.duplicateOfDocumentId ?? null, actorUserId, documentId],
      });
      break;
    }
    case "mark_not_needed": {
      writes.push({ query: `UPDATE client_documents SET status = 'not_needed', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2`, params: [actorUserId, documentId] });
      break;
    }
    default:
      return { ok: false, status: 400, error: "Unknown action" };
  }

  writes.push({
    query: `INSERT INTO audit_events (id, client_id, actor_user_id, action, before_json, after_json) VALUES ($1, $2, $3, $4, $5, $6)`,
    params: [newId("aud"), clientIdForAudit, actorUserId, "document_reviewed", before ?? null, { action: body.action }],
  });

  await db.transaction(writes);
  return { ok: true, terminal: TERMINAL_REVIEW_ACTIONS.has(body.action) };
}

/**
 * Same shape the cross-client review list uses, so a nonterminal action's
 * response can refresh a document's visible row without a full reload -
 * one query, reused by both the list and the post-action refresh.
 */
export type ReviewDocumentRow = {
  id: string; clientId: string; clientName: string; filename: string; contentType: string | null;
  documentType: string; taxYear: number | null; status: string; duplicateWarning: boolean;
  duplicateOfDocumentId: string | null;
  checklistMatch: { id: string; docType: string | null; customLabel: string | null } | null;
  uploadedAt: string;
};

export async function loadReviewDocument(db: Db, documentId: string, firmId: string): Promise<ReviewDocumentRow | null> {
  const [d] = await db.query<{
    id: string; client_id: string; client_name: string; filename: string; content_type: string | null;
    document_type: string; tax_year: number | null; status: string; duplicate_of_document_id: string | null;
    checklist_item_id: string | null; checklist_doc_type: string | null; checklist_custom_label: string | null;
    uploaded_at: string;
  }>(
    `SELECT cd.id, cd.client_id, c.name AS client_name, cd.filename, cd.content_type, cd.document_type,
            cd.tax_year, cd.status, cd.duplicate_of_document_id, cd.checklist_item_id,
            dci.doc_type AS checklist_doc_type, dci.custom_label AS checklist_custom_label, cd.uploaded_at
     FROM client_documents cd
     JOIN clients c ON c.id = cd.client_id
     LEFT JOIN document_checklist_items dci ON dci.id = cd.checklist_item_id
     WHERE cd.id = $1 AND c.firm_id = $2`,
    [documentId, firmId],
  );
  if (!d) return null;
  return {
    id: d.id,
    clientId: d.client_id,
    clientName: d.client_name,
    filename: d.filename,
    contentType: d.content_type,
    documentType: d.document_type,
    taxYear: d.tax_year,
    status: d.status,
    duplicateWarning: d.duplicate_of_document_id !== null,
    duplicateOfDocumentId: d.duplicate_of_document_id,
    checklistMatch: d.checklist_item_id ? { id: d.checklist_item_id, docType: d.checklist_doc_type, customLabel: d.checklist_custom_label } : null,
    uploadedAt: d.uploaded_at,
  };
}

workspaceRoutes.patch("/:clientId/documents/:documentId", async (c) => {
  const { db, client, firm } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const body = (await c.req.json()) as DocumentReviewAction;
  const documentId = c.req.param("documentId");
  const result = await applyDocumentReviewAction(db, firm.id, documentId, c.get("userId"), body, !canReadSignedRecords(c.get("firmRole") ?? "read_only"));
  if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 404);
  const document = result.terminal ? null : await loadReviewDocument(db, documentId, firm.id);
  return c.json({ ok: true, terminal: result.terminal, document });
});

/** Human-readable client activity timeline - never raw audit JSON. */
workspaceRoutes.get("/:clientId/timeline", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const events = await db.query<{ id: string; action: string; actor_user_id: string | null; created_at: string }>(
    `SELECT id, action, actor_user_id, created_at FROM audit_events WHERE client_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [client.id],
  );
  return c.json({
    events: events.map((e) => ({
      id: e.id,
      action: e.action,
      summary: describeTimelineEvent(e.action),
      actorUserId: e.actor_user_id,
      createdAt: e.created_at,
    })),
  });
});

function describeTimelineEvent(action: string): string {
  const labels: Record<string, string> = {
    client_created: "Client added",
    client_profile_updated: "Client profile updated",
    document_uploaded: "Document uploaded",
    document_reviewed: "Document reviewed",
    checklist_generated: "Tax document checklist generated",
    checklist_item_added: "Custom checklist item added",
    checklist_item_status_changed: "Checklist item status changed",
    tax_readiness_changed: "Tax preparation readiness changed",
    bank_csv_imported: "Bank statement imported",
    bank_disposition_changed: "Bank transaction classified",
    bank_match_confirmed: "Receipt match confirmed",
    bank_no_receipt_required: "No-receipt-required decision recorded",
    receipt_extracted: "Receipt evidence extracted",
    receipt_filed: "Receipt filed",
    receipt_review_edited: "Receipt review corrected",
    receipt_category_applied: "Receipt category applied from agent approval",
    agent_recommendation_reviewed: "Agent recommendation reviewed",
  };
  return labels[action] ?? action.replace(/_/g, " ");
}
