import { Hono } from "hono";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { getClientProfile } from "../services/client-profile";
import { assemblePnlReport } from "../services/reporting";
import { computeDifAuditReport, type DifInputData } from "../services/dif-audit-scanner";
import { newId } from "../lib/id";

export const difAuditRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

difAuditRoutes.get("/:clientId/dif-audit", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const profile = await getClientProfile(db, clientId);

  // 1. Gather canonical P&L report
  const pnl = await assemblePnlReport(db, clientId, null, null);

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

  const grossRevenue = "income" in pnl ? Number(pnl.income) : 0;
  const totalExpenses = "expenses" in pnl ? Number(pnl.expenses) : 0;
  const netProfit = "net" in pnl ? Number(pnl.net) : 0;
  const expensesByCategory = "categorizedExpenses" in pnl
    ? pnl.categorizedExpenses.map((cat: { category: string; total: number }) => ({
        categoryName: cat.category,
        amount: cat.total,
      }))
    : [];

  const inputData: DifInputData = {
    grossRevenue,
    totalExpenses,
    netProfit,
    expensesByCategory,
    transactions: txRows.map((t) => ({
      id: t.id,
      date: t.date,
      amount: Number(t.amount),
      description: t.description || "",
      categoryName: t.category_name,
      disposition: t.disposition,
      hasReceipt: Boolean(t.has_receipt),
    })),
    industry: profile?.industry || null,
  };

  const report = computeDifAuditReport(inputData);

  return c.json({
    report,
    clientName: client.name,
    legalName: client.legal_name,
    taxYear: profile?.tax_year || new Date().getFullYear(),
    industry: profile?.industry || "General Small Business",
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
  const profile = await getClientProfile(db, clientId);
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
        taxYear: profile?.tax_year || new Date().getFullYear(),
        memoLength: memoText.length,
        savedBy: c.get("userName"),
      }),
    ],
  );

  return c.json({
    ok: true,
    eventId,
    message: "Pre-filing review notes saved to the audit log.",
  });
});
