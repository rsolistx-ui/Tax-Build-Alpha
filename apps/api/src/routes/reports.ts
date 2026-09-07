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
} from "../services/reporting";
import { buildWorkbook } from "../services/excel";
import { buildBankTransactionsCsv, validateSingleSourceSelection } from "../services/bank-export";
import { buildWorkbookFilename, buildBankCsvFilename } from "../services/filenames";

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

  const [ledger, receiptEvidence, openItems, excludedNonbusiness] = await Promise.all([
    getBankLedger(db, clientId, startDate, endDate),
    getReceiptEvidence(db, clientId, startDate, endDate),
    getOpenItems(db, clientId, startDate, endDate),
    getExcludedNonbusiness(db, clientId, startDate, endDate),
  ]);

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
    isDraft: !report.completeness.isComplete,
  });
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

  const [profile, ledger, receiptEvidence, openItems, excludedNonbusiness, transactionReview] = await Promise.all([
    db.query<{ tax_year: number | null }>(`SELECT tax_year FROM client_profiles WHERE client_id = $1`, [clientId]),
    getBankLedger(db, clientId, startDate, endDate),
    getReceiptEvidence(db, clientId, startDate, endDate),
    getOpenItems(db, clientId, startDate, endDate),
    getExcludedNonbusiness(db, clientId, startDate, endDate),
    getTransactionReviewRows(db, clientId, startDate, endDate),
  ]);

  const isDraft = !report.completeness.isComplete;
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
