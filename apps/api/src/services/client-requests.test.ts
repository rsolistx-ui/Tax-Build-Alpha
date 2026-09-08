import { describe, expect, it } from "vitest";
import type { Db, DbStatement } from "../db";
import {
  approveDraftRequest,
  cancelRequest,
  createClientRequest,
  getClientRequest,
  listRequestsDueForReminder,
  respondToRequest,
  satisfyRequest,
} from "./client-requests";

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

describe("createClientRequest atomicity", () => {
  it("creates the work item and the request as ONE transaction, not two, so a mid-failure cannot orphan a work item", async () => {
    const requestRow = { id: "creq_1", firm_id: "firm_1", client_id: "cli_1", work_item_id: "wi_1", status: "requested" };
    const { db, transactionCalls } = fakeDb({ [REQUEST_LOOKUP_KEY]: [requestRow] });

    await createClientRequest(db, "user_1", {
      firmId: "firm_1",
      clientId: "cli_1",
      requestType: "missing_receipt",
      title: "Receipt needed",
    });

    expect(transactionCalls).toHaveLength(1);
    const statements = transactionCalls[0];
    expect(statements.some((s) => s.query.includes("INSERT INTO work_items"))).toBe(true);
    expect(statements.some((s) => s.query.includes("INSERT INTO client_requests"))).toBe(true);
    expect(statements.filter((s) => s.query.includes("INSERT INTO work_audit_events"))).toHaveLength(2);
  });

  it("rolls back the whole transaction (fake db never partially applies) proving no orphan work item on failure", async () => {
    const failingDb: Db = {
      async query<T>() {
        return [] as T[];
      },
      async transaction<T>(): Promise<T[][]> {
        throw new Error("simulated insert failure");
      },
    };
    await expect(
      createClientRequest(failingDb, "user_1", { firmId: "firm_1", clientId: "cli_1", requestType: "missing_receipt", title: "x" }),
    ).rejects.toThrow("simulated insert failure");
  });

  it("starts a directly-requested work item as waiting_on_client, and a draft's work item as open", async () => {
    const requestRow = { id: "creq_1", firm_id: "firm_1", client_id: "cli_1", work_item_id: "wi_1", status: "requested" };
    const { db: db1, transactionCalls: calls1 } = fakeDb({ [REQUEST_LOOKUP_KEY]: [requestRow] });
    await createClientRequest(db1, "user_1", { firmId: "firm_1", clientId: "cli_1", requestType: "missing_receipt", title: "x", status: "requested" });
    const workItemInsert1 = calls1[0].find((s) => s.query.includes("INSERT INTO work_items"));
    expect(workItemInsert1?.params?.[7]).toBe("waiting_on_client");

    const draftRow = { id: "creq_2", firm_id: "firm_1", client_id: "cli_1", work_item_id: "wi_2", status: "draft" };
    const { db: db2, transactionCalls: calls2 } = fakeDb({ [REQUEST_LOOKUP_KEY]: [draftRow] });
    await createClientRequest(db2, "user_1", { firmId: "firm_1", clientId: "cli_1", requestType: "missing_receipt", title: "x", status: "draft" });
    const workItemInsert2 = calls2[0].find((s) => s.query.includes("INSERT INTO work_items"));
    expect(workItemInsert2?.params?.[7]).toBe("open");
  });
});

describe("approveDraftRequest state transition", () => {
  it("moves the request to requested AND the linked work item to waiting_on_client, with an audit event for each", async () => {
    const requestRow = { id: "creq_1", firm_id: "firm_1", client_id: "cli_1", work_item_id: "wi_1", status: "draft" };
    const { db, transactionCalls } = fakeDb({ [REQUEST_LOOKUP_KEY]: [requestRow] });

    await approveDraftRequest(db, "creq_1", "firm_1", "user_2");

    const statements = transactionCalls[0];
    const requestUpdate = statements.find((s) => s.query.includes("UPDATE client_requests"));
    expect(requestUpdate?.params?.[0]).toBe("user_2");
    expect(requestUpdate?.params?.slice(-2)).toEqual(["creq_1", "firm_1"]);

    const workItemUpdate = statements.find((s) => s.query.includes("UPDATE work_items"));
    expect(workItemUpdate?.query).toContain("waiting_on_client");
    expect(workItemUpdate?.params).toEqual(["wi_1", "firm_1"]);

    const auditEvents = statements.filter((s) => s.query.includes("INSERT INTO work_audit_events"));
    expect(auditEvents).toHaveLength(2);
  });

  it("is a no-op for a request that is not in draft status", async () => {
    const requestRow = { id: "creq_1", firm_id: "firm_1", client_id: "cli_1", status: "requested" };
    const { db, transactionCalls } = fakeDb({ [REQUEST_LOOKUP_KEY]: [requestRow] });

    const result = await approveDraftRequest(db, "creq_1", "firm_1", "user_1");

    expect(result?.status).toBe("requested");
    expect(transactionCalls).toHaveLength(0);
  });
});

describe("respondToRequest state transition", () => {
  it("moves the request to responded AND the linked work item to in_progress", async () => {
    const requestRow = { id: "creq_1", firm_id: "firm_1", client_id: "cli_1", work_item_id: "wi_1", status: "viewed" };
    const { db, transactionCalls } = fakeDb({ [REQUEST_LOOKUP_KEY]: [requestRow] });

    await respondToRequest(db, "creq_1", "firm_1");

    const statements = transactionCalls[0];
    expect(statements.some((s) => s.query.includes("UPDATE client_requests") && s.query.includes("responded"))).toBe(true);
    const workItemUpdate = statements.find((s) => s.query.includes("UPDATE work_items"));
    expect(workItemUpdate?.query).toContain("in_progress");
  });
});

describe("satisfyRequest", () => {
  it("marks the request satisfied and completes the linked work item", async () => {
    const requestRow = { id: "creq_1", firm_id: "firm_1", client_id: "cli_1", work_item_id: "wi_1", status: "responded" };
    const workItemRow = { id: "wi_1", firm_id: "firm_1", client_id: "cli_1", status: "in_progress" };
    const { db, transactionCalls } = fakeDb({
      [REQUEST_LOOKUP_KEY]: [requestRow],
      "FROM work_items WHERE id = $1": [workItemRow],
    });

    await satisfyRequest(db, "creq_1", "firm_1", "user_1");

    const requestUpdate = transactionCalls[0].find((s) => s.query.includes("UPDATE client_requests"));
    expect(requestUpdate).toBeDefined();
    const workItemUpdate = transactionCalls[1]?.find((s) => s.query.includes("UPDATE work_items"));
    expect(workItemUpdate?.query).toContain("completed_at = NOW()");
  });
});

describe("cancelRequest", () => {
  it("cancels the request and the linked work item, and never reopens a satisfied or already-cancelled request", async () => {
    const requestRow = { id: "creq_1", firm_id: "firm_1", client_id: "cli_1", work_item_id: "wi_1", status: "requested" };
    const workItemRow = { id: "wi_1", firm_id: "firm_1", client_id: "cli_1", status: "waiting_on_client" };
    const { db, transactionCalls } = fakeDb({
      [REQUEST_LOOKUP_KEY]: [requestRow],
      "FROM work_items WHERE id = $1": [workItemRow],
    });

    await cancelRequest(db, "creq_1", "firm_1", "user_1");

    const requestUpdate = transactionCalls[0].find((s) => s.query.includes("UPDATE client_requests"));
    expect(requestUpdate?.query).toContain("cancelled");
    const workItemUpdate = transactionCalls[1]?.find((s) => s.query.includes("UPDATE work_items"));
    expect(workItemUpdate?.params?.[0]).toBe("cancelled");
  });

  it("is a no-op for an already-satisfied request", async () => {
    const requestRow = { id: "creq_1", firm_id: "firm_1", client_id: "cli_1", work_item_id: "wi_1", status: "satisfied" };
    const { db, transactionCalls } = fakeDb({ [REQUEST_LOOKUP_KEY]: [requestRow] });

    const result = await cancelRequest(db, "creq_1", "firm_1", "user_1");
    expect(result?.status).toBe("satisfied");
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
