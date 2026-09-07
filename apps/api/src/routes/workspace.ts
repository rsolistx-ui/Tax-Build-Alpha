import { Hono } from "hono";
import { createDb, type Db } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { newId } from "../lib/id";
import { buildClientDashboardRow, buildDocumentWorkflowActions, sortActions, type DashboardBankTxn, type DashboardReceipt, type DashboardClientMeta } from "../services/dashboard";
import type { AnyDisposition } from "../services/pnl";
import { validateProfileInput, mergeProfile } from "../services/client-profile";
import { isValidReadinessState, suggestReadinessState, type TaxReadinessState } from "../services/tax-readiness";
import { generateChecklist, isValidChecklistStatus, suggestDocumentType, sha256Hex, isValidDocumentType } from "../services/documents";

export const workspaceRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
workspaceRoutes.use("*", requireSession);
workspaceRoutes.use("*", requireActiveBeta);

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

  const bankRows = await db.query<{
    id: string; txn_date: string | null; description: string | null; amount: number;
    disposition: string; triage: string; category_id: string | null; currency: string;
  }>(`SELECT id, txn_date, description, amount, disposition, triage, category_id, currency FROM bank_transactions WHERE client_id = $1`, [client.id]);

  const receiptRows = await db.query<{
    id: string; status: string; extracted_merchant: string | null; extracted_date: string | null;
    extracted_currency: string | null; category_id: string | null;
  }>(`SELECT r.id, r.status, r.extracted_merchant, r.extracted_date, r.extracted_currency, r.category_id FROM receipts r WHERE r.client_id = $1`, [client.id]);

  const matchedDispositionRows = await db.query<{ matched_receipt_id: string; disposition: string }>(
    `SELECT matched_receipt_id, disposition FROM bank_transactions WHERE client_id = $1 AND matched_receipt_id IS NOT NULL`,
    [client.id],
  );
  const dispositionByReceipt = new Map(matchedDispositionRows.map((r) => [r.matched_receipt_id, r.disposition]));

  const checklistRows = await db.query<{ id: string; tax_year: number; doc_type: string; custom_label: string | null; status: string }>(
    `SELECT id, tax_year, doc_type, custom_label, status FROM document_checklist_items WHERE client_id = $1`,
    [client.id],
  );
  const documentRows = await db.query<{ id: string; filename: string; document_type: string; status: string }>(
    `SELECT id, filename, document_type, status FROM client_documents WHERE client_id = $1`,
    [client.id],
  );
  const [readinessRow] = taxYear
    ? await db.query<{ status: string }>(`SELECT status FROM tax_year_readiness WHERE client_id = $1 AND tax_year = $2`, [client.id, taxYear])
    : [];

  const meta: DashboardClientMeta = {
    id: client.id, name: client.name, legalName: client.legal_name, taxYear, accountingBasis: profileRow?.accounting_basis ?? null,
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

  const { row, actions } = buildClientDashboardRow(meta, bankTxns, receipts);
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
      openActionCount: nextActions.length, lastActivityAt: client.updated_at,
    },
    financialStatus: {
      pnlCompleteness: row.isComplete, bankTransactionCount: bankTxns.length,
      missingEvidenceCount: row.missingEvidenceCount, unclassifiedCount: row.unclassifiedCount,
      uncategorizedCount: row.uncategorizedCount, currencyConflictCount: row.currencyConflictCount,
    },
    documentStatus: {
      receiptsReceived: receipts.length, receiptsAwaitingReview, filedReceipts,
      missingEvidence: row.missingEvidenceCount,
      taxDocumentsReceived: checklistRows.filter((i) => i.status === "received" || i.status === "reviewed").length,
      taxDocumentsRequested: documentsExpected, documentsAwaitingReview,
    },
    nextActions,
  });
});

/** Professional client profile: shared context, entered once. */
workspaceRoutes.get("/:clientId/profile", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const [profile] = await db.query<Record<string, unknown>>(
    `SELECT entity_type, industry, state, tax_year, accounting_basis, default_currency, profile FROM client_profiles WHERE client_id = $1`,
    [client.id],
  );
  return c.json({ profile: profile ?? { entity_type: null, industry: null, state: null, tax_year: null, accounting_basis: null, default_currency: "USD", profile: {} } });
});

workspaceRoutes.patch("/:clientId/profile", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const body = (await c.req.json()) as Record<string, unknown>;

  const coreFields: Record<string, unknown> = {};
  for (const key of ["entity_type", "industry", "state", "tax_year", "accounting_basis", "default_currency"]) {
    if (key in body) coreFields[key] = body[key];
  }
  const professionalInput = (body.professional as Record<string, unknown>) ?? {};
  const validation = validateProfileInput(professionalInput);
  if (!validation.ok) return c.json({ error: validation.error }, 400);

  const [existing] = await db.query<{ profile: Record<string, unknown> }>(`SELECT profile FROM client_profiles WHERE client_id = $1`, [client.id]);
  const mergedProfile = mergeProfile(existing?.profile ?? {}, validation.sanitized);

  await db.query(
    `INSERT INTO client_profiles (client_id, entity_type, industry, state, tax_year, accounting_basis, default_currency, profile, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
     ON CONFLICT (client_id) DO UPDATE SET
       entity_type = COALESCE($2, client_profiles.entity_type),
       industry = COALESCE($3, client_profiles.industry),
       state = COALESCE($4, client_profiles.state),
       tax_year = COALESCE($5, client_profiles.tax_year),
       accounting_basis = COALESCE($6, client_profiles.accounting_basis),
       default_currency = COALESCE($7, client_profiles.default_currency),
       profile = $8::jsonb,
       updated_at = NOW()`,
    [
      client.id,
      coreFields.entity_type ?? null, coreFields.industry ?? null, coreFields.state ?? null,
      coreFields.tax_year ?? null, coreFields.accounting_basis ?? null, coreFields.default_currency ?? "USD",
      mergedProfile,
    ],
  );
  await insertAudit(db, client.id, c.get("userId"), "client_profile_updated", existing?.profile ?? {}, mergedProfile);
  return c.json({ ok: true });
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

  const [profileRow] = await db.query<{ profile: Record<string, unknown> }>(`SELECT profile FROM client_profiles WHERE client_id = $1`, [client.id]);
  const taxPrepRequired = Boolean((profileRow?.profile ?? {}).taxPrepRequired);
  const totalChecklistItems = checklist.filter((i) => i.status !== "not_applicable").length;
  const receivedOrReviewed = checklist.filter((i) => i.status === "received" || i.status === "reviewed").length;

  const [bookkeepingRow] = await db.query<{ complete: boolean }>(
    `SELECT NOT EXISTS(SELECT 1 FROM bank_transactions WHERE client_id = $1 AND (disposition = 'unclassified' OR triage NOT IN ('matched', 'no_receipt_required'))) AS complete`,
    [client.id],
  );

  const suggestedStatus = suggestReadinessState({
    taxPrepRequired,
    bookkeepingComplete: Boolean(bookkeepingRow?.complete),
    totalChecklistItems,
    receivedOrReviewedChecklistItems: receivedOrReviewed,
  });

  return c.json({
    taxYear,
    status: readiness?.status ?? "not_started",
    suggestedStatus,
    notes: readiness?.notes ?? null,
    checklist,
    updatedAt: readiness?.updated_at ?? null,
  });
});

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
  const documents = await db.query(
    `SELECT id, filename, content_type, size_bytes, document_type, tax_year, document_date, source_label, checklist_item_id, status, duplicate_of_document_id, uploaded_at, reviewed_at
     FROM client_documents WHERE client_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY uploaded_at DESC LIMIT 200`,
    [client.id, status],
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
  const taxYearValue = form.get("taxYear");
  const taxYear = typeof taxYearValue === "string" && taxYearValue.trim() ? Number(taxYearValue) : null;

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
  const [document] = await db.query<{ r2_key: string; content_type: string | null; filename: string }>(
    `SELECT r2_key, content_type, filename FROM client_documents WHERE id = $1 AND client_id = $2`,
    [c.req.param("documentId"), client.id],
  );
  if (!document) return c.json({ error: "Not found" }, 404);
  const object = await c.env.RECEIPTS.get(document.r2_key);
  if (!object) return c.json({ error: "Source object missing" }, 404);
  const filename = document.filename.replace(/["\r\n]/g, "");
  return new Response(object.body, {
    headers: {
      "content-type": document.content_type || object.httpMetadata?.contentType || "application/octet-stream",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "private, no-store",
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

/** Shared review-action handler used by both the client-scoped and cross-client review endpoints. */
export async function applyDocumentReviewAction(
  db: Db,
  firmId: string,
  documentId: string,
  actorUserId: string,
  body: DocumentReviewAction,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [document] = await db.query<{ id: string; client_id: string; status: string; document_type: string; tax_year: number | null; firm_id: string }>(
    `SELECT cd.id, cd.client_id, cd.status, cd.document_type, cd.tax_year, c.firm_id
     FROM client_documents cd JOIN clients c ON c.id = cd.client_id
     WHERE cd.id = $1 AND c.firm_id = $2`,
    [documentId, firmId],
  );
  if (!document) return { ok: false, status: 404, error: "Not found" };

  const before = { status: document.status, documentType: document.document_type, taxYear: document.tax_year };
  let clientIdForAudit = document.client_id;

  switch (body.action) {
    case "confirm": {
      const documentType = body.documentType && isValidDocumentType(body.documentType) ? body.documentType : document.document_type;
      await db.query(
        `UPDATE client_documents SET status = 'confirmed', document_type = $1, tax_year = COALESCE($2, tax_year), reviewed_by = $3, reviewed_at = NOW() WHERE id = $4`,
        [documentType, body.taxYear ?? null, actorUserId, documentId],
      );
      break;
    }
    case "correct": {
      if (body.documentType && !isValidDocumentType(body.documentType)) return { ok: false, status: 400, error: "Invalid documentType" };
      await db.query(
        `UPDATE client_documents SET document_type = COALESCE($1, document_type), tax_year = COALESCE($2, tax_year), checklist_item_id = COALESCE($3, checklist_item_id) WHERE id = $4`,
        [body.documentType ?? null, body.taxYear ?? null, body.checklistItemId ?? null, documentId],
      );
      break;
    }
    case "assign_document_type": {
      if (!body.documentType || !isValidDocumentType(body.documentType)) return { ok: false, status: 400, error: "Invalid documentType" };
      await db.query(`UPDATE client_documents SET document_type = $1 WHERE id = $2`, [body.documentType, documentId]);
      break;
    }
    case "assign_tax_year": {
      if (typeof body.taxYear !== "number") return { ok: false, status: 400, error: "taxYear is required" };
      await db.query(`UPDATE client_documents SET tax_year = $1 WHERE id = $2`, [body.taxYear, documentId]);
      break;
    }
    case "assign_client": {
      if (!body.targetClientId) return { ok: false, status: 400, error: "targetClientId is required" };
      const [target] = await db.query<{ id: string }>(`SELECT id FROM clients WHERE id = $1 AND firm_id = $2`, [body.targetClientId, firmId]);
      if (!target) return { ok: false, status: 404, error: "Target client not found in this firm" };
      await db.query(`UPDATE client_documents SET client_id = $1 WHERE id = $2`, [body.targetClientId, documentId]);
      clientIdForAudit = body.targetClientId;
      break;
    }
    case "match_checklist": {
      if (!body.checklistItemId) return { ok: false, status: 400, error: "checklistItemId is required" };
      const [item] = await db.query<{ id: string }>(`SELECT id FROM document_checklist_items WHERE id = $1 AND client_id = $2`, [body.checklistItemId, document.client_id]);
      if (!item) return { ok: false, status: 404, error: "Checklist item not found for this client" };
      await db.query(`UPDATE client_documents SET checklist_item_id = $1 WHERE id = $2`, [body.checklistItemId, documentId]);
      await db.query(`UPDATE document_checklist_items SET status = 'received', updated_at = NOW() WHERE id = $1`, [body.checklistItemId]);
      break;
    }
    case "mark_duplicate": {
      await db.query(`UPDATE client_documents SET status = 'duplicate', duplicate_of_document_id = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3`, [body.duplicateOfDocumentId ?? null, actorUserId, documentId]);
      break;
    }
    case "mark_not_needed": {
      await db.query(`UPDATE client_documents SET status = 'not_needed', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2`, [actorUserId, documentId]);
      break;
    }
    default:
      return { ok: false, status: 400, error: "Unknown action" };
  }

  await insertAudit(db, clientIdForAudit, actorUserId, "document_reviewed", before, { action: body.action });
  return { ok: true };
}

workspaceRoutes.patch("/:clientId/documents/:documentId", async (c) => {
  const { db, client, firm } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const body = (await c.req.json()) as DocumentReviewAction;
  const result = await applyDocumentReviewAction(db, firm.id, c.req.param("documentId"), c.get("userId"), body);
  if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 404);
  return c.json({ ok: true });
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
  };
  return labels[action] ?? action.replace(/_/g, " ");
}
