import { Hono } from "hono";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import {
  filterByDateRange,
  isValidCalendarDate,
  isCurrencyMismatch,
  type AnyDisposition,
} from "../services/pnl";
import { assemblePnlReport } from "../services/reporting";

export const pnlRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

const CONFLICTING_DISPOSITIONS = [
  "personal",
  "transfer",
  "owner_contribution",
  "owner_draw",
  "loan",
  "other_excluded",
  "business_income",
] as const;

const CONFLICTING_DISPOSITIONS_SQL_LIST = CONFLICTING_DISPOSITIONS.map((d) => `'${d}'`).join(", ");

/**
 * Build the expense ledger from approved evidence while preserving an exact
 * receipt-total reconciliation.
 *
 * Purchased items stay as individual ledger lines. Any receipt-level delta
 * between the item sum and the approved grand total, including tax, tip,
 * discounts, shipping, and rounding, becomes one explicit adjustment line.
 * Category identity is canonical: the receipt's own category_id foreign key
 * is used directly, and a line item's free-text category is resolved
 * against the client's categories table by slug or display name (never by
 * lowercased string coincidence), so "Supplies" and "supplies" are always
 * one category. A receipt matched to a bank transaction whose disposition
 * explicitly contradicts business use (personal, transfer, owner activity,
 * loan, other-excluded, or business income) is excluded here entirely: the
 * professional's bank-side decision wins, and the P&L never silently keeps
 * it as a business expense. Receipts in a currency other than the client's
 * configured default are also excluded, surfaced instead as a currency
 * conflict for deliberate resolution. Currency comparisons are
 * case-insensitive so legacy lowercase currency codes never slip through.
 */
const expenseLinesCte = `
WITH line_sums AS (
  SELECT
    r.id AS receipt_id,
    COALESCE(SUM(COALESCE(li.amount, 0)), 0)::numeric AS line_sum,
    COUNT(li.id)::int AS line_count
  FROM receipts r
  LEFT JOIN receipt_line_items li ON li.receipt_id = r.id
  WHERE r.client_id = $1 AND r.status = 'filed'
  GROUP BY r.id
),
receipt_conflict AS (
  SELECT r.id AS receipt_id
  FROM receipts r
  JOIN bank_transactions bt ON bt.matched_receipt_id = r.id AND bt.client_id = r.client_id
  WHERE bt.disposition IN (${CONFLICTING_DISPOSITIONS_SQL_LIST})
),
expense_lines AS (
  SELECT
    r.id AS receipt_id,
    r.extracted_date AS txn_date,
    r.extracted_merchant AS merchant,
    r.filename,
    li.line_no,
    li.description,
    COALESCE(cat_li.id, r.category_id) AS category_id,
    COALESCE(cat_li.name, cat_receipt.name, 'Uncategorized') AS category,
    COALESCE(li.amount, 0)::numeric AS amount
  FROM receipts r
  JOIN receipt_line_items li ON li.receipt_id = r.id
  LEFT JOIN categories cat_li ON cat_li.client_id = r.client_id
    AND (LOWER(cat_li.slug) = LOWER(NULLIF(li.category, '')) OR LOWER(cat_li.name) = LOWER(NULLIF(li.category, '')))
  LEFT JOIN categories cat_receipt ON cat_receipt.id = r.category_id
  WHERE r.client_id = $1 AND r.status = 'filed'
    AND UPPER(r.extracted_currency) = UPPER($4)
    AND NOT EXISTS (SELECT 1 FROM receipt_conflict rc WHERE rc.receipt_id = r.id)
    AND ($2::date IS NULL OR r.extracted_date >= $2::date)
    AND ($3::date IS NULL OR r.extracted_date <= $3::date)

  UNION ALL

  SELECT
    r.id AS receipt_id,
    r.extracted_date AS txn_date,
    r.extracted_merchant AS merchant,
    r.filename,
    NULL::integer AS line_no,
    '(receipt-level adjustment)' AS description,
    r.category_id AS category_id,
    COALESCE(cat_receipt.name, 'Uncategorized') AS category,
    (COALESCE(r.extracted_total, s.line_sum) - s.line_sum)::numeric AS amount
  FROM receipts r
  JOIN line_sums s ON s.receipt_id = r.id
  LEFT JOIN categories cat_receipt ON cat_receipt.id = r.category_id
  WHERE r.client_id = $1
    AND r.status = 'filed'
    AND UPPER(r.extracted_currency) = UPPER($4)
    AND s.line_count > 0
    AND ABS(COALESCE(r.extracted_total, s.line_sum) - s.line_sum) > 0.004
    AND NOT EXISTS (SELECT 1 FROM receipt_conflict rc WHERE rc.receipt_id = r.id)
    AND ($2::date IS NULL OR r.extracted_date >= $2::date)
    AND ($3::date IS NULL OR r.extracted_date <= $3::date)

  UNION ALL

  SELECT
    r.id AS receipt_id,
    r.extracted_date AS txn_date,
    r.extracted_merchant AS merchant,
    r.filename,
    NULL::integer AS line_no,
    '(receipt total)' AS description,
    r.category_id AS category_id,
    COALESCE(cat_receipt.name, 'Uncategorized') AS category,
    COALESCE(r.extracted_total, 0)::numeric AS amount
  FROM receipts r
  JOIN line_sums s ON s.receipt_id = r.id
  LEFT JOIN categories cat_receipt ON cat_receipt.id = r.category_id
  WHERE r.client_id = $1
    AND r.status = 'filed'
    AND UPPER(r.extracted_currency) = UPPER($4)
    AND s.line_count = 0
    AND NOT EXISTS (SELECT 1 FROM receipt_conflict rc WHERE rc.receipt_id = r.id)
    AND ($2::date IS NULL OR r.extracted_date >= $2::date)
    AND ($3::date IS NULL OR r.extracted_date <= $3::date)
)`;

function parseDateBound(value: string | undefined): { ok: true; date: string | null } | { ok: false } {
  if (!value) return { ok: true, date: null };
  if (!isValidCalendarDate(value)) return { ok: false };
  return { ok: true, date: value };
}

pnlRoutes.get("/:clientId/pnl", async (c) => {
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
  return c.json(report);
});

pnlRoutes.get("/:clientId/pnl/drilldown", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);
  const category = c.req.query("category");
  if (!category) return c.json({ error: "category is required" }, 400);
  const type = c.req.query("type") === "income" ? "income" : "expense";
  const startBound = parseDateBound(c.req.query("startDate"));
  const endBound = parseDateBound(c.req.query("endDate"));
  if (!startBound.ok) return c.json({ error: "startDate must be a valid calendar date in YYYY-MM-DD format" }, 400);
  if (!endBound.ok) return c.json({ error: "endDate must be a valid calendar date in YYYY-MM-DD format" }, 400);
  const startDate = startBound.date;
  const endDate = endBound.date;
  if (startDate && endDate && startDate > endDate) {
    return c.json({ error: "startDate must not be after endDate" }, 400);
  }

  const [profile] = await db.query<{ default_currency: string }>(
    `SELECT default_currency FROM client_profiles WHERE client_id = $1`,
    [clientId],
  );
  const clientCurrency = (profile?.default_currency || "USD").toUpperCase();

  if (type === "income") {
    const incomeRows = await db.query<{
      id: string;
      txn_date: string | null;
      description: string | null;
      amount: number;
      category_name: string | null;
      disposition_note: string | null;
      raw_json: unknown;
      currency: string;
    }>(
      `SELECT bt.id, bt.txn_date, bt.description, bt.amount, cat.name AS category_name,
              bt.disposition_note, bt.raw_json, bt.currency
       FROM bank_transactions bt
       LEFT JOIN categories cat ON cat.id = bt.category_id AND cat.client_id = bt.client_id
       WHERE bt.client_id = $1
         AND bt.disposition = 'business_income'
         AND ((bt.category_id IS NULL AND $2 = 'Uncategorized') OR LOWER(COALESCE(cat.name, 'Uncategorized')) = LOWER($2))`,
      [clientId, category],
    );
    const entries = filterByDateRange(
      incomeRows
        .filter((row) => !isCurrencyMismatch((row.currency || "USD").toUpperCase(), clientCurrency))
        .map((row) => {
          const raw = (row.raw_json ?? {}) as {
            importBatchId?: string;
            sourceFilename?: string;
            sourceRow?: number;
            original?: unknown;
          };
          return {
            date: row.txn_date ? String(row.txn_date) : null,
            bankTransactionId: row.id,
            description: row.description,
            amount: Number(row.amount ?? 0),
            reportedAmount: Number(row.amount ?? 0),
            category: row.category_name || "Uncategorized",
            dispositionNote: row.disposition_note,
            sourceFilename: raw.sourceFilename ?? null,
            sourceRow: typeof raw.sourceRow === "number" ? raw.sourceRow : null,
            importBatchId: raw.importBatchId ?? null,
            originalRow: raw.original ?? null,
          };
        }),
      startDate,
      endDate,
    );
    return c.json({ type: "income", category, entries });
  }

  const entries = await db.query<{
    receipt_id: string;
    txn_date: string | null;
    merchant: string | null;
    filename: string;
    line_no: number | null;
    description: string;
    category_id: string | null;
    category: string;
    amount: number;
  }>(
    `${expenseLinesCte}
     SELECT * FROM expense_lines
     WHERE (category_id IS NULL AND $5 = 'Uncategorized') OR (category_id IS NOT NULL AND LOWER(category) = LOWER($5))
     ORDER BY txn_date DESC NULLS LAST, merchant, receipt_id, line_no NULLS LAST`,
    [clientId, startDate, endDate, clientCurrency, category],
  );

  const bankRows = await db.query<{
    id: string;
    txn_date: string | null;
    description: string;
    amount: number;
    disposition: AnyDisposition;
    triage: string;
    category_name: string | null;
    disposition_note: string | null;
    resolution_reason: string | null;
    currency: string;
  }>(
    `SELECT bt.id, bt.txn_date, bt.description, bt.amount, bt.disposition, bt.triage,
            cat.name AS category_name, bt.disposition_note, bt.resolution_reason, bt.currency
     FROM bank_transactions bt
     LEFT JOIN categories cat ON cat.id = bt.category_id AND cat.client_id = bt.client_id
     WHERE bt.client_id = $1
       AND bt.disposition = 'business_expense'
       AND bt.triage = 'no_receipt_required'
       AND ((bt.category_id IS NULL AND $2 = 'Uncategorized') OR LOWER(COALESCE(cat.name, 'Uncategorized')) = LOWER($2))`,
    [clientId, category],
  );
  const bankEntries = filterByDateRange(
    bankRows
      .filter((row) => !isCurrencyMismatch((row.currency || "USD").toUpperCase(), clientCurrency))
      .map((row) => ({
        id: row.id,
        date: row.txn_date ? String(row.txn_date) : null,
        description: row.description,
        amount: Number(row.amount ?? 0),
        category: row.category_name || "Uncategorized",
        reason: row.resolution_reason,
        note: row.disposition_note,
      })),
    startDate,
    endDate,
  );

  return c.json({
    type: "expense",
    category,
    entries: entries.map((entry) => ({
      receiptId: entry.receipt_id,
      date: entry.txn_date,
      merchant: entry.merchant,
      filename: entry.filename,
      lineNo: entry.line_no,
      description: entry.description,
      amount: Number(entry.amount),
      sourceUrl: `/api/clients/${clientId}/receipts/${entry.receipt_id}/source`,
    })),
    bankEntries: bankEntries.map((entry) => ({
      bankTransactionId: entry.id,
      date: entry.date,
      description: entry.description,
      amount: -Number(entry.amount),
      noReceiptReason: entry.reason,
      note: entry.note,
    })),
  });
});
