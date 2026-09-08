import { describe, expect, it } from "vitest";
import type { Db, DbStatement } from "../db";
import { createWorkItem, getWorkItem, queryWorkQueue, updateWorkItemStatus } from "./work-items";

type Rows = Record<string, unknown[]>;

function fakeDb(rows: Rows, queryImpl?: (sql: string, params: unknown[]) => unknown[] | undefined): { db: Db; transactionCalls: DbStatement[][]; queries: { sql: string; params: unknown[] }[] } {
  const transactionCalls: DbStatement[][] = [];
  const queries: { sql: string; params: unknown[] }[] = [];
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      const custom = queryImpl?.(sql, params);
      if (custom) return custom as T[];
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
  return { db, transactionCalls, queries };
}

const WORK_ITEM_LOOKUP_KEY = "FROM work_items WHERE id = $1 AND firm_id = $2";

describe("createWorkItem", () => {
  it("defaults to open status and records an audit event", async () => {
    const row = { id: "wi_1", firm_id: "firm_1", client_id: "cli_1", status: "open", title: "Chase receipt" };
    const { db, transactionCalls } = fakeDb({ [WORK_ITEM_LOOKUP_KEY]: [row], "SELECT * FROM work_items WHERE id = $1": [row] });

    await createWorkItem(db, "user_1", { firmId: "firm_1", clientId: "cli_1", title: "Chase receipt" });

    const insert = transactionCalls[0].find((s) => s.query.includes("INSERT INTO work_items"));
    expect(insert?.params?.[7]).toBe("open"); // status defaults to open
    const audit = transactionCalls[0].find((s) => s.query.includes("INSERT INTO work_audit_events"));
    expect(audit).toBeDefined();
  });
});

describe("getWorkItem firm isolation", () => {
  it("returns undefined when the work item belongs to a different firm", async () => {
    const { db } = fakeDb({ [WORK_ITEM_LOOKUP_KEY]: [] });
    const result = await getWorkItem(db, "wi_1", "firm_1");
    expect(result).toBeUndefined();
  });
});

describe("updateWorkItemStatus", () => {
  it("sets completed_at when moving to complete", async () => {
    const row = { id: "wi_1", firm_id: "firm_1", client_id: "cli_1", status: "open" };
    const { db, transactionCalls } = fakeDb({ [WORK_ITEM_LOOKUP_KEY]: [row] });

    await updateWorkItemStatus(db, "wi_1", "firm_1", "user_1", "complete");

    const update = transactionCalls[0].find((s) => s.query.includes("UPDATE work_items"));
    expect(update?.query).toContain("completed_at = NOW()");
  });

  it("clears completed_at when moving away from complete", async () => {
    const row = { id: "wi_1", firm_id: "firm_1", client_id: "cli_1", status: "complete" };
    const { db, transactionCalls } = fakeDb({ [WORK_ITEM_LOOKUP_KEY]: [row] });

    await updateWorkItemStatus(db, "wi_1", "firm_1", "user_1", "open");

    const update = transactionCalls[0].find((s) => s.query.includes("UPDATE work_items"));
    expect(update?.query).toContain("completed_at = NULL");
  });
});

describe("queryWorkQueue filtering and pagination", () => {
  it("scopes every query by firm_id first", async () => {
    const { db, queries } = fakeDb({});
    await queryWorkQueue(db, "firm_1", {});
    expect(queries[0].sql).toContain("firm_id = $1");
    expect(queries[0].params[0]).toBe("firm_1");
  });

  it("applies the overdue view as a status-and-due-date condition", async () => {
    const { db, queries } = fakeDb({});
    await queryWorkQueue(db, "firm_1", { view: "overdue" });
    expect(queries[0].sql).toContain("due_at < NOW()");
    expect(queries[0].sql).toContain("status NOT IN ('complete', 'cancelled')");
  });

  it("applies client, status, and priority filters as separate bound parameters", async () => {
    const { db, queries } = fakeDb({});
    await queryWorkQueue(db, "firm_1", { clientId: "cli_1", status: "open", priority: "high" });
    expect(queries[0].sql).toContain("client_id = $2");
    expect(queries[0].sql).toContain("status = $3");
    expect(queries[0].sql).toContain("priority = $4");
    expect(queries[0].params).toEqual(["firm_1", "cli_1", "open", "high"]);
  });

  it("returns a next cursor only when more rows exist beyond the page limit", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `wi_${i}`,
      created_at: `2026-01-0${i + 1}T00:00:00Z`,
    }));
    const { db } = fakeDb({}, (sql) => (sql.includes("FROM work_items") ? rows : undefined));

    const result = await queryWorkQueue(db, "firm_1", { limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe("2026-01-02T00:00:00Z|wi_1");
  });

  it("returns no cursor when the result fits within the page limit", async () => {
    const rows = [{ id: "wi_0", created_at: "2026-01-01T00:00:00Z" }];
    const { db } = fakeDb({}, (sql) => (sql.includes("FROM work_items") ? rows : undefined));

    const result = await queryWorkQueue(db, "firm_1", { limit: 50 });
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it("encodes a supplied cursor as a tuple comparison, not a single-column comparison", async () => {
    const { db, queries } = fakeDb({});
    await queryWorkQueue(db, "firm_1", { cursor: "2026-01-01T00:00:00Z|wi_5" });
    expect(queries[0].sql).toContain("(created_at, id) <");
    expect(queries[0].params).toContain("2026-01-01T00:00:00Z");
    expect(queries[0].params).toContain("wi_5");
  });
});
