import { describe, expect, it } from "vitest";
import { BankFeedReviewProjectionService } from "./bank-feed-review-projection";

describe("BankFeedReviewProjectionService", () => {
  it("projects only unlinked settled feed transactions into the native review queue", async () => {
    const calls: Array<{ type: string; value: unknown }> = [];
    const db = {
      query: async () => [{
        id: "external_1", date: "2026-09-21", description: "Office supply store", merchant_name: "Office supply store",
        amount: "28.50", currency: "USD", pending: false, provider_transaction_id: "plaid_txn_1", account_id: "account_1",
      }],
      transaction: async (statements: unknown[]) => { calls.push({ type: "transaction", value: statements }); return []; },
    } as any;

    const count = await new BankFeedReviewProjectionService(db).projectConnection("connection_1", "client_1");
    expect(count).toBe(1);
    expect(calls).toHaveLength(1);
    const statements = calls[0].value as Array<{ query: string; params: unknown[] }>;
    expect(statements[0].query).toContain("INSERT INTO bank_transactions");
    expect(statements[0].query).toContain("'unmatched'");
    expect(statements[1].query).toContain("bank_transaction_provider_links");
  });

  it("does nothing when all feed transactions are already linked", async () => {
    const db = { query: async () => [], transaction: async () => { throw new Error("not expected"); } } as any;
    await expect(new BankFeedReviewProjectionService(db).projectConnection("connection_1", "client_1")).resolves.toBe(0);
  });
});
