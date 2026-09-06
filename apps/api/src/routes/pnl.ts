import { Hono } from "hono";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import {
  filterByDateRange,
  selectBankExpenseTransactions,
  selectBankIncomeTransactions,
  sumAmount,
  mergeExpenseCategories,
  computeCompleteness,
  type BankTxnForPnl,
  type AnyDisposition,
} from "../services/pnl";

export const pnlRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
pnlRoutes.use("*", requireSession);

/**
 * Build the expense ledger from approved evidence while preserving an exact
 * receipt-total reconciliation.
 *
 * Purchased items stay as individual ledger lines. Any receipt-level delta
 * between the item sum and the approved grand total, including tax, tip,
 * discounts, shipping, and rounding, becomes one explicit adjustment line.
 * This keeps the P&L equal to the professional-approved receipt total without
 * hiding receipt-level amounts inside item rows. Date bounds are optional:
 * a null bound is unbounded on that side.
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
expense_lines AS (
  SELECT
    r.id AS receipt_id,
    r.extracted_date AS txn_date,
    r.extracted_merchant AS merchant,
    r.filename,
    li.line_no,
    li.description,
    COALESCE(NULLIF(li.category, ''), NULLIF(r.extracted_category, ''), 'uncategorized') AS category,
    COALESCE(li.amount, 0)::numeric AS amount
  FROM receipts r
  JOIN receipt_line_items li ON li.receipt_id = r.id
  WHERE r.client_id = $1 AND r.status = 'filed'
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
    COALESCE(NULLIF(r.extracted_category, ''), 'uncategorized') AS category,
    (COALESCE(r.extracted_total, s.line_sum) - s.line_sum)::numeric AS amount
  FROM receipts r
  JOIN line_sums s ON s.receipt_id = r.id
  WHERE r.client_id = $1
    AND r.status = 'filed'
    AND s.line_count > 0
    AND ABS(COALESCE(r.extracted_total, s.line_sum) - s.line_sum) > 0.004
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
    COALESCE(NULLIF(r.extracted_category, ''), 'uncategorized') AS category,
    COALESCE(r.extracted_total, 0)::numeric AS amount
  FROM receipts r
  JOIN line_sums s ON s.receipt_id = r.id
  WHERE r.client_id = $1
    AND r.status = 'filed'
    AND s.line_count = 0
    AND ($2::date IS NULL OR r.extracted_date >= $2::date)
    AND ($3::date IS NULL OR r.extracted_date <= $3::date)
)`;

function parseDateBound(value: string | undefined): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

pnlRoutes.get("/:clientId/pnl", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const startDate = parseDateBound(c.req.query("startDate"));
  const endDate = parseDateBound(c.req.query("endDate"));

  const receiptRows = await db.query<{ category: string; count: number; receipt_count: number; total: number }>(
    `${expenseLinesCte}
     SELECT category, COUNT(*)::int AS count, COUNT(DISTINCT receipt_id)::int AS receipt_count,
            COALESCE(SUM(amount), 0)::numeric AS total
     FROM expense_lines
     GROUP BY category
     ORDER BY total DESC, category`,
    [clientId, startDate, endDate],
  );
  const receiptExpenseTotal = receiptRows.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const filedReceiptCountResult = await db.query<{ count: string }>(
    `SELECT COUNT(DISTINCT r.id)::text AS count
     FROM receipts r
     WHERE r.client_id = $1 AND r.status = 'filed'
       AND ($2::date IS NULL OR r.extracted_date >= $2::date)
       AND ($3::date IS NULL OR r.extracted_date <= $3::date)`,
    [clientId, startDate, endDate],
  );
  const filedReceiptCount = parseInt(filedReceiptCountResult[0]?.count || "0", 10);

  const bankRows = await db.query<{
    id: string;
    txn_date: string | null;
    amount: number;
    disposition: AnyDisposition;
    triage: string;
    category_name: string | null;
  }>(
    `SELECT bt.id, bt.txn_date, bt.amount, bt.disposition, bt.triage, cat.name AS category_name
     FROM bank_transactions bt
     LEFT JOIN categories cat ON cat.id = bt.category_id AND cat.client_id = bt.client_id
     WHERE bt.client_id = $1`,
    [clientId],
  );
  const bankTxns: BankTxnForPnl[] = bankRows.map((row) => ({
    id: row.id,
    date: row.txn_date ? String(row.txn_date) : null,
    amount: Number(row.amount ?? 0),
    disposition: row.disposition,
    triage: row.triage,
    categoryName: row.category_name,
  }));
  const bankTxnsInRange = filterByDateRange(bankTxns, startDate, endDate);

  const bankExpenseTxns = selectBankExpenseTransactions(bankTxnsInRange);
  const bankIncomeTxns = selectBankIncomeTransactions(bankTxnsInRange);
  const bankExpenseTotal = sumAmount(bankExpenseTxns);
  const income = sumAmount(bankIncomeTxns);
  const expenses = receiptExpenseTotal + bankExpenseTotal;

  const bankExpenseByCategory = new Map<string, { category: string; count: number; total: number }>();
  for (const txn of bankExpenseTxns) {
    const key = (txn.categoryName || "uncategorized").toLowerCase();
    const existing = bankExpenseByCategory.get(key);
    if (existing) {
      existing.count += 1;
      existing.total += Math.abs(txn.amount);
    } else {
      bankExpenseByCategory.set(key, {
        category: txn.categoryName || "uncategorized",
        count: 1,
        total: Math.abs(txn.amount),
      });
    }
  }

  const bankIncomeByCategory = new Map<string, { category: string; count: number; total: number }>();
  for (const txn of bankIncomeTxns) {
    const key = (txn.categoryName || "uncategorized").toLowerCase();
    const existing = bankIncomeByCategory.get(key);
    if (existing) {
      existing.count += 1;
      existing.total += Math.abs(txn.amount);
    } else {
      bankIncomeByCategory.set(key, {
        category: txn.categoryName || "uncategorized",
        count: 1,
        total: Math.abs(txn.amount),
      });
    }
  }

  const categorizedExpenses = mergeExpenseCategories(
    receiptRows.map((row) => ({
      category: row.category,
      count: Number(row.count),
      receiptCount: Number(row.receipt_count),
      total: Number(row.total),
    })),
    Array.from(bankExpenseByCategory.values()),
  );
  const categorizedIncome = Array.from(bankIncomeByCategory.values()).sort((a, b) => b.total - a.total);

  const completeness = computeCompleteness(bankTxnsInRange);
  const matchedBankTransactionCount = bankTxnsInRange.filter((t) => t.triage === "matched").length;

  return c.json({
    periodStart: startDate,
    periodEnd: endDate,
    currency: "USD",
    income,
    expenses,
    net: income - expenses,
    categorizedExpenses,
    categorizedIncome,
    counts: {
      filedReceipts: filedReceiptCount,
      matchedBankTransactions: matchedBankTransactionCount,
      noReceiptBusinessExpenses: bankExpenseTxns.length,
      businessIncomeTransactions: bankIncomeTxns.length,
    },
    completeness,
    note: "Business income comes only from bank transactions explicitly classified business income. Business expenses combine filed receipt evidence with deliberately no-receipt bank transactions explicitly classified business expense. Personal, transfer, owner, loan, other-excluded, and unclassified activity are excluded.",
  });
});

pnlRoutes.get("/:clientId/pnl/drilldown", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);
  const category = c.req.query("category");
  if (!category) return c.json({ error: "category is required" }, 400);
  const startDate = parseDateBound(c.req.query("startDate"));
  const endDate = parseDateBound(c.req.query("endDate"));

  const entries = await db.query<{
    receipt_id: string;
    txn_date: string | null;
    merchant: string | null;
    filename: string;
    line_no: number | null;
    description: string;
    category: string;
    amount: number;
  }>(
    `${expenseLinesCte}
     SELECT * FROM expense_lines
     WHERE category = $4
     ORDER BY txn_date DESC NULLS LAST, merchant, receipt_id, line_no NULLS LAST`,
    [clientId, startDate, endDate, category],
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
  }>(
    `SELECT bt.id, bt.txn_date, bt.description, bt.amount, bt.disposition, bt.triage,
            cat.name AS category_name, bt.disposition_note, bt.resolution_reason
     FROM bank_transactions bt
     LEFT JOIN categories cat ON cat.id = bt.category_id AND cat.client_id = bt.client_id
     WHERE bt.client_id = $1
       AND bt.disposition = 'business_expense'
       AND bt.triage = 'no_receipt_required'
       AND LOWER(COALESCE(cat.name, 'uncategorized')) = LOWER($2)`,
    [clientId, category],
  );
  const bankEntries = filterByDateRange(
    bankRows.map((row) => ({
      id: row.id,
      date: row.txn_date ? String(row.txn_date) : null,
      description: row.description,
      amount: Number(row.amount ?? 0),
      category: row.category_name || "uncategorized",
      reason: row.resolution_reason,
      note: row.disposition_note,
    })),
    startDate,
    endDate,
  );

  return c.json({
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
      amount: Math.abs(entry.amount),
      noReceiptReason: entry.reason,
      note: entry.note,
    })),
  });
});
