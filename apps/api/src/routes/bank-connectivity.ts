import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { newId } from "../lib/id";
import type { Db } from "../db";
import { TellerBankFeedProvider } from "../services/teller-provider";
import { PlaidBankFeedProvider } from "../services/plaid-provider";
import {
  BankConnectionService,
  BankAccountService,
  BankTransactionService,
  BankSyncCursorService,
  BankFeedProvider,
} from "../services/bank-feed";
import type {
  BankConnection,
  BankAccount,
  BankTransaction,
  BankFeedSyncResult,
} from "../services/bank-feed";

export const bankConnectivityRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
bankConnectivityRoutes.use("*", requireSession);
bankConnectivityRoutes.use("*", requireActiveBeta);

// Provider instances (lazy-initialized)
function getTellerProvider(env: Env) {
  if (!env.TELLER_CLIENT_ID || !env.TELLER_CLIENT_SECRET) {
    throw new Error('Teller credentials not configured');
  }
  return new TellerBankFeedProvider({
    clientId: env.TELLER_CLIENT_ID,
    clientSecret: env.TELLER_CLIENT_SECRET,
    redirectUri: `${env.APP_ORIGIN}/bank/connect/callback`,
    environment: env.TELLER_ENVIRONMENT || 'sandbox',
  });
}

function getPlaidProvider(env: Env) {
  if (!env.PLAID_CLIENT_ID || !env.PLAID_CLIENT_SECRET) {
    throw new Error('Plaid credentials not configured');
  }
  return new PlaidBankFeedProvider({
    clientId: env.PLAID_CLIENT_ID,
    clientSecret: env.PLAID_CLIENT_SECRET,
    redirectUri: `${env.APP_ORIGIN}/bank/connect/callback`,
    environment: env.PLAID_ENVIRONMENT || 'sandbox',
  });
}

function getProvider(env: Env, provider: string) {
  switch (provider) {
    case 'teller': return getTellerProvider(env);
    case 'plaid': return getPlaidProvider(env);
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}

// Create a link token for the bank connect flow
bankConnectivityRoutes.post("/connect/link-token", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = z.object({
    provider: z.enum(['teller', 'plaid']),
    clientId: z.string().optional(),
    products: z.array(z.enum(['transactions', 'auth', 'identity', 'balance', 'assets', 'investments', 'liabilities'])).default(['transactions']),
    countryCodes: z.array(z.string()).default(['US']),
    language: z.string().default('en'),
    redirectUri: z.string().url().optional(),
    webhookUrl: z.string().url().optional(),
  }).parse(await c.req.json());

  const provider = getProvider(c.env, body.provider);
  const result = await provider.createLinkToken({
    firmId: firm.id,
    clientId: body.clientId,
    userId: c.get("userId"),
    clientName: firm.name,
    products: body.products,
    countryCodes: body.countryCodes,
    language: body.language,
    redirectUri: body.redirectUri,
    webhookUrl: body.webhookUrl,
  });

  return c.json(result);
});

// Exchange public token for access token
bankConnectivityRoutes.post("/connect/exchange", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = z.object({
    provider: z.enum(['teller', 'plaid']),
    publicToken: z.string(),
    clientId: z.string().optional(),
  }).parse(await c.req.json());

  const provider = getProvider(c.env, body.provider);
  const result = await provider.exchangePublicToken(body.publicToken);

  // Get institution info
  let institutionName = "Unknown";
  let institutionId = "unknown";
  let institutionLogo = "";

  // For now, use first account's institution
  // In production, you'd fetch institution details from provider

  // Save connection
  const connectionService = new BankConnectionService(createDb(c.env));
  const connection = await connectionService.createConnection({
    firmId: firm.id,
    clientId: body.clientId,
    provider: body.provider,
    providerConnectionId: result.accessToken,
    institutionId: institutionId,
    institutionName: institutionName,
    institutionLogo: institutionLogo,
    status: 'active',
    accounts: result.accounts.map(acc => ({
      id: newId("bac"),
      providerAccountId: acc.providerAccountId,
      name: acc.name,
      officialName: acc.officialName,
      type: acc.type,
      subtype: acc.subtype,
      mask: acc.mask,
      currentBalance: acc.currentBalance,
      availableBalance: acc.availableBalance,
      currency: acc.currency,
      status: acc.status,
      isVisible: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  });

  // Save accounts
  const accountService = new BankAccountService(createDb(c.env));
  await accountService.upsertAccounts(connection.id, connection.accounts);

  return c.json({ connection });
});

// List connections
bankConnectivityRoutes.get("/connections", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const connectionService = new BankConnectionService(db);
  const connections = await connectionService.getConnectionsByFirm(firm.id);
  return c.json({ connections });
});

// Get connection details
bankConnectivityRoutes.get("/connections/:connectionId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const connectionService = new BankConnectionService(db);
  const connection = await connectionService.getConnection(c.req.param("connectionId"));
  if (!connection || connection.firmId !== firm.id) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.json({ connection });
});

// Update connection (status, visibility, etc.)
bankConnectivityRoutes.patch("/connections/:connectionId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = z.object({
    status: z.enum(['active', 'needs_reauth', 'error', 'disconnected']).optional(),
    errorMessage: z.string().optional(),
  }).parse(await c.req.json());

  const connectionService = new BankConnectionService(db);
  const connection = await connectionService.getConnection(c.req.param("connectionId"));
  if (!connection || connection.firmId !== firm.id) {
    return c.json({ error: "Not found" }, 404);
  }

  const updated = await connectionService.updateConnection(connection.id, body);
  return c.json({ connection: updated });
});

// Delete connection
bankConnectivityRoutes.delete("/connections/:connectionId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const connectionService = new BankConnectionService(db);
  const connection = await connectionService.getConnection(c.req.param("connectionId"));
  if (!connection || connection.firmId !== firm.id) {
    return c.json({ error: "Not found" }, 404);
  }

  // Remove from provider
  const provider = getProvider(c.env, connection.provider);
  await provider.removeConnection(connection.providerConnectionId);

  await connectionService.deleteConnection(connection.id);
  return c.json({ ok: true });
});

// Get accounts for a connection
bankConnectivityRoutes.get("/connections/:connectionId/accounts", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const connectionService = new BankConnectionService(db);
  const connection = await connectionService.getConnection(c.req.param("connectionId"));
  if (!connection || connection.firmId !== firm.id) {
    return c.json({ error: "Not found" }, 404);
  }

  const accountService = new BankAccountService(createDb(c.env));
  const accounts = await accountService.getAccountsByConnection(connection.id);
  return c.json({ accounts });
});

// Update account visibility/settings
bankConnectivityRoutes.patch("/accounts/:accountId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = z.object({
    isVisible: z.boolean().optional(),
    status: z.enum(['active', 'inactive', 'closed']).optional(),
    name: z.string().optional(),
  }).parse(await c.req.json());

  const accountService = new BankAccountService(createDb(c.env));
  const account = await accountService.getAccount(c.req.param("accountId"));
  if (!account) return c.json({ error: "Not found" }, 404);

  // Verify ownership via connection
  // (In production, you'd check the connection's firm_id)

  const updated = await accountService.updateAccount(c.req.param("accountId"), body);
  return c.json({ account: updated });
});

// Sync transactions for a connection
bankConnectivityRoutes.post("/connections/:connectionId/sync", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = z.object({
    accountIds: z.array(z.string()).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    count: z.number().int().positive().max(500).optional(),
  }).parse(await c.req.json());

  const connectionService = new BankConnectionService(db);
  const connection = await connectionService.getConnection(c.req.param("connectionId"));
  if (!connection || connection.firmId !== firm.id) {
    return c.json({ error: "Not found" }, 404);
  }

  if (connection.status !== 'active') {
    return c.json({ error: "Connection not active" }, 409);
  }

  const provider = getProvider(c.env, connection.provider);
  const cursorService = new BankSyncCursorService(db);
  const accountService = new BankAccountService(db);

  let totalNew = 0;
  let totalUpdated = 0;
  const errors: string[] = [];

  // Get accounts to sync
  const accounts = await accountService.getAccountsByConnection(connection.id);
  const accountsToSync = body.accountIds
    ? accounts.filter(a => body.accountIds!.includes(a.id))
    : accounts;

  for (const account of accountsToSync) {
    try {
      // Get cursor
      const cursorService = new BankSyncCursorService(createDb(c.env));
      const cursor = await cursorService.getCursor(connection.id, account.id);

      // Sync transactions
      const result = await provider.syncTransactions(
        connection.providerConnectionId,
        cursor?.cursor,
        {
          startDate: body.startDate,
          endDate: body.endDate,
          accountIds: [account.providerAccountId],
          count: body.count,
        },
      );

      // Upsert transactions
      const transactions = result.transactions.map(txn => ({
        ...txn,
        connectionId: connection.id,
        accountId: account.id,
      }));

      const result2 = await new BankTransactionService(createDb(c.env)).upsertTransactions(connection.id, transactions);
      totalNew += result2.inserted;
      totalUpdated += result2.updated;

      // Save cursor
      if (result.nextCursor) {
        const cursorService = new BankSyncCursorService(createDb(c.env));
        await cursorService.saveCursor({
          connectionId: connection.id,
          accountId: account.id,
          cursor: result.nextCursor,
          lastSyncAt: new Date(),
          lastSuccessfulSyncAt: new Date(),
        });
      }

    } catch (error) {
      errors.push(`Account ${account.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  await connectionService.updateConnection(connection.id, {
    lastSyncAt: new Date(),
    lastSuccessfulSyncAt: errors.length === 0 ? new Date() : undefined,
    errorMessage: errors.length > 0 ? errors.join('; ') : undefined,
    status: errors.length > 0 ? 'error' : 'active',
  });

  return c.json({
    newTransactions: totalNew,
    updatedTransactions: totalUpdated,
    removedTransactions: 0,
    errors,
  });
});

// Get transactions
bankConnectivityRoutes.get("/connections/:connectionId/transactions", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const connectionService = new BankConnectionService(db);
  const connection = await connectionService.getConnection(c.req.param("connectionId"));
  if (!connection || connection.firmId !== firm.id) {
    return c.json({ error: "Not found" }, 404);
  }

  const query = z.object({
    accountId: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    pending: z.boolean().optional(),
    limit: z.number().int().positive().max(500).default(100),
    offset: z.number().int().nonnegative().default(0),
  }).parse(c.req.query());

  const transactionService = new BankTransactionService(createDb(c.env));
  const transactions = await new BankTransactionService(createDb(c.env)).getTransactions(connection.id, query);
  return c.json({ transactions });
});

// Webhook endpoints
bankConnectivityRoutes.post("/webhooks/teller", async (c) => {
  // Verify Teller signature
  const signature = c.req.header('Teller-Signature');
  const webhookSecret = c.env.TELLER_WEBHOOK_SECRET;
  
  if (!signature || !webhookSecret) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Verify HMAC
  const body = await c.req.text();
  const crypto = await import('crypto');
  const expected = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
  if (signature !== expected) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  const event = JSON.parse(body);
  // Handle Teller webhook events
  // event.type: 'transactions.updated', 'accounts.updated', 'account.deleted', 'enrollment.updated'
  
  return c.json({ ok: true });
});

bankConnectivityRoutes.post("/webhooks/plaid", async (c) => {
  // Verify Plaid signature
  const signature = c.req.header('Plaid-Signature');
  const webhookSecret = c.env.PLAID_WEBHOOK_SECRET;
  
  if (!signature || !webhookSecret) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.text();
  const crypto = await import('crypto');
  const expected = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
  if (signature !== expected) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  const event = JSON.parse(body);
  // Handle Plaid webhook events
  // event.webhook_type: 'TRANSACTIONS', 'ITEMS', 'ACCOUNTS', etc.
  // event.webhook_code: 'SYNC_UPDATES_AVAILABLE', 'NEW_TRANSACTIONS', 'REMOVED_TRANSACTIONS', etc.
  
  return c.json({ ok: true });
});

// Institution search
bankConnectivityRoutes.get("/institutions/search", async (c) => {
  const query = z.object({
    provider: z.enum(['teller', 'plaid']).default('teller'),
    query: z.string().optional(),
    countryCodes: z.array(z.string()).default(['US']),
    products: z.array(z.string()).default(['transactions']),
  }).parse(c.req.query());

  const provider = getProvider(c.env, query.provider);
  const institutions = await provider.searchInstitutions(
    query.query || '',
    query.countryCodes,
    query.products
  );
  return c.json({ institutions });
});