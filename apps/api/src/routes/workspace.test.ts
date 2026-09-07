import { describe, expect, it } from "vitest";
import type { Db, DbStatement } from "../db";
import { applyDocumentReviewAction, checkReadinessTransitionAllowed } from "./workspace";

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

const DOCUMENT_LOOKUP_KEY = "cd.id, cd.client_id, cd.status";
const CHECKLIST_OWNERSHIP_KEY = "FROM document_checklist_items WHERE id = $1";
const TARGET_CLIENT_KEY = "FROM clients WHERE id = $1 AND firm_id";
const DUPLICATE_TARGET_KEY = "cd.id = $1 AND cd.client_id = $2 AND c.firm_id = $3";

const baseDocument = { id: "doc_1", client_id: "cli_a", status: "needs_review", document_type: "other", tax_year: 2025, firm_id: "firm_1" };

describe("applyDocumentReviewAction cross-client relation integrity", () => {
  it("rejects correct when checklistItemId belongs to a different client, without writing anything", async () => {
    const { db, transactionCalls } = fakeDb({
      [DOCUMENT_LOOKUP_KEY]: [baseDocument],
      [CHECKLIST_OWNERSHIP_KEY]: [], // not found for this client
    });
    const result = await applyDocumentReviewAction(db, "firm_1", "doc_1", "user_1", {
      action: "correct",
      checklistItemId: "chk_other_client",
    });
    expect(result).toEqual({ ok: false, status: 404, error: "Checklist item not found for this client" });
    expect(transactionCalls).toHaveLength(0);
  });

  it("allows correct when checklistItemId belongs to the document's own client", async () => {
    const { db, transactionCalls } = fakeDb({
      [DOCUMENT_LOOKUP_KEY]: [baseDocument],
      [CHECKLIST_OWNERSHIP_KEY]: [{ id: "chk_1" }],
    });
    const result = await applyDocumentReviewAction(db, "firm_1", "doc_1", "user_1", {
      action: "correct",
      checklistItemId: "chk_1",
    });
    expect(result).toEqual({ ok: true });
    expect(transactionCalls).toHaveLength(1);
  });

  it("rejects match_checklist when the checklist item belongs to a different client", async () => {
    const { db, transactionCalls } = fakeDb({
      [DOCUMENT_LOOKUP_KEY]: [baseDocument],
      [CHECKLIST_OWNERSHIP_KEY]: [],
    });
    const result = await applyDocumentReviewAction(db, "firm_1", "doc_1", "user_1", {
      action: "match_checklist",
      checklistItemId: "chk_other_client",
    });
    expect(result).toEqual({ ok: false, status: 404, error: "Checklist item not found for this client" });
    expect(transactionCalls).toHaveLength(0);
  });

  it("rejects mark_duplicate when the target document belongs to a different client or firm", async () => {
    const { db, transactionCalls } = fakeDb({
      [DOCUMENT_LOOKUP_KEY]: [baseDocument],
      [DUPLICATE_TARGET_KEY]: [],
    });
    const result = await applyDocumentReviewAction(db, "firm_1", "doc_1", "user_1", {
      action: "mark_duplicate",
      duplicateOfDocumentId: "doc_cross_client",
    });
    expect(result).toEqual({ ok: false, status: 404, error: "Duplicate target not found for this client" });
    expect(transactionCalls).toHaveLength(0);
  });

  it("rejects mark_duplicate when the target is the document itself", async () => {
    const { db, transactionCalls } = fakeDb({ [DOCUMENT_LOOKUP_KEY]: [baseDocument] });
    const result = await applyDocumentReviewAction(db, "firm_1", "doc_1", "user_1", {
      action: "mark_duplicate",
      duplicateOfDocumentId: "doc_1",
    });
    expect(result).toEqual({ ok: false, status: 400, error: "A document cannot be marked a duplicate of itself" });
    expect(transactionCalls).toHaveLength(0);
  });

  it("rejects assign_client when the target client is not in the same firm", async () => {
    const { db, transactionCalls } = fakeDb({
      [DOCUMENT_LOOKUP_KEY]: [baseDocument],
      [TARGET_CLIENT_KEY]: [],
    });
    const result = await applyDocumentReviewAction(db, "firm_1", "doc_1", "user_1", {
      action: "assign_client",
      targetClientId: "cli_other_firm",
    });
    expect(result).toEqual({ ok: false, status: 404, error: "Target client not found in this firm" });
    expect(transactionCalls).toHaveLength(0);
  });

  it("clears checklist_item_id and duplicate_of_document_id when reassigning to a new client", async () => {
    const { db, transactionCalls } = fakeDb({
      [DOCUMENT_LOOKUP_KEY]: [baseDocument],
      [TARGET_CLIENT_KEY]: [{ id: "cli_b" }],
    });
    const result = await applyDocumentReviewAction(db, "firm_1", "doc_1", "user_1", {
      action: "assign_client",
      targetClientId: "cli_b",
    });
    expect(result).toEqual({ ok: true });
    const [statements] = transactionCalls;
    const updateStatement = statements.find((s) => s.query.includes("SET client_id"));
    expect(updateStatement?.query).toContain("checklist_item_id = NULL");
    expect(updateStatement?.query).toContain("duplicate_of_document_id = NULL");
  });

  it("writes the checklist match and the audit event atomically in one transaction", async () => {
    const { db, transactionCalls } = fakeDb({
      [DOCUMENT_LOOKUP_KEY]: [baseDocument],
      [CHECKLIST_OWNERSHIP_KEY]: [{ id: "chk_1" }],
    });
    const result = await applyDocumentReviewAction(db, "firm_1", "doc_1", "user_1", {
      action: "match_checklist",
      checklistItemId: "chk_1",
    });
    expect(result).toEqual({ ok: true });
    expect(transactionCalls).toHaveLength(1);
    const [statements] = transactionCalls;
    expect(statements.some((s) => s.query.includes("UPDATE client_documents SET checklist_item_id"))).toBe(true);
    expect(statements.some((s) => s.query.includes("UPDATE document_checklist_items SET status = 'received'"))).toBe(true);
    expect(statements.some((s) => s.query.includes("INSERT INTO audit_events"))).toBe(true);
  });

  it("returns 404 for a document outside the caller's firm", async () => {
    const { db, transactionCalls } = fakeDb({ [DOCUMENT_LOOKUP_KEY]: [] });
    const result = await applyDocumentReviewAction(db, "firm_1", "doc_1", "user_1", { action: "confirm" });
    expect(result).toEqual({ ok: false, status: 404, error: "Not found" });
    expect(transactionCalls).toHaveLength(0);
  });
});

const baseClient = { id: "cli_a", name: "Acme LLC", legal_name: null, updated_at: "2026-01-01T00:00:00Z" };

describe("checkReadinessTransitionAllowed", () => {
  it("allows a non-approval status regardless of bookkeeping state", async () => {
    const { db } = fakeDb({});
    const result = await checkReadinessTransitionAllowed(db, baseClient, 2025, "professional_review");
    expect(result).toEqual({ ok: true });
  });

  it("blocks ready_for_preparation when bookkeeping is incomplete", async () => {
    const { db } = fakeDb({
      "disposition, triage, category_id, currency FROM bank_transactions": [
        { id: "txn_1", txn_date: "2025-01-01", description: "x", amount: -10, disposition: "unclassified", triage: "unmatched", category_id: null, currency: "USD" },
      ],
    });
    const result = await checkReadinessTransitionAllowed(db, baseClient, 2025, "ready_for_preparation");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons).toContain("bookkeeping_incomplete");
  });

  it("blocks ready_for_preparation when required checklist items remain expected or requested", async () => {
    const { db } = fakeDb({
      "AND status IN ('expected', 'requested')": [{ count: "2" }],
    });
    const result = await checkReadinessTransitionAllowed(db, baseClient, 2025, "ready_for_preparation");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons).toContain("checklist_items_outstanding");
  });

  it("allows ready_for_preparation when bookkeeping is complete and no checklist items are outstanding", async () => {
    const { db } = fakeDb({
      "AND status IN ('expected', 'requested')": [{ count: "0" }],
    });
    const result = await checkReadinessTransitionAllowed(db, baseClient, 2025, "ready_for_preparation");
    expect(result).toEqual({ ok: true });
  });

  it("blocks complete when bookkeeping is incomplete, without requiring the checklist check", async () => {
    const { db } = fakeDb({
      "matched_receipt_id, disposition FROM bank_transactions": [{ matched_receipt_id: "rcp_1", disposition: "unclassified" }],
      "disposition, triage, category_id, currency FROM bank_transactions": [
        { id: "txn_1", txn_date: "2025-01-01", description: "x", amount: -10, disposition: "unclassified", triage: "unmatched", category_id: null, currency: "USD" },
      ],
    });
    const result = await checkReadinessTransitionAllowed(db, baseClient, 2025, "complete");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons).toEqual(["bookkeeping_incomplete"]);
  });
});
