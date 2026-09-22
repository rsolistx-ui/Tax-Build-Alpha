import { describe, expect, it } from "vitest";
import { runBankFeedHeartbeat } from "./bank-feed-heartbeat";

describe("bank-feed heartbeat", () => {
  it("does not touch the database or make provider calls before Plaid is configured", async () => {
    await expect(runBankFeedHeartbeat({} as any)).resolves.toEqual({
      connectionsConsidered: 0,
      connectionsSynced: 0,
      queuedForReview: 0,
      failures: 0,
      skipped: true,
    });
  });
});
