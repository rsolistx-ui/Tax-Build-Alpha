import { describe, expect, it } from "vitest";
import type { Db, DbStatement } from "../db";
import { approveDraftRequest, createClientRequest, getClientRequest, listRequestsDueForReminder, satisfyRequest } from "./client-requests";

type Rows = Record<string, unknown[]>;

function fakeDb(rows: Rows): { db: Db; transactionCalls: DbStatement[][]; plainQueries: { sql: string; params: unknown[] }[] } {
  const transactionCalls: DbStatement[][] = [];
  const plainQueries: { sql: string; params: unknown[] }[] = [];
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      plainQueries.push({ sql, params });
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
  return { db, transactionCalls, plainQueries };
}

const REQUEST_LOOKUP_KEY = "FROM client_requests WHERE id = $1 AND firm_id = $2";
const WORK_ITEM_LOOKUP_KEY = "FROM work_items WHERE id = $1";

describe("createClientRequest", () => {
  it("creates a linked, client-visible work item and defaults to requested status when not specified", async () => {
    const workItemRow = { id: "wi_1", firm_id: "firm_1", client_id: "cli_1", status: "open" };
    const requestRow = { id: "creq_1", firm_id: "firm_1", client_id: "cli_1", work_item_id: "wi_1", status: "requested" };
    const { db, transactionCalls } = fakeDb({
      [WORK_ITEM_LOOKUP_KEY]: [workItemRow],
      [REQUEST_LOOKUP_KEY]: [requestRow],
    });

    await createClientRequest(db, "user_1", {
      firmId: "firm_1",
      clientId: "cli_1",
      requestType: "missing_receipt",
      title: "Receipt needed",
    });

    const workItemInsert = transactionCalls[0].find((s) => s.query.includes("INSERT INTO work_items"));
    expect(workItemInsert?.params?.[12]).toBe(true); // client_visible

    const requestInsert = transactionCalls[1].find((s) => s.query.includes("INSERT INTO client_requests"));
    expect(requestInsert?.params?.[7]).toBe("requested");
  });

  it("creates a draft request that is not yet approved", async () => {
    const workItemRow = { id: "wi_1", firm_id: "firm_1", client_id: "cli_1", status: "open" };
    const requestRow = { id: "creq_1", firm_id: "firm_1", client_id: "cli_1", work_item_id: "wi_1", status: "draft" };
    const { db, transactionCalls } = fakeDb({
      [WORK_ITEM_LOOKUP_KEY]: [workItemRow],
      [REQUEST_LOOKUP_KEY]: [requestRow],
    });

    await createClientRequest(db, "user_1", {
      firmId: "firm_1",
      clientId: "cli_1",
      requestType: "missing_receipt",
      title: "Receipt needed",
      status: "draft",
    });

    const requestInsert = transactionCalls[1].find((s) => s.query.includes("INSERT INTO client_requests"));
    expect(requestInsert?.params?.[7]).toBe("draft");
    expect(requestInsert?.params?.[12]).toBeNull(); // approved_by_user_id stays null for a draft
  });
});

describe("approveDraftRequest", () => {
  it("is a no-op for a request that is not in draft status", async () => {
    const requestRow = { id: "creq_1", firm_id: "firm_1", client_id: "cli_1", status: "requested" };
    const { db, transactionCalls } = fakeDb({ [REQUEST_LOOKUP_KEY]: [requestRow] });

    const result = await approveDraftRequest(db, "creq_1", "firm_1", "user_1");

    expect(result?.status).toBe("requested");
    expect(transactionCalls).toHaveLength(0);
  });

  it("moves a draft to requested and records who approved it", async () => {
    const requestRow = { id: "creq_1", firm_id: "firm_1", client_id: "cli_1", status: "draft" };
    const { db, transactionCalls } = fakeDb({ [REQUEST_LOOKUP_KEY]: [requestRow] });

    await approveDraftRequest(db, "creq_1", "firm_1", "user_2");

    const update = transactionCalls[0].find((s) => s.query.includes("UPDATE client_requests"));
    expect(update?.params).toEqual(["user_2", "creq_1", "firm_1"]);
  });
});

describe("satisfyRequest", () => {
  it("marks the request satisfied and completes the linked work item in the same operation", async () => {
    const requestRow = { id: "creq_1", firm_id: "firm_1", client_id: "cli_1", work_item_id: "wi_1", status: "responded" };
    const workItemRow = { id: "wi_1", firm_id: "firm_1", client_id: "cli_1", status: "in_progress" };
    const { db, transactionCalls } = fakeDb({
      [REQUEST_LOOKUP_KEY]: [requestRow],
      [WORK_ITEM_LOOKUP_KEY]: [workItemRow],
    });

    await satisfyRequest(db, "creq_1", "firm_1", "user_1");

    const requestUpdate = transactionCalls[0].find((s) => s.query.includes("UPDATE client_requests"));
    expect(requestUpdate).toBeDefined();
    const workItemUpdate = transactionCalls[1]?.find((s) => s.query.includes("UPDATE work_items"));
    expect(workItemUpdate?.query).toContain("completed_at = NOW()");
  });

  it("returns undefined for a request belonging to a different firm, without writing anything", async () => {
    const { db, transactionCalls } = fakeDb({ [REQUEST_LOOKUP_KEY]: [] });
    const result = await satisfyRequest(db, "creq_1", "firm_1", "user_1");
    expect(result).toBeUndefined();
    expect(transactionCalls).toHaveLength(0);
  });
});

describe("getClientRequest firm isolation", () => {
  it("never returns a row for a different firm_id", async () => {
    const { db } = fakeDb({ [REQUEST_LOOKUP_KEY]: [] });
    const result = await getClientRequest(db, "creq_1", "firm_other");
    expect(result).toBeUndefined();
  });
});

describe("listRequestsDueForReminder", () => {
  it("only queries requested/viewed requests whose next_reminder_at has arrived", async () => {
    const { db, plainQueries } = fakeDb({});
    const asOf = new Date("2026-03-15T00:00:00Z");

    await listRequestsDueForReminder(db, "firm_1", asOf);

    const call = plainQueries.find((q) => q.sql.includes("FROM client_requests") && q.sql.includes("next_reminder_at"));
    expect(call?.sql).toContain("status IN ('requested', 'viewed')");
    expect(call?.sql).toContain("next_reminder_at <= $2");
    expect(call?.params).toEqual(["firm_1", asOf.toISOString()]);
  });
});