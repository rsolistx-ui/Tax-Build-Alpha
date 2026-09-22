import { Hono } from "hono";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { isValidCalendarDate } from "../services/pnl";
import {
  assemblePnlReport,
  isAccrualUnsupported,
  getBankLedger,
  getReceiptEvidence,
  getOpenItems,
  getExcludedNonbusiness,
  getTransactionReviewRows,
  listImportBatches,
  getReceiptsAwaitingReview,
  getOutstandingClientRequests,
} from "../services/reporting";
import { buildWorkbook } from "../services/excel";
import { buildBankTransactionsCsv, validateSingleSourceSelection } from "../services/bank-export";
import { buildWorkbookFilename, buildBankCsvFilename } from "../services/filenames";
import { newId } from "../lib/id";

export const reportRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
reportRoutes.use("*", requireSession);
reportRoutes.use("*", requireActiveBeta);

function parseDateBound(value: string | undefined): { ok: true; date: string | null } | { ok: false } {
  if (!value) return { ok: true, date: null };
  if (!isValidCalendarDate(value)) return { ok: false };
  return { ok: true, date: value };
}



/**
 * Compact preview so a professional knows, before downloading anything,
 * whether they are exporting complete books or a working draft.
 */
reportRoutes.get("/:clientId/export/preview", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const startBound = parseDateBound(c.req.query("startDate"));
  const endBound = parseDateBound(c.req.query("endDate"));
  if (!startBound.ok) return c.json({ error: "startDate must be a valid calendar date in YYYY-MM-DD format" }, 400);
  if (!endBound.ok) return c.json({ error: "endDate must be a valid calendar date in YYYY-MM-DD format" }, 400);
  const startDate = startBound.date;
  const endDate = endBound.date;
  if (startDate && endDate && startDate > endDate) {
    return c.json({ error: "startDate must not be after endDate" }, 400);
  }

  const report = await assemblePnlReport(db, clientId, startDate, endDate);
  if (isAccrualUnsupported(report)) {
    return c.json({ accrualSupported: false, warning: report.warning });
  }

  const [ledger, receiptEvidence, openItems, excludedNonbusiness, receiptsAwaitingReview, outstandingClientRequests] = await Promise.all([
    getBankLedger(db, clientId, startDate, endDate),
    getReceiptEvidence(db, clientId, startDate, endDate),
    getOpenItems(db, clientId, startDate, endDate),
    getExcludedNonbusiness(db, clientId, startDate, endDate),
    getReceiptsAwaitingReview(db, clientId, startDate, endDate),
    getOutstandingClientRequests(db, clientId),
  ]);
  const isDraft = !report.completeness.isComplete || receiptsAwaitingReview.length > 0 || outstandingClientRequests.length > 0;
  const [lastSignoff] = await db.query<{ actor_user_id: string; created_at: string; after_json: unknown }>(
    `SELECT actor_user_id, created_at, after_json FROM audit_events
     WHERE client_id = $1 AND action = 'close_packet_signed_off'
     ORDER BY created_at DESC LIMIT 1`,
    [clientId],
  );

  return c.json({
    client: client.name,
    periodStart: startDate,
    periodEnd: endDate,
    currency: report.currency,
    accountingBasis: report.accountingBasis,
    income: report.income,
    expenses: report.expenses,
    net: report.net,
    totalBankTransactions: ledger.length,
    totalFiledReceipts: receiptEvidence.length,
    excludedTransactions: excludedNonbusiness.length,
    openItemsCount: openItems.length,
    completeness: report.completeness,
    receiptsAwaitingReviewCount: receiptsAwaitingReview.length,
    outstandingClientRequestCount: outstandingClientRequests.length,
    isDraft,
    signoff: !isDraft && lastSignoff ? {
      actorUserId: lastSignoff.actor_user_id,
      signedAt: lastSignoff.created_at,
      ...(typeof lastSignoff.after_json === "object" && lastSignoff.after_json ? lastSignoff.after_json : {}),
    } : null,
  });
});

/** One evidence-backed list of every close blocker; no counts without the underlying work. */
reportRoutes.get("/:clientId/export/exceptions", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);
  const startBound = parseDateBound(c.req.query("startDate"));
  const endBound = parseDateBound(c.req.query("endDate"));
  if (!startBound.ok || !endBound.ok || (startBound.date && endBound.date && startBound.date > endBound.date)) {
    return c.json({ error: "Use a valid reporting period." }, 400);
  }
  const [openItems, receiptsAwaitingReview, outstandingClientRequests] = await Promise.all([
    getOpenItems(db, client.id, startBound.date, endBound.date),
    getReceiptsAwaitingReview(db, client.id, startBound.date, endBound.date),
    getOutstandingClientRequests(db, client.id),
  ]);
  return c.json({ openItems, receiptsAwaitingReview, outstandingClientRequests });
});

/**
 * A close is never silently assumed. This records a practitioner decision only
 * after the exact same evidence checks used by the preview have passed.
 */
reportRoutes.post("/:clientId/export/signoff", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json<{ startDate?: string; endDate?: string; note?: string }>().catch(
    (): { startDate?: string; endDate?: string; note?: string } => ({}),
  );
  const startBound = parseDateBound(body.startDate);
  const endBound = parseDateBound(body.endDate);
  if (!startBound.ok || !endBound.ok || (startBound.date && endBound.date && startBound.date > endBound.date)) {
    return c.json({ error: "Use a valid reporting period." }, 400);
  }

  const [report, receiptsAwaitingReview, outstandingClientRequests] = await Promise.all([
    assemblePnlReport(db, clientId, startBound.date, endBound.date),
    getReceiptsAwaitingReview(db, clientId, startBound.date, endBound.date),
    getOutstandingClientRequests(db, clientId),
  ]);
  if (isAccrualUnsupported(report)) return c.json({ error: report.warning, code: "ACCRUAL_NOT_SUPPORTED" }, 400);
  if (!report.completeness.isComplete || receiptsAwaitingReview.length || outstandingClientRequests.length) {
    return c.json({
      error: "Resolve all close exceptions before recording practitioner sign-off.",
      code: "CLOSE_NOT_READY",
      exceptionCounts: {
        openItems: report.completeness.unresolvedTriageCount + report.completeness.unclassifiedCount + report.completeness.uncategorizedCount + report.completeness.currencyConflictCount,
        receiptsAwaitingReview: receiptsAwaitingReview.length,
        outstandingClientRequests: outstandingClientRequests.length,
      },
    }, 409);
  }

  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
  const signedAt = new Date().toISOString();
  await db.query(
    `INSERT INTO audit_events (id, client_id, actor_user_id, action, before_json, after_json)
     VALUES ($1, $2, $3, 'close_packet_signed_off', NULL, $4)`,
    [newId("aud"), clientId, c.get("userId"), { startDate: startBound.date, endDate: endBound.date, note: note || null, signedAt }],
  );
  return c.json({ ok: true, signedAt, note: note || null });
});

/** Streams the full professional Excel workbook. */
reportRoutes.get("/:clientId/export/workbook", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const startBound = parseDateBound(c.req.query("startDate"));
  const endBound = parseDateBound(c.req.query("endDate"));
  if (!startBound.ok) return c.json({ error: "startDate must be a valid calendar date in YYYY-MM-DD format" }, 400);
  if (!endBound.ok) return c.json({ error: "endDate must be a valid calendar date in YYYY-MM-DD format" }, 400);
  const startDate = startBound.date;
  const endDate = endBound.date;
  if (startDate && endDate && startDate > endDate) {
    return c.json({ error: "startDate must not be after endDate" }, 400);
  }

  const report = await assemblePnlReport(db, clientId, startDate, endDate);
  if (isAccrualUnsupported(report)) {
    return c.json({ error: report.warning, code: "ACCRUAL_NOT_SUPPORTED" }, 400);
  }

  const [profile, ledger, receiptEvidence, openItems, excludedNonbusiness, transactionReview, receiptsAwaitingReview, outstandingClientRequests] = await Promise.all([
    db.query<{ tax_year: number | null }>(`SELECT tax_year FROM client_profiles WHERE client_id = $1`, [clientId]),
    getBankLedger(db, clientId, startDate, endDate),
    getReceiptEvidence(db, clientId, startDate, endDate),
    getOpenItems(db, clientId, startDate, endDate),
    getExcludedNonbusiness(db, clientId, startDate, endDate),
    getTransactionReviewRows(db, clientId, startDate, endDate),
    getReceiptsAwaitingReview(db, clientId, startDate, endDate),
    getOutstandingClientRequests(db, clientId),
  ]);

  const isDraft = !report.completeness.isComplete || receiptsAwaitingReview.length > 0 || outstandingClientRequests.length > 0;
  const bytes = await buildWorkbook({
    clientName: client.name,
    legalName: client.legal_name,
    periodStart: startDate,
    periodEnd: endDate,
    taxYear: profile[0]?.tax_year ?? null,
    accountingBasis: report.accountingBasis,
    currency: report.currency,
    generatedAt: new Date().toISOString(),
    pnl: report,
    bankLedger: ledger,
    receiptEvidence,
    openItems,
    receiptsAwaitingReview,
    outstandingClientRequests,
    excludedNonbusiness,
    transactionReview,
  });

  const filename = buildWorkbookFilename({ clientName: client.name, startDate, endDate, isDraft });
  return new Response(bytes, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
    },
  });
});

/** Distinct source/import-batch + currency groupings, so the UI can force a single selection. */
reportRoutes.get("/:clientId/export/import-batches", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const startBound = parseDateBound(c.req.query("startDate"));
  const endBound = parseDateBound(c.req.query("endDate"));
  if (!startBound.ok) return c.json({ error: "startDate must be a valid calendar date in YYYY-MM-DD format" }, 400);
  if (!endBound.ok) return c.json({ error: "endDate must be a valid calendar date in YYYY-MM-DD format" }, 400);

  const batches = await listImportBatches(db, clientId, startBound.date, endBound.date);
  return c.json({ batches });
});

/**
 * A deliberately narrow generic bank-transaction statement CSV: Date,
 * Description, Amount only. Never claims to transfer Folio's categorization;
 * the professional reference for that lives in the workbook's Transaction
 * Review worksheet.
 */
reportRoutes.get("/:clientId/export/bank-transactions-csv", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const startBound = parseDateBound(c.req.query("startDate"));
  const endBound = parseDateBound(c.req.query("endDate"));
  if (!startBound.ok) return c.json({ error: "startDate must be a valid calendar date in YYYY-MM-DD format" }, 400);
  if (!endBound.ok) return c.json({ error: "endDate must be a valid calendar date in YYYY-MM-DD format" }, 400);
  const startDate = startBound.date;
  const endDate = endBound.date;

  const importBatchIdParam = c.req.query("importBatchId");
  const importBatchId = importBatchIdParam === "__none__" ? null : (importBatchIdParam ?? undefined);
  const currencyParam = c.req.query("currency");
  if (!currencyParam) {
    return c.json({ error: "currency is required to build a single-currency bank transactions statement" }, 400);
  }

  const allRows = await getTransactionReviewRows(db, clientId, startDate, endDate);
  const selected = allRows.filter((row) => {
    const batchMatches = importBatchId === undefined ? true : row.importBatchId === importBatchId;
    return batchMatches && row.currency.toUpperCase() === currencyParam.toUpperCase();
  });

  const validation = validateSingleSourceSelection(selected);
  if (!validation.ok) {
    return c.json(
      {
        error:
          validation.reason === "NO_TRANSACTIONS"
            ? "No transactions match the selected source and currency."
            : validation.reason === "MIXED_BATCHES"
              ? "Selected transactions span more than one import batch. Select a single source/import batch."
              : "Selected transactions span more than one currency. Select a single currency.",
        code: validation.reason,
      },
      400,
    );
  }

  const csv = buildBankTransactionsCsv(selected);
  const filename = buildBankCsvFilename({ clientName: client.name, startDate, endDate, currency: currencyParam });
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
    },
  });
});

/**
 * Vendor-independent index of a client's records. This intentionally does
 * not package evidence into an in-memory ZIP inside a Worker: that pattern is
 * unreliable for large files and can omit records at a memory boundary.
 * Instead it gives the practitioner a durable inventory plus authenticated
 * source paths, alongside the Excel close packet and transaction CSV exports.
 */
reportRoutes.get("/:clientId/export/clean-exit-manifest", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const [documents, receipts, signatures] = await Promise.all([
    db.query<{ id: string; filename: string; content_type: string | null; size_bytes: number | null; document_type: string; tax_year: number | null; status: string; source_hash: string; uploaded_at: string }>(
      `SELECT id, filename, content_type, size_bytes, document_type, tax_year, status, source_hash, uploaded_at
       FROM client_documents WHERE client_id = $1 ORDER BY uploaded_at ASC`,
      [client.id],
    ),
    db.query<{ id: string; filename: string; content_type: string | null; r2_key: string; status: string; extracted_date: string | null; extracted_merchant: string | null; extracted_total: string | null; created_at: string }>(
      `SELECT id, filename, content_type, r2_key, status, extracted_date, extracted_merchant, extracted_total, created_at
       FROM receipts WHERE client_id = $1 ORDER BY created_at ASC`,
      [client.id],
    ),
    db.query<{ id: string; form_type: string; status: string; signed_at: string | null; document_id: string | null; created_at: string }>(
      `SELECT id, form_type, status, signed_at, document_id, created_at
       FROM signature_requests WHERE firm_id = $1 AND client_id = $2 ORDER BY created_at ASC`,
      [firm.id, client.id],
    ),
  ]);

  const manifest = {
    format: "truepost-clean-exit-manifest/v1",
    generatedAt: new Date().toISOString(),
    firm: { id: firm.id, name: firm.name },
    client: { id: client.id, name: client.name },
    instructions: [
      "Download the Close & Preparer Packet and any needed transaction CSVs from the packet screen.",
      "Use each authenticated source path while signed in to retrieve the original evidence file.",
      "This inventory preserves file hashes and statuses. It does not claim to be an e-filed tax return.",
    ],
    documents: documents.map((document) => ({
      ...document,
      sourcePath: `/api/clients/${client.id}/documents/${document.id}/source`,
    })),
    receipts: receipts.map(({ r2_key: _r2Key, ...receipt }) => ({
      ...receipt,
      sourcePath: `/api/clients/${client.id}/receipts/${receipt.id}/source`,
    })),
    signatureRequests: signatures,
  };
  const filename = `truepost-clean-exit-${client.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || client.id}.json`;
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
});
