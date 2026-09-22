import { describe, expect, it } from "vitest";
import type { Db } from "../db";
import { halfHourSlot, runSupervisorHeartbeatWithDb } from "./supervisor-heartbeat";

describe("supervisor heartbeat", () => {
  it("rounds work into a durable half-hour slot", () => {
    expect(halfHourSlot(new Date("2026-09-21T14:19:22.000Z"))).toBe("2026-09-21T14:00:00.000Z");
    expect(halfHourSlot(new Date("2026-09-21T14:42:22.000Z"))).toBe("2026-09-21T14:30:00.000Z");
  });

  it("claims each firm once and creates approval-only brief work without model polling", async () => {
    const calls: Array<{ query: string; params?: unknown[] }> = [];
    const db = {
      query: async (query: string, params?: unknown[]) => {
        calls.push({ query, params });
        if (query.includes("SELECT id FROM firms")) return [{ id: "firm_1" }, { id: "firm_2" }];
        if (query.includes("INSERT INTO supervisor_heartbeat_runs")) {
          return params?.[1] === "firm_1" ? [{ id: "run_1" }] : [];
        }
        if (query.includes("SELECT id FROM clients")) return [{ id: "client_1" }];
        if (query.includes("FROM receipts")) return [];
        if (query.includes("FROM bank_transactions")) return [];
        if (query.includes("FROM tax_extensions")) return [];
        return [];
      },
      transaction: async () => [],
    } as unknown as Db;

    const result = await runSupervisorHeartbeatWithDb(db, new Date("2026-09-21T14:19:22.000Z"));
    expect(result).toMatchObject({ firmsScanned: 1, firmsSkipped: 1, recommendationsCreated: 0, failures: 0, llmCalls: 0 });
    expect(calls.some((call) => call.query.includes("UPDATE supervisor_heartbeat_runs") && call.query.includes("status = 'completed'") && call.params?.includes("run_1"))).toBe(true);
  });
});
