import { describe, expect, it } from "vitest";
import type { Db } from "../db";
import { delegateBankImportAgent, delegateReceiptAgents } from "./agent-supervisor";

function fakeDb() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      return [] as T[];
    },
    async transaction<T>() { return [] as T[][]; },
  };
  return { db, calls };
}

describe("event-driven agent supervisor", () => {
  it("delegates upload work with an autonomous extraction record and an approval-gated categorization record", async () => {
    const { db, calls } = fakeDb();
    await delegateReceiptAgents(db, {
      firmId: "firm_1", clientId: "client_1", receiptId: "receipt_1", confidence: 0.91,
      merchant: "Folio Supply", category: "Supplies", total: 64.95, validationStatus: "pass",
    });

    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.sql.includes("ON CONFLICT (client_id, source_type, source_id, agent_name) DO NOTHING"))).toBe(true);
    const autonomy = calls.map((call) => call.params[7]);
    const statuses = calls.map((call) => call.params[8]);
    expect(autonomy).toEqual(expect.arrayContaining(["autonomous", "approval_required"]));
    expect(statuses).toEqual(expect.arrayContaining(["completed", "awaiting_approval"]));
  });

  it("never auto-approves bank triage or a bank disposition", async () => {
    const { db, calls } = fakeDb();
    await delegateBankImportAgent(db, {
      firmId: "firm_1", clientId: "client_1", importBatchId: "import_1", insertedCount: 4, duplicateCount: 1,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].params[7]).toBe("approval_required");
    expect(calls[0].params[8]).toBe("awaiting_approval");
    expect(calls[0].params[11]).toMatchObject({ humanApprovalRequired: true });
  });
});
