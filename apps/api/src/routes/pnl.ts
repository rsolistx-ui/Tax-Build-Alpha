import { Hono } from "hono";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";

export const pnlRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
pnlRoutes.use("*", requireSession);

const expenseLinesCte = `
WITH expense_lines AS (
  SELECT
    r.id AS receipt_id,
    r.extracted_date AS txn_date,
    r.extracted_merchant AS merchant,
    r.filename,
    li.line_no,
    li.description,
    COALESCE(NULLIF(li.category, ''), NULLIF(r.extracted_category, ''), 'uncategorized') AS category,
    COALESCE(li.amount, 0) AS amount
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
    '(receipt total)' AS description,
    COALESCE(NULLIF(r.extracted_category, ''), 'uncategorized') AS category,
    COALESCE(r.extracted_total, 0) AS amount
  FROM receipts r
  WHERE r.client_id = $1 AND r.status = 'filed'
    AND NOT EXISTS (SELECT 1 FROM receipt_line_items li WHERE li.receipt_id = r.id)
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
    note: "Filed receipt line items only. Every P&L amount can be traced back to source evidence.",
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
