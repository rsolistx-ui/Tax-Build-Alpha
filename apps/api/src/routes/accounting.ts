import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { getEngagement } from "../services/engagements";
import { FolioNativeAccountingProvider, getDefaultChartOfAccountsTemplate } from "../services/folio-native-accounting";
import { newId } from "../lib/id";

export const accountingRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
accountingRoutes.use("*", requireSession);
accountingRoutes.use("*", requireActiveBeta);

function getProvider(db: ReturnType<typeof createDb>) {
  return new FolioNativeAccountingProvider(db);
}

const accountSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(200),
  type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
  subtype: z.string().optional(),
  parentId: z.string().optional(),
  isSystem: z.boolean().default(false),
  normalBalance: z.enum(['debit', 'credit']),
  description: z.string().max(500).optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

const journalSchema = z.object({
  clientId: z.string().optional(),
  engagementId: z.string().optional(),
  sourceType: z.string().min(1),
  sourceId: z.string().optional(),
  memo: z.string().max(1000).optional(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z.array(z.object({
    accountId: z.string(),
    description: z.string().max(500).optional(),
    debit: z.number().min(0).default(0),
    credit: z.number().min(0).default(0),
    currency: z.string().default('USD'),
    exchangeRate: z.number().positive().default(1),
  })).min(2),
});

const reconciliationSchema = z.object({
  clientId: z.string(),
  accountId: z.string(),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bankBalance: z.number(),
  ledgerBalance: z.number(),
  notes: z.string().max(1000).optional(),
});

// Chart of Accounts
accountingRoutes.get("/accounts", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const type = c.req.query("type") as string | undefined;

  const provider = getProvider(db);
  const accounts = await provider.listAccounts(firm.id, type);
  return c.json({ accounts });
});

accountingRoutes.get("/accounts/seed", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const template = getDefaultChartOfAccountsTemplate();
  return c.json({ template });
});

accountingRoutes.post("/accounts/seed", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const provider = getProvider(db);
  const accounts = await provider.seedDefaultChartOfAccounts(firm.id);
  return c.json({ accounts, count: accounts.length });
});

accountingRoutes.get("/accounts/:accountId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const provider = getProvider(db);
  const account = await provider.getAccount(firm.id, c.req.param("accountId"));
  if (!account) return c.json({ error: "Not found" }, 404);
  return c.json({ account });
});

accountingRoutes.post("/accounts", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = accountSchema.parse(await c.req.json());

  const provider = getProvider(db);
  const account = await provider.createAccount(firm.id, body);
  return c.json({ account }, 201);
});

accountingRoutes.patch("/accounts/:accountId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = accountSchema.partial().parse(await c.req.json());

  const provider = getProvider(db);
  const account = await provider.updateAccount(firm.id, c.req.param("accountId"), body);
  return c.json({ account });
});

accountingRoutes.delete("/accounts/:accountId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const provider = getProvider(db);
  await provider.deleteAccount(firm.id, c.req.param("accountId"));
  return c.json({ ok: true });
});

// Journals
accountingRoutes.get("/journals", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const query = z.object({
    clientId: z.string().optional(),
    status: z.enum(['draft', 'posted', 'reversed']).optional(),
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).parse(c.req.query());

  const provider = getProvider(db);
  const journals = await provider.listJournals(firm.id, {
    clientId: query.clientId,
    status: query.status,
    periodStart: query.periodStart ? new Date(query.periodStart) : undefined,
    periodEnd: query.periodEnd ? new Date(query.periodEnd) : undefined,
  });
  return c.json({ journals });
});

accountingRoutes.get("/journals/:journalId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const provider = getProvider(db);
  const journal = await provider.getJournal(firm.id, c.req.param("journalId"));
  if (!journal) return c.json({ error: "Not found" }, 404);
  return c.json({ journal });
});

accountingRoutes.post("/journals", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = journalSchema.parse(await c.req.json());

  if (body.clientId) {
    const client = await getClient(db, body.clientId, firm.id);
    if (!client) return c.json({ error: "Client not found" }, 404);
  }
  if (body.engagementId) {
    const engagement = await getEngagement(db, body.engagementId, firm.id);
    if (!engagement) return c.json({ error: "Engagement not found" }, 404);
  }

  const provider = getProvider(db);
  const journal = await provider.createJournal(firm.id, {
    firmId: firm.id,
    clientId: body.clientId,
    engagementId: body.engagementId,
    sourceType: body.sourceType,
    sourceId: body.sourceId,
    memo: body.memo,
    periodStart: new Date(body.periodStart),
    periodEnd: new Date(body.periodEnd),
    status: 'draft',
    lines: body.lines,
  });

  await db.query(
    `INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at)
     VALUES ($1,$2,$3,'journal_created',$4,$5::jsonb,NOW())`,
    [newId("aud"), firm.id, body.clientId ?? null, c.get("userId"), JSON.stringify({ journalId: journal.id, sourceType: body.sourceType })],
  );

  return c.json({ journal }, 201);
});

accountingRoutes.post("/journals/:journalId/post", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const provider = getProvider(db);
  const journal = await provider.postJournal(firm.id, c.req.param("journalId"), c.get("userId"));

  await db.query(
    `INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at)
     VALUES ($1,$2,$3,'journal_posted',$4,$5::jsonb,NOW())`,
    [newId("aud"), firm.id, journal.clientId ?? null, c.get("userId"), JSON.stringify({ journalId: journal.id })],
  );

  return c.json({ journal });
});

accountingRoutes.post("/journals/:journalId/reverse", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = z.object({ memo: z.string().min(1).max(500) }).parse(await c.req.json());

  const provider = getProvider(db);
  const journal = await provider.reverseJournal(firm.id, c.req.param("journalId"), c.get("userId"), body.memo);

  await db.query(
    `INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at)
     VALUES ($1,$2,$3,'journal_reversed',$4,$5::jsonb,NOW())`,
    [newId("aud"), firm.id, journal.clientId ?? null, c.get("userId"), JSON.stringify({ journalId: journal.id, reversedJournalId: c.req.param("journalId"), memo: body.memo })],
  );

  return c.json({ journal });
});

// Trial Balance & Balance Sheet
accountingRoutes.get("/trial-balance", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const query = z.object({
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    clientId: z.string().optional(),
  }).parse(c.req.query());

  if (query.clientId) {
    const client = await getClient(db, query.clientId, firm.id);
    if (!client) return c.json({ error: "Client not found" }, 404);
  }

  const provider = getProvider(db);
  const trialBalance = await provider.getTrialBalance(firm.id, query.clientId, new Date(query.periodEnd));

  const totals = trialBalance.reduce((acc, e) => ({
    debit: acc.debit + e.debitBalance,
    credit: acc.credit + e.creditBalance,
    net: acc.net + e.netBalance,
  }), { debit: 0, credit: 0, net: 0 });

  return c.json({ trialBalance, totals, periodEnd: query.periodEnd });
});

accountingRoutes.get("/balance-sheet", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const query = z.object({
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    clientId: z.string().optional(),
  }).parse(c.req.query());

  if (query.clientId) {
    const client = await getClient(db, query.clientId, firm.id);
    if (!client) return c.json({ error: "Client not found" }, 404);
  }

  const provider = getProvider(db);
  const balanceSheet = await provider.getBalanceSheet(firm.id, query.clientId, new Date(query.periodEnd));

  const totals = {
    assets: balanceSheet.assets.reduce((s, e) => s + e.balance, 0),
    liabilities: balanceSheet.liabilities.reduce((s, e) => s + e.balance, 0),
    equity: balanceSheet.equity.reduce((s, e) => s + e.balance, 0),
  };

  return c.json({ balanceSheet, totals, periodEnd: query.periodEnd });
});

// Period Close
accountingRoutes.post("/period-close", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const body = z.object({
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    clientId: z.string().optional(),
  }).parse(await c.req.json());

  if (body.clientId) {
    const client = await getClient(db, body.clientId, firm.id);
    if (!client) return c.json({ error: "Client not found" }, 404);
  }

  const provider = getProvider(db);
  const periodClose = await provider.closePeriod(firm.id, body.clientId, new Date(body.periodEnd), c.get("userId"));

  await db.query(
    `INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at)
     VALUES ($1,$2,$3,'period_closed',$4,$5::jsonb,NOW())`,
    [newId("aud"), firm.id, body.clientId ?? null, c.get("userId"), JSON.stringify({ periodEnd: body.periodEnd })],
  );

  return c.json({ periodClose });
});

accountingRoutes.post("/period-reopen", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const body = z.object({
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    clientId: z.string().optional(),
  }).parse(await c.req.json());

  const provider = getProvider(db);
  const periodClose = await provider.reopenPeriod(firm.id, body.clientId, new Date(body.periodEnd), c.get("userId"));

  return c.json({ periodClose });
});

// Reconciliation
accountingRoutes.get("/reconciliations", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const query = z.object({
    clientId: z.string(),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).parse(c.req.query());

  const client = await getClient(db, query.clientId, firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const provider = getProvider(db);
  const reconciliations = await provider.listReconciliations(firm.id, client.id, query.periodEnd ? new Date(query.periodEnd) : undefined);

  return c.json({ reconciliations });
});

accountingRoutes.post("/reconciliations", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = reconciliationSchema.parse(await c.req.json());

  const client = await getClient(db, body.clientId, firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const provider = getProvider(db);
  const reconciliation = await provider.createReconciliation({
    firmId: firm.id,
    clientId: body.clientId,
    accountId: body.accountId,
    periodEnd: new Date(body.periodEnd),
    bankBalance: body.bankBalance,
    ledgerBalance: body.ledgerBalance,
    status: 'open',
    notes: body.notes,
  });

  return c.json({ reconciliation }, 201);
});

accountingRoutes.get("/reconciliations/:reconciliationId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const provider = getProvider(db);
  // Need to get the reconciliation first to know clientId/accountId/periodEnd
  // For now, return error - would need a different lookup
  return c.json({ error: "Use list endpoint with filters" }, 400);
});

accountingRoutes.patch("/reconciliations/:reconciliationId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = reconciliationSchema.partial().parse(await c.req.json());

  // This is a simplified implementation - would need proper lookup
  return c.json({ error: "Not fully implemented" }, 501);
});

// System Accounts
accountingRoutes.get("/system-accounts", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const provider = getProvider(db);
  const keys = ['retained_earnings', 'ar_control', 'ap_control', 'cash_undeposited_funds', 'sales_tax_payable', 'payroll_tax_payable'];
  const accounts = await Promise.all(keys.map(k => provider.getSystemAccount(firm.id, k)));
  return c.json({ systemAccounts: accounts.filter(a => a !== undefined) });
});

accountingRoutes.post("/system-accounts/:key", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const key = c.req.param("key");
  const body = z.object({ accountId: z.string() }).parse(await c.req.json());

  const provider = getProvider(db);
  await provider.setSystemAccount(firm.id, key, body.accountId);
  return c.json({ ok: true });
});