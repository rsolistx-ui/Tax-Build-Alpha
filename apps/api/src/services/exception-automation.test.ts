import { describe, expect, it } from "vitest";
import type { Db, DbStatement } from "../db";
import { prepareMissingReceiptRequest, prepareTransactionExplanationRequest } from "./exception-automation";

type QueryImpl = (sql: string, params: unknown[]) => unknown[] | undefined;

function fakeDb(queryImpl: QueryImpl): { db: Db; transactionCalls: DbStatement[][]; plainQueries: { sql: string; params: unknown[] }[] } {
  const transactionCalls: DbStatement[][] = [];
  const plainQueries: { sql: string; params: unknown[] }[] = [];
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      plainQueries.push({ sql, params });
      return (queryImpl(sql, params) ?? []) as T[];
    },
    async transaction<T>(statements: DbStatement[]) {
      transactionCalls.push(statements);
      return statements.map(() => []) as T[][];
    },
  };
  return { db, transactionCalls, plainQueries };
}

const txn = {
  id: "btx_1",
  client_id: "cli_1",
  txn_date: "2026-03-01",
  description: "Unknown Vendor",
  amount: "42.50",
  triage: null,
  pending_receipt_id: null,
};

describe("prepareMissingReceiptRequest race-safe claim", () => {
  it("claims the slot with a single INSERT ... ON CONFLICT DO NOTHING RETURNING id, then atomically attaches the work item", async () => {
    const requestRow = { id: "creq_claimed", firm_id: "firm_1", client_id: "cli_1", status: "draft", related_bank_transaction_id: "btx_1" };
    const { db, transactionCalls, plainQueries } = fakeDb((sql) => {
      if (sql.includes("INSERT INTO client_requests") && sql.includes("ON CONFLICT")) return [{ id: "creq_claimed" }];
      if (sql.includes("FROM client_requests WHERE id = $1 AND firm_id = $2")) return [requestRow];
      return undefined;
    });

    const result = await prepareMissingReceiptRequest(db, "firm_1", "user_1", txn);

    expect(result.status).toBe("draft");
    const claim = plainQueries.find((q) => q.sql.includes("ON CONFLICT"));
    expect(claim?.sql).toContain("related_bank_transaction_id");
    expect(claim?.sql).toContain("status != 'cancelled'");
    expect(claim?.params).toContain("btx_1");

    // phase 2: work item + its audit + the request's work_item_id update + the request's audit, all one transaction
    expect(transactionCalls).toHaveLength(1);
    const statements = transactionCalls[0];
    expect(statements.some((s) => s.query.includes("INSERT INTO work_items"))).toBe(true);
    expect(statements.some((s) => s.query.includes("UPDATE client_requests SET work_item_id"))).toBe(true);
    expect(statements.filter((s) => s.query.includes("INSERT INTO work_audit_events"))).toHaveLength(2);
  });

  it("is race-safe idempotent: when the DB-level unique index rejects the insert (ON CONFLICT DO NOTHING), returns the existing active request and creates no work item", async () => {
    const existing = { id: "creq_existing", firm_id: "firm_1", client_id: "cli_1", status: "requested", related_bank_transaction_id: "btx_1" };
    const { db, transactionCalls } = fakeDb((sql) => {
      if (sql.includes("INSERT INTO client_requests") && sql.includes("ON CONFLICT")) return []; // DO NOTHING: no row returned
      if (sql.includes("WHERE related_bank_transaction_id = $1 AND status != 'cancelled'")) return [existing];
      return undefined;
    });

    const result = await prepareMissingReceiptRequest(db, "firm_1", "user_1", txn);

    expect(result).toBe(existing);
    expect(transactionCalls).toHaveLength(0); // no work item created for the losing side of the race
  });
});

describe("prepareTransactionExplanationRequest", () => {
  it("claims the slot and creates a transaction_explanation draft", async () => {
    const requestRow = { id: "creq_2", firm_id: "firm_1", client_id: "cli_1", status: "draft", related_bank_transaction_id: "btx_1" };
    const { db, plainQueries } = fakeDb((sql) => {
      if (sql.includes("INSERT INTO client_requests") && sql.includes("ON CONFLICT")) return [{ id: "creq_2" }];
      if (sql.includes("FROM client_requests WHERE id = $1 AND firm_id = $2")) return [requestRow];
      return undefined;
    });

    const result = await prepareTransactionExplanationRequest(db, "firm_1", "user_1", txn);

    expect(result.status).toBe("draft");
    const claim = plainQueries.find((q) => q.sql.includes("ON CONFLICT"));
    expect(claim?.params).toContain("transaction_explanation");
  });
});
