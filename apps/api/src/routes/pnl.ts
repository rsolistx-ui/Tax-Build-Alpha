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
 * Build P&L from the canonical ledger.
 * Only business income and business expense enter operating P&L.
 * Transfers, owner contributions, owner draws, and personal items are excluded.
 * A reconciled bank transaction + receipt counts exactly once.
 * Optional period filter: ?period=YYYY-MM
 */
pnlRoutes.get("/:clientId/pnl", async (c) => {
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
    note: "Built from canonical ledger. Business income/expense only. Transfers, owner contributions/draws, and personal items excluded. Each reconciled bank+receipt counts once.",
  });
});

/**
 * Drilldown from ledger-backed P&L.
 * Traces each ledger row to its source evidence (bank transaction, receipt, or both).
 * Query params: categoryId, class (income|expense), period (optional YYYY-MM)
 */
pnlRoutes.get("/:clientId/pnl/drilldown", async (c) => {
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