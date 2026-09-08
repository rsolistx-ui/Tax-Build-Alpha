import { describe, expect, it } from "vitest";
import type { Db, DbStatement } from "../db";
import { prepareMissingReceiptRequest, prepareTransactionExplanationRequest } from "./exception-automation";

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

const EXISTING_REQUEST_KEY = "WHERE related_bank_transaction_id = $1";
const WORK_ITEM_LOOKUP_KEY = "FROM work_items WHERE id = $1";
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

describe("prepareMissingReceiptRequest", () => {
  it("creates a draft request (not yet client-visible via approval) for the transaction", async () => {
    const workItemRow = { id: "wi_1", firm_id: "firm_1", client_id: "cli_1", status: "open" };
    const requestRow = { id: "creq_1", firm_id: "firm_1", client_id: "cli_1", status: "draft", related_bank_transaction_id: "btx_1" };
    const { db, transactionCalls } = fakeDb({
      [EXISTING_REQUEST_KEY]: [],
      [WORK_ITEM_LOOKUP_KEY]: [workItemRow],
      [REQUEST_LOOKUP_KEY]: [requestRow],
    });

    const result = await prepareMissingReceiptRequest(db, "firm_1", "user_1", txn);

    expect(result.status).toBe("draft");
    const insert = transactionCalls[1].find((s) => s.query.includes("INSERT INTO client_requests"));
    expect(insert?.params?.[4]).toBe("missing_receipt");
    expect(insert?.params?.[10]).toBe("btx_1"); // related_bank_transaction_id
  });

  it("is idempotent: returns the existing non-cancelled request instead of creating a duplicate", async () => {
    const existing = { id: "creq_existing", firm_id: "firm_1", client_id: "cli_1", status: "requested", related_bank_transaction_id: "btx_1" };
    const { db, transactionCalls } = fakeDb({ [EXISTING_REQUEST_KEY]: [existing] });

    const result = await prepareMissingReceiptRequest(db, "firm_1", "user_1", txn);

    expect(result).toBe(existing);
    expect(transactionCalls).toHaveLength(0);
  });
});

describe("prepareTransactionExplanationRequest", () => {
  it("creates a draft transaction_explanation request", async () => {
    const workItemRow = { id: "wi_2", firm_id: "firm_1", client_id: "cli_1", status: "open" };
    const requestRow = { id: "creq_2", firm_id: "firm_1", client_id: "cli_1", status: "draft", related_bank_transaction_id: "btx_1" };
    const { db, transactionCalls } = fakeDb({
      [EXISTING_REQUEST_KEY]: [],
      [WORK_ITEM_LOOKUP_KEY]: [workItemRow],
      [REQUEST_LOOKUP_KEY]: [requestRow],
    });

    const result = await prepareTransactionExplanationRequest(db, "firm_1", "user_1", txn);

    expect(result.status).toBe("draft");
    const insert = transactionCalls[1].find((s) => s.query.includes("INSERT INTO client_requests"));
    expect(insert?.params?.[4]).toBe("transaction_explanation");
  });
});
