import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { newId } from "../lib/id";
import {
  QuickBooksClient,
  QuickBooksTokenStore,
  QuickBooksSyncCursorStore,
  QuickBooksAccountMappingStore,
  QuickBooksSyncConflictStore,
  type QuickBooksTokens,
  type QuickBooksAccountMapping,
  type QuickBooksSyncConflict,
} from "../services/quickbooks";

export const quickbooksRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
quickbooksRoutes.use("*", requireSession);
quickbooksRoutes.use("*", requireActiveBeta);

function getQBClient(env: Env, tokens: QuickBooksTokens) {
  const client = new QuickBooksClient({
    clientId: env.QB_CLIENT_ID!,
    clientSecret: env.QB_CLIENT_SECRET!,
    redirectUri: `${env.APP_ORIGIN}/quickbooks/callback`,
    environment: env.QB_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
  });
  client.setTokens(tokens);
  return client;
}

function getTokenStore(db: ReturnType<typeof createDb>) {
  return new QuickBooksTokenStore(db);
}

function getCursorStore(db: ReturnType<typeof createDb>) {
  return new QuickBooksSyncCursorStore(db);
}

function getMappingStore(db: ReturnType<typeof createDb>) {
  return new QuickBooksAccountMappingStore(db);
}

function getConflictStore(db: ReturnType<typeof createDb>) {
  return new QuickBooksSyncConflictStore(db);
}

// Check if QB is connected
quickbooksRoutes.get("/status", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const tokenStore = getTokenStore(db);
  const tokens = await tokenStore.getTokens(firm.id);

  if (!tokens) {
    return c.json({ connected: false });
  }

  const client = getQBClient(c.env, tokens);
  try {
    const companyInfo = await client.getCompanyInfo();
    return c.json({
      connected: true,
      realmId: tokens.realmId,
      companyName: companyInfo.companyName,
      expiresAt: tokens.expiresAt,
      isExpired: client.isTokenExpired(),
    });
  } catch {
    return c.json({ connected: true, realmId: tokens.realmId, error: "Failed to fetch company info" });
  }
});

// Start OAuth flow
quickbooksRoutes.get("/connect", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const state = newId("qbs");
  await db.query(
    `INSERT INTO oauth_states (id, firm_id, provider, created_at) VALUES ($1, $2, 'quickbooks', NOW())
     ON CONFLICT (firm_id, provider) DO UPDATE SET id = EXCLUDED.id, created_at = EXCLUDED.created_at`,
    [state, firm.id],
  );

  const client = new QuickBooksClient({
    clientId: c.env.QB_CLIENT_ID!,
    clientSecret: c.env.QB_CLIENT_SECRET!,
    redirectUri: `${c.env.APP_ORIGIN}/quickbooks/callback`,
    environment: c.env.QB_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
  });

  const authUrl = client.getAuthUrl(state);
  return c.redirect(authUrl);
});

// OAuth callback
quickbooksRoutes.get("/callback", async (c) => {
  const db = createDb(c.env);
  const code = c.req.query("code");
  const state = c.req.query("state");
  const realmId = c.req.query("realmId");
  const error = c.req.query("error");

  if (error) {
    return c.redirect(`${c.env.APP_ORIGIN}/settings/integrations?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state || !realmId) {
    return c.redirect(`${c.env.APP_ORIGIN}/settings/integrations?error=missing_params`);
  }

  const [stateRow] = await db.query<any>(
    `SELECT firm_id FROM oauth_states WHERE id = $1 AND provider = 'quickbooks'`,
    [state],
  );
  if (!stateRow) {
    return c.redirect(`${c.env.APP_ORIGIN}/settings/integrations?error=invalid_state`);
  }

  const firmId = stateRow.firm_id;
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  if (firm.id !== firmId) {
    return c.redirect(`${c.env.APP_ORIGIN}/settings/integrations?error=firm_mismatch`);
  }

  const client = new QuickBooksClient({
    clientId: c.env.QB_CLIENT_ID!,
    clientSecret: c.env.QB_CLIENT_SECRET!,
    redirectUri: `${c.env.APP_ORIGIN}/quickbooks/callback`,
    environment: c.env.QB_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
  });

  try {
    const tokens = await client.exchangeCodeForTokens(code);
    tokens.realmId = realmId;

    const tokenStore = getTokenStore(db);
    await tokenStore.saveTokens(firmId, tokens);

    await db.query(`DELETE FROM oauth_states WHERE id = $1`, [state]);

    await db.query(
      `INSERT INTO audit_events (id, firm_id, event, actor_user_id, metadata, created_at)
       VALUES ($1,$2,'quickbooks_connected',$3,$4::jsonb,NOW())`,
      [newId("aud"), firmId, c.get("userId"), JSON.stringify({ realmId })],
    );

    return c.redirect(`${c.env.APP_ORIGIN}/settings/integrations?connected=quickbooks`);
  } catch (err) {
    return c.redirect(`${c.env.APP_ORIGIN}/settings/integrations?error=${encodeURIComponent(err instanceof Error ? err.message : 'Unknown error')}`);
  }
});

// Disconnect
quickbooksRoutes.post("/disconnect", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const tokenStore = getTokenStore(db);
  const tokens = await tokenStore.getTokens(firm.id);

  if (tokens) {
    const client = getQBClient(c.env, tokens);
    try {
      await client.disconnect();
    } catch { /* ignore disconnect errors */ }
  }

  await tokenStore.deleteTokens(firm.id);

  await db.query(
    `INSERT INTO audit_events (id, firm_id, event, actor_user_id, created_at)
     VALUES ($1,$2,'quickbooks_disconnected',$3,NOW())`,
    [newId("aud"), firm.id, c.get("userId")],
  );

  return c.json({ ok: true });
});

// Sync accounts
quickbooksRoutes.post("/sync/accounts", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const tokenStore = getTokenStore(db);
  const tokens = await tokenStore.getTokens(firm.id);
  if (!tokens) return c.json({ error: "QuickBooks not connected" }, 400);

  const client = getQBClient(c.env, tokens);
  const accounts = await client.getAccounts();

  const cursorStore = getCursorStore(db);
  await cursorStore.saveCursor(firm.id, { entityType: 'Account', lastSync: new Date() });

  return c.json({ synced: accounts.length, accounts });
});

// Sync customers
quickbooksRoutes.post("/sync/customers", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const tokenStore = getTokenStore(db);
  const tokens = await tokenStore.getTokens(firm.id);
  if (!tokens) return c.json({ error: "QuickBooks not connected" }, 400);

  const body = z.object({ maxResults: z.number().int().positive().max(5000).default(1000) }).parse(await c.req.json().catch(() => ({})));

  const client = getQBClient(c.env, tokens);
  const customers = await client.getCustomers(body.maxResults);

  const cursorStore = getCursorStore(db);
  await cursorStore.saveCursor(firm.id, { entityType: 'Customer', lastSync: new Date() });

  return c.json({ synced: customers.length, customers });
});

// Sync vendors
quickbooksRoutes.post("/sync/vendors", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const tokenStore = getTokenStore(db);
  const tokens = await tokenStore.getTokens(firm.id);
  if (!tokens) return c.json({ error: "QuickBooks not connected" }, 400);

  const body = z.object({ maxResults: z.number().int().positive().max(5000).default(1000) }).parse(await c.req.json().catch(() => ({})));

  const client = getQBClient(c.env, tokens);
  const vendors = await client.getVendors(body.maxResults);

  const cursorStore = getCursorStore(db);
  await cursorStore.saveCursor(firm.id, { entityType: 'Vendor', lastSync: new Date() });

  return c.json({ synced: vendors.length, vendors });
});

// Sync invoices
quickbooksRoutes.post("/sync/invoices", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const tokenStore = getTokenStore(db);
  const tokens = await tokenStore.getTokens(firm.id);
  if (!tokens) return c.json({ error: "QuickBooks not connected" }, 400);

  const body = z.object({ maxResults: z.number().int().positive().max(2000).default(500) }).parse(await c.req.json().catch(() => ({})));

  const client = getQBClient(c.env, tokens);
  const invoices = await client.getInvoices(body.maxResults);

  const cursorStore = getCursorStore(db);
  await cursorStore.saveCursor(firm.id, { entityType: 'Invoice', lastSync: new Date() });

  return c.json({ synced: invoices.length, invoices });
});

// Sync bills
quickbooksRoutes.post("/sync/bills", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const tokenStore = getTokenStore(db);
  const tokens = await tokenStore.getTokens(firm.id);
  if (!tokens) return c.json({ error: "QuickBooks not connected" }, 400);

  const body = z.object({ maxResults: z.number().int().positive().max(2000).default(500) }).parse(await c.req.json().catch(() => ({})));

  const client = getQBClient(c.env, tokens);
  const bills = await client.getBills(body.maxResults);

  const cursorStore = getCursorStore(db);
  await cursorStore.saveCursor(firm.id, { entityType: 'Bill', lastSync: new Date() });

  return c.json({ synced: bills.length, bills });
});

// Sync journal entries
quickbooksRoutes.post("/sync/journal-entries", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const tokenStore = getTokenStore(db);
  const tokens = await tokenStore.getTokens(firm.id);
  if (!tokens) return c.json({ error: "QuickBooks not connected" }, 400);

  const body = z.object({ maxResults: z.number().int().positive().max(2000).default(500) }).parse(await c.req.json().catch(() => ({})));

  const client = getQBClient(c.env, tokens);
  const entries = await client.getJournalEntries(body.maxResults);

  const cursorStore = getCursorStore(db);
  await cursorStore.saveCursor(firm.id, { entityType: 'JournalEntry', lastSync: new Date() });

  return c.json({ synced: entries.length, entries });
});

// Full sync (all entities)
quickbooksRoutes.post("/sync/all", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const tokenStore = getTokenStore(db);
  const tokens = await tokenStore.getTokens(firm.id);
  if (!tokens) return c.json({ error: "QuickBooks not connected" }, 400);

  const client = getQBClient(c.env, tokens);
  const cursorStore = getCursorStore(db);

  const results = await Promise.allSettled([
    client.getAccounts().then(a => ({ entity: 'Account', count: a.length })),
    client.getCustomers(1000).then(c => ({ entity: 'Customer', count: c.length })),
    client.getVendors(1000).then(v => ({ entity: 'Vendor', count: v.length })),
    client.getInvoices(500).then(i => ({ entity: 'Invoice', count: i.length })),
    client.getBills(500).then(b => ({ entity: 'Bill', count: b.length })),
    client.getJournalEntries(500).then(j => ({ entity: 'JournalEntry', count: j.length })),
  ]);

  for (const result of results) {
    if (result.status === 'fulfilled') {
      await cursorStore.saveCursor(firm.id, { entityType: result.value.entity, lastSync: new Date() });
    }
  }

  return c.json({
    results: results.map(r => r.status === 'fulfilled' ? r.value : { entity: 'unknown', error: r.reason?.message }),
  });
});

// Get sync cursors
quickbooksRoutes.get("/sync/cursors", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const cursorStore = getCursorStore(db);
  const entities = ['Account', 'Customer', 'Vendor', 'Invoice', 'Bill', 'JournalEntry'];
  const cursors = await Promise.all(entities.map(async (e) => {
    const cursor = await cursorStore.getCursor(firm.id, e);
    return cursor ? { ...cursor, entityType: e } : { entityType: e, lastSync: null, lastChangeId: null };
  }));

  return c.json({ cursors });
});

// Account mappings
quickbooksRoutes.get("/mappings", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const mappingStore = getMappingStore(db);
  const mappings = await mappingStore.getAllMappings(firm.id);

  return c.json({ mappings });
});

quickbooksRoutes.post("/mappings", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const body = z.object({
    folioAccountId: z.string(),
    qboAccountId: z.string(),
    mappingType: z.enum(['direct', 'category', 'default']).default('direct'),
  }).parse(await c.req.json());

  const mappingStore = getMappingStore(db);
  await mappingStore.saveMapping(firm.id, {
    folioAccountId: body.folioAccountId,
    qboAccountId: body.qboAccountId,
    mappingType: body.mappingType,
  });

  return c.json({ ok: true });
});

quickbooksRoutes.delete("/mappings/:folioAccountId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  await db.query(
    `DELETE FROM quickbooks_account_mappings WHERE firm_id = $1 AND folio_account_id = $2`,
    [firm.id, c.req.param("folioAccountId")],
  );

  return c.json({ ok: true });
});

// Conflicts
quickbooksRoutes.get("/conflicts", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const conflictStore = getConflictStore(db);
  const conflicts = await conflictStore.getPendingConflicts(firm.id);

  return c.json({ conflicts });
});

quickbooksRoutes.post("/conflicts/:conflictId/resolve", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const body = z.object({
    resolution: z.enum(['folio_wins', 'qbo_wins', 'merged']),
    mergedData: z.any().optional(),
  }).parse(await c.req.json());

  const conflictStore = getConflictStore(db);
  await conflictStore.resolveConflict(c.req.param("conflictId"), body.resolution, c.get("userId"), body.mergedData);

  return c.json({ ok: true });
});

// Reports
quickbooksRoutes.get("/reports/profit-and-loss", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const tokenStore = getTokenStore(db);
  const tokens = await tokenStore.getTokens(firm.id);
  if (!tokens) return c.json({ error: "QuickBooks not connected" }, 400);

  const query = z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).parse(c.req.query());

  const client = getQBClient(c.env, tokens);
  const report = await client.getProfitAndLoss(query.startDate, query.endDate);

  return c.json({ report });
});

quickbooksRoutes.get("/reports/balance-sheet", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const tokenStore = getTokenStore(db);
  const tokens = await tokenStore.getTokens(firm.id);
  if (!tokens) return c.json({ error: "QuickBooks not connected" }, 400);

  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(c.req.query("date"));

  const client = getQBClient(c.env, tokens);
  const report = await client.getBalanceSheet(date);

  return c.json({ report });
});

quickbooksRoutes.get("/reports/trial-balance", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const tokenStore = getTokenStore(db);
  const tokens = await tokenStore.getTokens(firm.id);
  if (!tokens) return c.json({ error: "QuickBooks not connected" }, 400);

  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(c.req.query("date"));

  const client = getQBClient(c.env, tokens);
  const report = await client.getTrialBalance(date);

  return c.json({ report });
});

// Create invoice in QBO
quickbooksRoutes.post("/invoices", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const tokenStore = getTokenStore(db);
  const tokens = await tokenStore.getTokens(firm.id);
  if (!tokens) return c.json({ error: "QuickBooks not connected" }, 400);

  const body = z.object({
    CustomerRef: z.object({ value: z.string() }),
    TxnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    DueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    Line: z.array(z.object({
      Id: z.string().default("0"),
      LineNum: z.number().int().positive(),
      Description: z.string(),
      Amount: z.number(),
      DetailType: z.literal('SalesItemLineDetail'),
      SalesItemLineDetail: z.object({
        ItemRef: z.object({ value: z.string() }),
        UnitPrice: z.number(),
        Qty: z.number(),
        TaxCodeRef: z.object({ value: z.string() }).default({ value: "NON" }),
      }),
    })),
  }).parse(await c.req.json());

  const client = getQBClient(c.env, tokens);
  const invoice = await client.createInvoice(body);

  return c.json({ invoice }, 201);
});

// Create bill in QBO
quickbooksRoutes.post("/bills", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const tokenStore = getTokenStore(db);
  const tokens = await tokenStore.getTokens(firm.id);
  if (!tokens) return c.json({ error: "QuickBooks not connected" }, 400);

  const body = z.object({
    VendorRef: z.object({ value: z.string() }),
    TxnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    DueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    Line: z.array(z.object({
      Id: z.string().default("0"),
      LineNum: z.number().int().positive(),
      Description: z.string(),
      Amount: z.number(),
      DetailType: z.literal('AccountBasedExpenseLineDetail'),
      AccountBasedExpenseLineDetail: z.object({
        AccountRef: z.object({ value: z.string() }),
        UnitPrice: z.number(),
        Qty: z.number(),
        TaxCodeRef: z.object({ value: z.string() }).default({ value: "NON" }),
      }),
    })),
  }).parse(await c.req.json());

  const client = getQBClient(c.env, tokens);
  const bill = await client.createBill(body);

  return c.json({ bill }, 201);
});

// Create journal entry in QBO
quickbooksRoutes.post("/journal-entries", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const tokenStore = getTokenStore(db);
  const tokens = await tokenStore.getTokens(firm.id);
  if (!tokens) return c.json({ error: "QuickBooks not connected" }, 400);

  const body = z.object({
    TxnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    Line: z.array(z.object({
      Id: z.string().default("0"),
      LineNum: z.number().int().positive(),
      Description: z.string(),
      Amount: z.number(),
      DetailType: z.literal('JournalEntryLineDetail'),
      JournalEntryLineDetail: z.object({
        PostingType: z.enum(['Debit', 'Credit']),
        AccountRef: z.object({ value: z.string() }),
      }),
    })),
  }).parse(await c.req.json());

  const client = getQBClient(c.env, tokens);
  const entry = await client.createJournalEntry(body);

  return c.json({ entry }, 201);
});