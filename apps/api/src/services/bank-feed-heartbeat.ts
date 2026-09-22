import { createDb } from "../db";
import type { Env } from "../env";
import { BankAccountService, BankConnectionService, BankSyncCursorService, BankTransactionService, type BankFeedProvider } from "./bank-feed";
import { PlaidBankFeedProvider } from "./plaid-provider";
import { TellerBankFeedProvider } from "./teller-provider";
import { BankFeedReviewProjectionService } from "./bank-feed-review-projection";

export type BankFeedHeartbeatResult = {
  connectionsConsidered: number;
  connectionsSynced: number;
  queuedForReview: number;
  failures: number;
  skipped: boolean;
};

function providerFor(env: Env, provider: "plaid" | "teller"): BankFeedProvider | null {
  if (provider === "plaid") {
    if (!env.PLAID_CLIENT_ID || !env.PLAID_CLIENT_SECRET) return null;
    return new PlaidBankFeedProvider({
      clientId: env.PLAID_CLIENT_ID,
      clientSecret: env.PLAID_CLIENT_SECRET,
      redirectUri: `${env.APP_ORIGIN}/bank/connect/callback`,
      environment: env.PLAID_ENVIRONMENT || "sandbox",
    });
  }
  if (!env.TELLER_CLIENT_ID || !env.TELLER_CLIENT_SECRET) return null;
  return new TellerBankFeedProvider({
    clientId: env.TELLER_CLIENT_ID,
    clientSecret: env.TELLER_CLIENT_SECRET,
    redirectUri: `${env.APP_ORIGIN}/bank/connect/callback`,
    environment: env.TELLER_ENVIRONMENT || "sandbox",
  });
}

/**
 * Half-hourly, bounded bank-feed maintenance. It only retrieves changes and
 * queues settled evidence for review; it never approves, categorizes, posts,
 * or communicates on a client's behalf.
 */
export async function runBankFeedHeartbeat(env: Env): Promise<BankFeedHeartbeatResult> {
  if (!env.PLAID_CLIENT_ID || !env.PLAID_CLIENT_SECRET) {
    return { connectionsConsidered: 0, connectionsSynced: 0, queuedForReview: 0, failures: 0, skipped: true };
  }

  const db = createDb(env);
  const ids = await db.query<{ id: string }>(
    `SELECT id FROM bank_connections
      WHERE status = 'active' AND client_id IS NOT NULL AND provider = 'plaid'
      ORDER BY last_sync_at NULLS FIRST, created_at ASC
      LIMIT 50`,
  );
  const connections = new BankConnectionService(db);
  const accounts = new BankAccountService(db);
  const cursors = new BankSyncCursorService(db);
  const transactions = new BankTransactionService(db);
  const projection = new BankFeedReviewProjectionService(db);
  let connectionsSynced = 0;
  let queuedForReview = 0;
  let failures = 0;

  for (const { id } of ids) {
    try {
      const connection = await connections.getConnection(id);
      if (!connection?.clientId || connection.provider !== "plaid") continue;
      const provider = providerFor(env, connection.provider);
      if (!provider) continue;
      const linkedAccounts = await accounts.getAccountsByConnection(connection.id);
      for (const account of linkedAccounts.filter((item) => item.isVisible && item.status === "active")) {
        const cursor = await cursors.getCursor(connection.id, account.id);
        let nextCursor = cursor?.cursor;
        let hasMore = true;
        let pages = 0;
        while (hasMore && pages < 20) {
          const result = await provider.syncTransactions(connection.providerConnectionId, nextCursor, {
            accountIds: [account.providerAccountId], count: 500,
          });
          await transactions.upsertTransactions(connection.id, result.transactions.map((transaction) => ({
            ...transaction, connectionId: connection.id, accountId: account.id,
          })));
          nextCursor = result.nextCursor;
          hasMore = result.hasMore;
          pages += 1;
          if (nextCursor) {
            await cursors.saveCursor({ connectionId: connection.id, accountId: account.id, cursor: nextCursor, lastSyncAt: new Date(), lastSuccessfulSyncAt: new Date() });
          } else if (hasMore) {
            throw new Error("Bank provider reported more transactions without a continuation cursor");
          }
        }
        if (hasMore) throw new Error("Bank sync reached its 20-page safety limit; the next heartbeat will continue");
      }
      queuedForReview += await projection.projectConnection(connection.id, connection.clientId);
      await connections.updateConnection(connection.id, { status: "active", lastSyncAt: new Date(), lastSuccessfulSyncAt: new Date(), errorMessage: undefined });
      connectionsSynced += 1;
    } catch (error) {
      failures += 1;
      console.error("[bank-feed-heartbeat] connection sync failed", { connectionId: id, error });
      await connections.updateConnection(id, {
        status: "error",
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Unknown bank-feed sync failure",
        lastSyncAt: new Date(),
      }).catch((updateError) => console.error("[bank-feed-heartbeat] could not record failure", { connectionId: id, updateError }));
    }
  }
  return { connectionsConsidered: ids.length, connectionsSynced, queuedForReview, failures, skipped: false };
}
