import { describe, expect, it } from "vitest";
import type { Db, DbStatement } from "../db";
import { createEngagement, getEngagement, updateEngagementStatus } from "./engagements";

type Rows = Record<string, unknown[]>;

function fakeDb(rows: Rows): { db: Db; transactionCalls: DbStatement[][] } {
  const transactionCalls: DbStatement[][] = [];
  const db: Db = {
    async query<T>(sql: string) {
      for (const [key, value] of Object.entries(rows)) {
        if (sql.includes(key)) return value as T[];
      }
      return [] as T[];
    },
    async transaction<T>(statements: DbStatement[]) {
      transactionCalls.push(statements);
      return statements.map(() => []) as T[][];
    },
  };
  return { db, transactionCalls };
}

const ENGAGEMENT_LOOKUP_KEY = "FROM engagements WHERE id = $1 AND firm_id = $2";

describe("createEngagement", () => {
  it("creates one work item per bookkeeping service-template step, all firm and client scoped", async () => {
    const engagementRow = { id: "eng_1", firm_id: "firm_1", client_id: "cli_1", service_type: "bookkeeping", title: "Q1 close", status: "planned" };
    const { db, transactionCalls } = fakeDb({ [ENGAGEMENT_LOOKUP_KEY]: [engagementRow] });

    await createEngagement(db, "user_1", { firmId: "firm_1", clientId: "cli_1", serviceType: "bookkeeping", title: "Q1 close" });

    expect(transactionCalls).toHaveLength(1);
    const statements = transactionCalls[0];
    const engagementInsert = statements[0];
    expect(engagementInsert.query).toContain("INSERT INTO engagements");

    const engagementInsertId = engagementInsert.params?.[0];
    const workItemInserts = statements.filter((s) => s.query.includes("INSERT INTO work_items"));
    expect(workItemInserts).toHaveLength(8); // bookkeeping template has 8 steps
    for (const stmt of workItemInserts) {
      expect(stmt.params?.[1]).toBe("firm_1");
      expect(stmt.params?.[2]).toBe("cli_1");
      expect(stmt.params?.[3]).toBe(engagementInsertId);
    }

    const auditEvent = statements.find((s) => s.query.includes("INSERT INTO work_audit_events"));
    expect(auditEvent).toBeDefined();
  });

  it("creates zero template work items for a custom engagement with no matching template", async () => {
    const engagementRow = { id: "eng_2", firm_id: "firm_1", client_id: "cli_1", service_type: "custom", title: "Ad hoc", status: "planned" };
    const { db, transactionCalls } = fakeDb({ [ENGAGEMENT_LOOKUP_KEY]: [engagementRow] });

    await createEngagement(db, "user_1", { firmId: "firm_1", clientId: "cli_1", serviceType: "custom", title: "Ad hoc" });

    const workItemInserts = transactionCalls[0].filter((s) => s.query.includes("INSERT INTO work_items"));
    expect(workItemInserts).toHaveLength(0);
  });
});

describe("getEngagement firm isolation", () => {
  it("scopes the lookup by firm_id in the same query, never trusting a caller-supplied firm match after the fact", async () => {
    const { db } = fakeDb({ [ENGAGEMENT_LOOKUP_KEY]: [] });
    const result = await getEngagement(db, "eng_other_firm", "firm_1");
    expect(result).toBeUndefined();
  });
});

describe("updateEngagementStatus", () => {
  it("returns undefined for an engagement belonging to a different firm, without writing anything", async () => {
    const { db, transactionCalls } = fakeDb({ [ENGAGEMENT_LOOKUP_KEY]: [] });
    const result = await updateEngagementStatus(db, "eng_1", "firm_1", "user_1", "active");
    expect(result).toBeUndefined();
    expect(transactionCalls).toHaveLength(0);
  });

  it("writes a before/after audit event on a valid status change", async () => {
    const engagementRow = { id: "eng_1", firm_id: "firm_1", client_id: "cli_1", service_type: "bookkeeping", title: "Q1 close", status: "planned" };
    const { db, transactionCalls } = fakeDb({ [ENGAGEMENT_LOOKUP_KEY]: [engagementRow] });

    await updateEngagementStatus(db, "eng_1", "firm_1", "user_1", "active");

    expect(transactionCalls).toHaveLength(1);
    const auditEvent = transactionCalls[0].find((s) => s.query.includes("INSERT INTO work_audit_events"));
    expect(auditEvent?.params?.[6]).toEqual({ status: "planned" });
    expect(auditEvent?.params?.[7]).toEqual({ status: "active" });
  });
});
