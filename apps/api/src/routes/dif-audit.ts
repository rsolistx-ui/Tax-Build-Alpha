import { Hono } from "hono";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { assemblePnlReport } from "../services/reporting";
import { computeDifAuditReport, type DifInputData } from "../services/dif-audit-scanner";
import { newId } from "../lib/id";

export const difAuditRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
difAuditRoutes.use("*", requireSession);
difAuditRoutes.use("*", requireActiveBeta);

difAuditRoutes.get("/:clientId/dif-audit", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  // 1. Gather canonical P&L report
  const pnl = await assemblePnlReport(db, client, null, null);

  // 2. Query underlying bank transactions for commingling and audit indicators
  const txRows = await db.query<{
    id: string;
    date: string | null;
    amount: number;
    description: string | null;
    category_name: string | null;
    disposition: string;
    has_receipt: boolean;
  }>(
    `SELECT bt.id, bt.txn_date AS date, bt.amount, bt.description, c.name AS category_name, bt.disposition,
            (bt.matched_receipt_id IS NOT NULL OR bt.triage = 'matched') AS has_receipt
     FROM bank_transactions bt
     LEFT JOIN categories c ON c.id = bt.category_id
     WHERE bt.client_id = $1
     ORDER BY bt.txn_date DESC
     LIMIT 1000`,
    [clientId],
  );

  const inputData: DifInputData = {
    grossRevenue: pnl.summary.totalIncome,
    totalExpenses: pnl.summary.totalExpenses,
    netProfit: pnl.summary.netProfit,
    expensesByCategory: pnl.categories.map((cat) => ({
      categoryName: cat.category,
      amount: cat.expenses,
    })),
    transactions: txRows.map((t) => ({
      id: t.id,
      date: t.date,
      amount: Number(t.amount),
      description: t.description || "",
      categoryName: t.category_name,
      disposition: t.disposition,
      hasReceipt: Boolean(t.has_receipt),
    })),
    industry: client.industry || null,
  };

  const report = computeDifAuditReport(inputData);

  return c.json({
    report,
    clientName: client.name,
    legalName: client.legal_name,
    taxYear: client.tax_year || new Date().getFullYear(),
    industry: client.industry || "General Small Business",
  });
});

difAuditRoutes.post("/:clientId/dif-audit/memo", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const memoText = typeof body.memoText === "string" ? body.memoText : "";

  if (!memoText.trim()) {
    return c.json({ error: "Memo content is required" }, 400);
  }

  // Record audit event in compliance vault
  const eventId = newId("audit");
  await db.query(
    `INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at)
     VALUES ($1, $2, $3, 'circular_230_defense_memo_generated', $4, $5::jsonb, NOW())`,
    [
      eventId,
      firm.id,
      client.id,
      c.get("userId"),
      JSON.stringify({
        taxYear: client.tax_year || new Date().getFullYear(),
        memoLength: memoText.length,
        certifiedBy: c.get("userName"),
      }),
    ],
  );

  return c.json({
    ok: true,
    eventId,
    message: "Treasury Circular 230 Due Diligence Defense Memorandum permanently logged in audit vault.",
  });
});
