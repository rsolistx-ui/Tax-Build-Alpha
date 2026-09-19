import { describe, expect, it, vi } from "vitest";
import { ReliabilityEngineerService } from "./reliability-engineer";
import type { Db } from "../db";
import type { Env } from "../env";

function mockDb(queryResult: any[] = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      return queryResult as T[];
    },
    async transaction<T>() { return [] as T[][]; },
  };
  return { db, calls };
}

const mockEnv: Env = {
  DATABASE_URL: "postgres://localhost/test",
  AUTH_DB: { prepare: () => ({ run: async () => ({}) }) } as any,
  RECEIPTS: {} as any,
  AI: {} as any,
  LLM_PROVIDER: "workers-ai",
  BETTER_AUTH_SECRET: "mock-secret-at-least-32-chars-long",
  BETTER_AUTH_URL: "https://folio-api.rsolistx.workers.dev",
  VAPID_PUBLIC_KEY: "test-pub",
  VAPID_PRIVATE_KEY: "test-priv",
};

describe("ReliabilityEngineerService", () => {
  it("runs full system diagnostics across postgres, d1, r2, and workers-ai", async () => {
    const { db } = mockDb([{ ping: 1 }]);
    const service = new ReliabilityEngineerService(db, mockEnv);
    const report = await service.runDiagnostics();

    expect(report.overallHealthy).toBe(true);
    expect(report.checks.postgres.ok).toBe(true);
    expect(report.checks.authD1.ok).toBe(true);
    expect(report.checks.storageR2.ok).toBe(true);
    expect(report.checks.workersAi.ok).toBe(true);
  });

  it("self-heals stuck receipts and deadlocked tasks", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const db: Db = {
      async query<T>(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        if (sql.includes("FROM receipts r")) {
          return [{ id: "rec_stuck_1", client_id: "cli_1" }] as T[];
        }
        if (sql.includes("FROM agent_tasks at")) {
          return [{ id: "task_deadlock_1", client_id: "cli_1" }] as T[];
        }
        return [] as T[];
      },
      async transaction<T>() { return [] as T[][]; },
    };

    const service = new ReliabilityEngineerService(db, mockEnv);
    const result = await service.runSelfHealing("firm_1");

    expect(result.stuckReceiptsReset).toBe(1);
    expect(result.stuckAgentTasksResolved).toBe(1);
    expect(result.details).toHaveLength(2);

    // Verify reset update was executed
    const receiptUpdate = calls.find((c) => c.sql.includes("UPDATE receipts SET status = 'pending'"));
    expect(receiptUpdate).toBeDefined();

    // Verify task update was executed
    const taskUpdate = calls.find((c) => c.sql.includes("UPDATE agent_tasks SET status = 'dismissed'"));
    expect(taskUpdate).toBeDefined();

    // Verify autonomous audit record was created under reliability_engineer
    const auditInsert = calls.find((c) => c.sql.includes("INSERT INTO agent_tasks") && c.params.includes("reliability_engineer"));
    expect(auditInsert).toBeDefined();
  });
});
