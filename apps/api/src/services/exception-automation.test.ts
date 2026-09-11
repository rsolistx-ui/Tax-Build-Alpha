import { describe, expect, it } from "vitest";
import type { Db, DbStatement } from "../db";
import { prepareMissingReceiptRequest, prepareTransactionExplanationRequest } from "./exception-automation";

type QueryImpl = (sql: string, params: unknown[]) => unknown[] | undefined;

function fakeDb(queryImpl: QueryImpl, transactionImpl?: (statements: DbStatement[]) => void): {
  db: Db;
  transactionCalls: DbStatement[][];
  plainQueries: { sql: string; params: unknown[] }[];
} {
  const transactionCalls: DbStatement[][] = [];
  const plainQueries: { sql: string; params: unknown[] }[] = [];
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      plainQueries.push({ sql, params });
      return (queryImpl(sql, params) ?? []) as T[];
    },
    async transaction<T>(statements: DbStatement[]) {
      transactionCalls.push(statements);
      transactionImpl?.(statements);
      return statements.map(() => []) as T[][];
    },
  };
  return { db, transactionCalls, plainQueries };
}

const REQUEST_LOOKUP_KEY = "FROM client_requests WHERE id = $1 AND firm_id = $2";

const txn = {
  id: "btx_1",
  client_id: "cli_1",
  txn_date: "2026-03-01",
  description: "Unknown Vendor",
  amount: "42.50",
  triage: null,
  pending_receipt_id: null,
};

describe("prepareMissingReceiptRequest full atomicity", () => {
  it("creates the work item and the client request as ONE transaction call", async () => {
    const requestRow = { id: "creq_1", firm_id: "firm_1", client_id: "cli_1", status: "draft", related_bank_transaction_id: "btx_1" };
    const { db, transactionCalls } = fakeDb((sql) => (sql.includes(REQUEST_LOOKUP_KEY) ? [requestRow] : undefined));

    const result = await prepareMissingReceiptRequest(db, "firm_1", "user_1", txn);

    expect(result.status).toBe("draft");
    expect(transactionCalls).toHaveLength(1);
    const statements = transactionCalls[0];
    expect(statements.some((s) => s.query.includes("INSERT INTO work_items"))).toBe(true);
    expect(statements.some((s) => s.query.includes("INSERT INTO client_requests"))).toBe(true);
    expect(statements.filter((s) => s.query.includes("INSERT INTO work_audit_events"))).toHaveLength(2);
    expect(statements.some((s) => s.query.includes("INSERT INTO agent_tasks") && String(s.params?.[6]) === "request_draft")).toBe(true);
    expect(statements.find((s) => String(s.params?.[6]) === "request_draft")?.params?.[7]).toBe("autonomous");
    expect(statements.find((s) => String(s.params?.[6]) === "request_draft")?.params?.[8]).toBe("completed");
  });

  it("on a unique-constraint conflict, returns the existing active request and performs no additional writes (no orphan work item, no permanently-failed retry)", async () => {
    const existing = { id: "creq_existing", firm_id: "firm_1", client_id: "cli_1", status: "requested", related_bank_transaction_id: "btx_1" };
    const { db, transactionCalls, plainQueries } = fakeDb((sql) =>
      sql.includes("WHERE related_bank_transaction_id = $1 AND status != 'cancelled'") ? [existing] : undefined,
    (() => {
      throw new Error('duplicate key value violates unique constraint "uq_requests_active_bank_txn"');
    }) as never);

    // fakeDb's transaction always throws here to simulate the DB rejecting
    // the whole atomic insert because of the concurrent winner.
    const result = await prepareMissingReceiptRequest(db, "firm_1", "user_1", txn);

    expect(result).toEqual(existing);
    expect(transactionCalls).toHaveLength(1); // the one attempted (and rejected) transaction; nothing was written
    expect(plainQueries.some((q) => q.sql.includes("WHERE related_bank_transaction_id = $1 AND status != 'cancelled'"))).toBe(true);
  });

  it("propagates any database failure that is NOT the specific unique-constraint conflict, without treating it as a race loss", async () => {
    const { db } = fakeDb(() => undefined, (() => {
      throw new Error("Neon query failed (500): connection reset");
    }) as never);

    await expect(prepareMissingReceiptRequest(db, "firm_1", "user_1", txn)).rejects.toThrow("connection reset");
  });
});

describe("prepareTransactionExplanationRequest", () => {
  it("creates a draft transaction_explanation request via the same atomic path", async () => {
    const requestRow = { id: "creq_2", firm_id: "firm_1", client_id: "cli_1", status: "draft", related_bank_transaction_id: "btx_1" };
    const { db, transactionCalls } = fakeDb((sql) => (sql.includes(REQUEST_LOOKUP_KEY) ? [requestRow] : undefined));

    const result = await prepareTransactionExplanationRequest(db, "firm_1", "user_1", txn);

    expect(result.status).toBe("draft");
    const insert = transactionCalls[0].find((s) => s.query.includes("INSERT INTO client_requests"));
    expect(insert?.params?.[4]).toBe("transaction_explanation");
  });
});
