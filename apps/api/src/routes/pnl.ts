import { Hono } from "hono";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";

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
 * hiding receipt-level amounts inside item rows.
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
)`;

pnlRoutes.get("/:clientId/pnl", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const rows = await db.query<{ category: string; count: number; receipt_count: number; total: number }>(
    `${expenseLinesCte}
     SELECT category, COUNT(*)::int AS count, COUNT(DISTINCT receipt_id)::int AS receipt_count,
            COALESCE(SUM(amount), 0)::numeric AS total
     FROM expense_lines
     GROUP BY category
     ORDER BY total DESC, category`,
    [clientId],
  );
  const expenses = rows.reduce((sum, row) => sum + Number(row.total || 0), 0);

  return c.json({
    period: c.req.query("period") || "ledger",
    currency: "USD",
    income: 0,
    expenses,
    net: -expenses,
    byCategory: rows.map((row) => ({
      category: row.category,
      count: Number(row.count),
      receiptCount: Number(row.receipt_count),
      total: Number(row.total),
    })),
    note: "Filed evidence only. Line items plus visible receipt-level adjustments reconcile each receipt to its approved grand total.",
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
     WHERE category = $2
     ORDER BY txn_date DESC NULLS LAST, merchant, receipt_id, line_no NULLS LAST`,
    [clientId, category],
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
  });
});

// Ledger-backed P&L (new canonical source)
pnlRoutes.get("/:clientId/pnl/ledger", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const period = c.req.query("period") || null;
  const periodWhere = period ? "AND le.period_key = $2" : "";
  const params = [clientId];
  if (period) params.push(period);

  const incomeRows = await db.query<{ category_id: string; category_name: string; category_slug: string; total: string; count: string }>(
    `SELECT
       c.id AS category_id,
       c.name AS category_name,
       c.slug AS category_slug,
       COALESCE(SUM(le.amount), 0)::numeric AS total,
       COUNT(*)::int AS count
     FROM ledger_entries le
     LEFT JOIN categories c ON c.id = le.category_id
     WHERE le.client_id = $1
       AND le.treatment = 'business'
       AND le.accounting_class = 'income'
       ${periodWhere}
     GROUP BY c.id, c.name, c.slug
     ORDER BY total DESC`,
    params,
  );

  const expenseRows = await db.query<{ category_id: string; category_name: string; category_slug: string; total: string; count: string }>(
    `SELECT
       c.id AS category_id,
       c.name AS category_name,
       c.slug AS category_slug,
       COALESCE(SUM(le.amount), 0)::numeric AS total,
       COUNT(*)::int AS count
     FROM ledger_entries le
     LEFT JOIN categories c ON c.id = le.category_id
     WHERE le.client_id = $1
       AND le.treatment = 'business'
       AND le.accounting_class = 'expense'
       ${periodWhere}
     GROUP BY c.id, c.name, c.slug
     ORDER BY total DESC`,
    params,
  );

  const income = incomeRows.reduce((sum, row) => sum + Number(row.total), 0);
  const expenses = expenseRows.reduce((sum, row) => sum + Number(row.total), 0);

  return c.json({
    period: period || "all",
    currency: "USD",
    income,
    expenses,
    net: income - expenses,
    byCategory: {
      income: incomeRows.map((row) => ({
        categoryId: row.category_id,
        category: row.category_name,
        slug: row.category_slug,
        total: Number(row.total),
        count: Number(row.count),
      })),
      expense: expenseRows.map((row) => ({
        categoryId: row.category_id,
        category: row.category_name,
        slug: row.category_slug,
        total: Number(row.total),
        count: Number(row.count),
      })),
    },
    note: "Built from canonical ledger. Business income/expense only. Transfers, owner contributions/draws, and personal items excluded.",
  });
});

pnlRoutes.get("/:clientId/pnl/ledger/drilldown", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const categoryId = c.req.query("categoryId");
  const accountingClass = c.req.query("class");
  const period = c.req.query("period") || null;

  if (!categoryId || !accountingClass) {
    return c.json({ error: "categoryId and class (income|expense) are required" }, 400);
  }

  const periodWhere = period ? "AND le.period_key = $4" : "";
  const params = [clientId, categoryId, accountingClass];
  if (period) params.push(period);

  const entries = await db.query<Record<string, unknown>>(
    `SELECT
       le.*,
       c.name AS category_name,
       c.slug AS category_slug,
       bt.id AS bank_id,
       bt.description AS bank_description,
       bt.txn_date AS bank_date,
       r.id AS receipt_id,
       r.extracted_merchant AS receipt_merchant,
       r.extracted_total AS receipt_total,
       r.extracted_date AS receipt_date,
       r.filename AS receipt_filename
     FROM ledger_entries le
     LEFT JOIN categories c ON c.id = le.category_id
     LEFT JOIN bank_transactions bt ON bt.id = le.source_bank_transaction_id
     LEFT JOIN receipts r ON r.id = le.source_receipt_id
     WHERE le.client_id = $1
       AND le.category_id = $2
       AND le.accounting_class = $3
       AND le.treatment = 'business'
       ${periodWhere}
     ORDER BY le.entry_date DESC NULLS LAST, le.created_at DESC`,
    params,
  );

  return c.json({
    categoryId,
    accountingClass,
    entries: entries.map((entry) => ({
      id: entry.id,
      date: entry.entry_date,
      description: entry.description,
      amount: Number(entry.amount),
      currency: entry.currency,
      category: entry.category_name,
      source: {
        bankTransaction: entry.bank_id ? {
          id: entry.bank_id,
          description: entry.bank_description,
          date: entry.bank_date,
        } : null,
        receipt: entry.receipt_id ? {
          id: entry.receipt_id,
          merchant: entry.receipt_merchant,
          total: entry.receipt_total ? Number(entry.receipt_total) : null,
          date: entry.receipt_date,
          filename: entry.receipt_filename,
          sourceUrl: `/api/clients/${clientId}/receipts/${entry.receipt_id}/source`,
        } : null,
      },
    })),
  });
});
