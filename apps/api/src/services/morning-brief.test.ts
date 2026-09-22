import { describe, expect, it } from "vitest";
import type { Db } from "../db";
import { prepareMorningBrief } from "./morning-brief";

describe("prepareMorningBrief", () => {
  it("creates only approval-required recommendations from existing evidence", async () => {
    const calls: Array<{ query: string; params?: unknown[] }> = [];
    const db = {
      query: async (query: string, params?: unknown[]) => {
        calls.push({ query, params });
        if (query.includes("SELECT id FROM clients")) return [{ id: "client_1" }];
        if (query.includes("FROM receipts")) return [{ id: "receipt_1", filename: "blurry.jpg" }];
        if (query.includes("FROM bank_transactions")) return [{ id: "txn_1", description: "Office store", amount: 42 }];
        if (query.includes("FROM tax_extensions")) return [{ id: "ext_1", due_date: "2026-10-15", form_type: "4868" }];
        if (query.includes("INSERT INTO agent_tasks")) return [{ id: "agent_1" }];
        return [];
      },
      transaction: async () => [],
    } as unknown as Db;
    const result = await prepareMorningBrief(db, "firm_1");
    expect(result).toEqual({ clientsScanned: 1, recommendationsCreated: 3 });
    const inserts = calls.filter((call) => call.query.includes("INSERT INTO agent_tasks"));
    expect(inserts).toHaveLength(3);
    for (const insert of inserts) {
      expect(insert.params).toContain("approval_required");
      expect(insert.params).toContain("awaiting_approval");
    }
  });
});
