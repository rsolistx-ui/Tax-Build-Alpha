import type { Db } from "../db";
import { newId } from "../lib/id";

/**
 * Moves synced provider data into Truepost's canonical review queue.
 * Provider data remains intact in bank_transactions_external for traceability;
 * the projected item starts unclassified and requires practitioner approval.
 */
export class BankFeedReviewProjectionService {
  constructor(private readonly db: Db) {}

  async projectConnection(connectionId: string, clientId: string): Promise<number> {
    const externalTransactions = await this.db.query<{
      id: string;
      date: string;
      description: string;
      merchant_name: string | null;
      amount: number | string;
      currency: string;
      pending: boolean;
      provider_transaction_id: string;
      account_id: string;
    }>(
      `SELECT external.id, external.date, external.description, external.merchant_name,
              external.amount, external.currency, external.pending,
              external.provider_transaction_id, external.account_id
         FROM bank_transactions_external external
         LEFT JOIN bank_transaction_provider_links link
           ON link.external_transaction_id = external.id
        WHERE external.connection_id = $1
          AND external.pending = FALSE
          AND link.external_transaction_id IS NULL
        ORDER BY external.date ASC, external.created_at ASC`,
      [connectionId],
    );

    let projected = 0;
    for (const external of externalTransactions) {
      const bankTransactionId = newId("txn");
      const source = {
        source: "bank_feed",
        connectionId,
        externalTransactionId: external.id,
        providerTransactionId: external.provider_transaction_id,
        accountId: external.account_id,
        pending: false,
      };
      const statements = [
        {
          query: `INSERT INTO bank_transactions
            (id, client_id, txn_date, description, amount, currency, triage, raw_json, import_fingerprint, suggested_disposition)
            VALUES ($1, $2, $3, $4, $5, $6, 'unmatched', $7::jsonb, $8, $9)`,
          params: [
            bankTransactionId,
            clientId,
            external.date,
            external.merchant_name || external.description,
            Number(external.amount),
            external.currency || "USD",
            source,
            `provider:${connectionId}:${external.id}`,
            Number(external.amount) >= 0 ? "business_expense" : "business_income",
          ],
        },
        {
          query: `INSERT INTO bank_transaction_provider_links
            (external_transaction_id, bank_transaction_id, connection_id)
            VALUES ($1, $2, $3)`,
          params: [external.id, bankTransactionId, connectionId],
        },
      ];
      await this.db.transaction(statements);
      projected += 1;
    }
    return projected;
  }
}
