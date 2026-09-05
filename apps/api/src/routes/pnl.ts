import { Hono } from "hono";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";

/** Placeholder P&L aggregation from reviewed/filed receipts — full export in later days. */
export const pnlRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

pnlRoutes.use("*", requireSession);

pnlRoutes.get("/:clientId/pnl", async (c) => {
  const firm = await ensureFirm(c.env.DB, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(c.env.DB, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const period = c.req.query("period") || "monthly"; // monthly | yearly
  const { results } = await c.env.DB.prepare(
    `SELECT
       COALESCE(extracted_category, 'uncategorized') AS category,
       COUNT(*) AS count,
       COALESCE(SUM(extracted_amount), 0) AS total
     FROM receipts
     WHERE client_id = ? AND status IN ('review', 'filed')
       AND extracted_amount IS NOT NULL
     GROUP BY COALESCE(extracted_category, 'uncategorized')
     ORDER BY total DESC`,
  )
    .bind(clientId)
    .all();

  const rows = (results ?? []) as { category: string; count: number; total: number }[];
  const expenseTotal = rows.reduce((s, r) => s + Number(r.total || 0), 0);

  return c.json({
    period,
    currency: "USD",
    income: 0,
    expenses: expenseTotal,
    net: -expenseTotal,
    byCategory: rows,
    note: "Alpha placeholder — bank CSV income + PDF/Excel export land in Days 3–10.",
  });
});
