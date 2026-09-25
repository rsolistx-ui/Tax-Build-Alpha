import { describe, expect, it } from "vitest";
import type { Db, DbStatement } from "../db";
import { applyDocumentReviewAction as applyReviewAction, checkReadinessTransitionAllowed, taxYearRange, countResolvedBankTxns, type DocumentReviewAction } from "./workspace";

// These tests act as a role that may read signed records.
const applyDocumentReviewAction = (db: Db, firmId: string, documentId: string, actor: string, body: DocumentReviewAction) =>
  applyReviewAction(db, firmId, documentId, actor, body, false);

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
    expect(result).toEqual({ ok: true, terminal: false });
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
    expect(result).toEqual({ ok: true, terminal: false });
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
    expect(result).toEqual({ ok: true, terminal: false });
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
      "FROM tax_form_mappings": [{ c: "3" }],
    });
    const result = await checkReadinessTransitionAllowed(db, baseClient, 2025, "ready_for_preparation");
    expect(result).toEqual({ ok: true });
  });

  it("blocks complete when bookkeeping is incomplete, without requiring the checklist check", async () => {
    const { db } = fakeDb({
      "matched_receipt_id, disposition FROM bank_transactions": [{ matched_receipt_id: "rcp_1", disposition: "unclassified" }],
      "FROM tax_form_mappings": [{ c: "3" }],
      "disposition, triage, category_id, currency FROM bank_transactions": [
        { id: "txn_1", txn_date: "2025-01-01", description: "x", amount: -10, disposition: "unclassified", triage: "unmatched", category_id: null, currency: "USD" },
      ],
    });
    const result = await checkReadinessTransitionAllowed(db, baseClient, 2025, "complete");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons).toEqual(["bookkeeping_incomplete"]);
  });
});

describe("checkReadinessTransitionAllowed tax diagnostics gate (M7)", () => {
  it("blocks ready_for_preparation when a tax diagnostic is an error, even with bookkeeping and checklist clear", async () => {
    const { db } = fakeDb({
      "AND status IN ('expected', 'requested')": [{ count: "0" }],
      "FROM tax_form_mappings": [{ c: "3" }],
      "FROM tax_adjustment_journals": [{ id: "tj_1", status: "draft" }],
    });
    const result = await checkReadinessTransitionAllowed(db, baseClient, 2025, "ready_for_preparation");
    expect(result).toEqual({ ok: false, reasons: ["tax_diagnostics_errors"] });
  });

  it("blocks preparation_started when the client has no tax form mappings for the year", async () => {
    const { db } = fakeDb({});
    const result = await checkReadinessTransitionAllowed(db, baseClient, 2025, "preparation_started");
    expect(result).toEqual({ ok: false, reasons: ["tax_diagnostics_errors"] });
  });

  it("does not run the gate for non-approval states", async () => {
    const { db } = fakeDb({ "FROM tax_adjustment_journals": [{ id: "tj_1", status: "draft" }] });
    expect(await checkReadinessTransitionAllowed(db, baseClient, 2025, "collecting_documents")).toEqual({ ok: true });
  });
});

describe("applyDocumentReviewAction terminal vs nonterminal", () => {
  it("marks confirm as terminal", async () => {
    const { db } = fakeDb({ [DOCUMENT_LOOKUP_KEY]: [baseDocument] });
    const result = await applyDocumentReviewAction(db, "firm_1", "doc_1", "user_1", { action: "confirm" });
    expect(result).toEqual({ ok: true, terminal: true });
  });

  it("marks mark_duplicate as terminal", async () => {
    const { db } = fakeDb({ [DOCUMENT_LOOKUP_KEY]: [baseDocument] });
    const result = await applyDocumentReviewAction(db, "firm_1", "doc_1", "user_1", { action: "mark_duplicate" });
    expect(result).toEqual({ ok: true, terminal: true });
  });

  it("marks mark_not_needed as terminal", async () => {
    const { db } = fakeDb({ [DOCUMENT_LOOKUP_KEY]: [baseDocument] });
    const result = await applyDocumentReviewAction(db, "firm_1", "doc_1", "user_1", { action: "mark_not_needed" });
    expect(result).toEqual({ ok: true, terminal: true });
  });

  it("marks assign_document_type as nonterminal", async () => {
    const { db } = fakeDb({ [DOCUMENT_LOOKUP_KEY]: [baseDocument] });
    const result = await applyDocumentReviewAction(db, "firm_1", "doc_1", "user_1", { action: "assign_document_type", documentType: "receipt" });
    expect(result).toEqual({ ok: true, terminal: false });
  });

  it("marks assign_tax_year as nonterminal", async () => {
    const { db } = fakeDb({ [DOCUMENT_LOOKUP_KEY]: [baseDocument] });
    const result = await applyDocumentReviewAction(db, "firm_1", "doc_1", "user_1", { action: "assign_tax_year", taxYear: 2026 });
    expect(result).toEqual({ ok: true, terminal: false });
  });
});

describe("applyDocumentReviewAction tax-year input validation", () => {
  it("rejects a non-integer taxYear on assign_tax_year with 400", async () => {
    const { db, transactionCalls } = fakeDb({ [DOCUMENT_LOOKUP_KEY]: [baseDocument] });
    const result = await applyDocumentReviewAction(db, "firm_1", "doc_1", "user_1", { action: "assign_tax_year", taxYear: 2025.5 });
    expect(result).toEqual({ ok: false, status: 400, error: "taxYear must be an integer between 2000 and 2100" });
    expect(transactionCalls).toHaveLength(0);
  });

  it("rejects an out-of-range taxYear on assign_tax_year with 400", async () => {
    const { db, transactionCalls } = fakeDb({ [DOCUMENT_LOOKUP_KEY]: [baseDocument] });
    const result = await applyDocumentReviewAction(db, "firm_1", "doc_1", "user_1", { action: "assign_tax_year", taxYear: 1899 });
    expect(result).toEqual({ ok: false, status: 400, error: "taxYear must be an integer between 2000 and 2100" });
    expect(transactionCalls).toHaveLength(0);
  });

  it("rejects an out-of-range taxYear on correct with 400", async () => {
    const { db, transactionCalls } = fakeDb({ [DOCUMENT_LOOKUP_KEY]: [baseDocument] });
    const result = await applyDocumentReviewAction(db, "firm_1", "doc_1", "user_1", { action: "correct", taxYear: 3000 });
    expect(result).toEqual({ ok: false, status: 400, error: "taxYear must be an integer between 2000 and 2100" });
    expect(transactionCalls).toHaveLength(0);
  });
});

describe("taxYearRange", () => {
  it("returns null bounds for no configured tax year", () => {
    expect(taxYearRange(null)).toEqual({ startDate: null, endDate: null });
  });

  it("returns Jan 1 - Dec 31 for a configured tax year", () => {
    expect(taxYearRange(2025)).toEqual({ startDate: "2025-01-01", endDate: "2025-12-31" });
  });
});

/**
 * Cross-tax-year isolation itself (a 2026 transaction never blocking 2025
 * readiness) is a real Postgres WHERE-clause behavior - fakeDb here is a
 * substring-matching stub with no parameter awareness, so it cannot
 * distinguish "$2/$3 filtered this row out" from "this row was never
 * returned". That behavior is proven for real against production Postgres
 * by the extended production smoke test (two-tax-year isolation check).
 * This just proves the date bounds computeCanonicalReadiness receives are
 * actually derived from the requested tax year.
 */
describe("taxYearRange feeds computeCanonicalReadiness's date bounds", () => {
  it("computes the 2025 tax year as Jan 1 - Dec 31 2025, not 2026", () => {
    expect(taxYearRange(2025)).toEqual({ startDate: "2025-01-01", endDate: "2025-12-31" });
    expect(taxYearRange(2025)).not.toEqual(taxYearRange(2026));
  });
});

/**
 * A genuine, parameter-aware fake DB: unlike the substring-matching
 * fakeDb() above, this one actually applies the $2/$3 date-range params to
 * the bank_transactions rows it returns, so a test against it proves
 * taxYear truly filters activity by date rather than merely computing the
 * right bounds and passing them through unused.
 */
function dateAwareFakeDb(bankRows: Array<{
  id: string; txn_date: string; disposition: string; triage: string; category_id: string | null; currency: string;
}>): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      if (sql.includes("FROM bank_transactions") && sql.includes("txn_date >=")) {
        const [, startDate, endDate] = params as [string, string | null, string | null];
        return bankRows
          .filter((r) => (!startDate || r.txn_date >= startDate) && (!endDate || r.txn_date <= endDate))
          .map((r) => ({
            id: r.id, txn_date: r.txn_date, description: null, amount: 100,
            disposition: r.disposition, triage: r.triage, category_id: r.category_id, currency: r.currency,
          })) as unknown as T[];
      }
      if (sql.includes("FROM client_profiles")) {
        return [{ accounting_basis: null, default_currency: "USD" }] as unknown as T[];
      }
      if (sql.includes("FROM document_checklist_items WHERE client_id")) {
        return [{ count: "0" }] as unknown as T[];
      }
      if (sql.includes("FROM tax_form_mappings")) {
        return [{ c: "1" }] as unknown as T[];
      }
      return [] as T[];
    },
    async transaction<T>(statements: DbStatement[]) {
      return statements.map(() => []) as T[][];
    },
  };
}

describe("computeCanonicalReadiness cross-tax-year isolation (real date-bound filtering)", () => {
  const client = { id: "cli_cross_year", name: "Cross Year Co", legal_name: null, updated_at: "2026-01-01" };

  it("a 2026 unclassified transaction does not block 2025 readiness, and does block 2026", async () => {
    const db = dateAwareFakeDb([
      { id: "t2025", txn_date: "2025-06-01", disposition: "business_expense", triage: "resolved", category_id: "cat_1", currency: "USD" },
      { id: "t2026", txn_date: "2026-06-01", disposition: "unclassified", triage: "resolved", category_id: null, currency: "USD" },
    ]);

    const result2025 = await checkReadinessTransitionAllowed(db, client, 2025, "ready_for_preparation");
    expect(result2025.ok).toBe(true);

    const result2026 = await checkReadinessTransitionAllowed(db, client, 2026, "ready_for_preparation");
    expect(result2026.ok).toBe(false);
    if (!result2026.ok) expect(result2026.reasons).toContain("bookkeeping_incomplete");
  });

  it("2026 becomes ready once its transaction is resolved, independent of 2025's own state", async () => {
    const db = dateAwareFakeDb([
      { id: "t2025", txn_date: "2025-06-01", disposition: "business_expense", triage: "resolved", category_id: "cat_1", currency: "USD" },
      { id: "t2026", txn_date: "2026-06-01", disposition: "business_expense", triage: "resolved", category_id: "cat_1", currency: "USD" },
    ]);

    const result2026 = await checkReadinessTransitionAllowed(db, client, 2026, "ready_for_preparation");
    expect(result2026.ok).toBe(true);
    const result2025 = await checkReadinessTransitionAllowed(db, client, 2025, "ready_for_preparation");
    expect(result2025.ok).toBe(true);
  });
});


describe("countResolvedBankTxns", () => {
  it("counts matched transactions as resolved", () => {
    expect(countResolvedBankTxns([{ triage: "matched" }, { triage: "unclassified" }])).toBe(1);
  });

  it("counts no_receipt_required transactions as resolved, same as matched", () => {
    expect(countResolvedBankTxns([{ triage: "matched" }, { triage: "no_receipt_required" }, { triage: "unclassified" }])).toBe(2);
  });

  it("does not count unresolved triage states", () => {
    expect(countResolvedBankTxns([{ triage: "unclassified" }, { triage: "review" }, { triage: null }])).toBe(0);
  });
});

describe("applyDocumentReviewAction signed records", () => {
  it("treats a signed record as not found for a role that cannot read signed records, without writing", async () => {
    const seen: Array<{ sql: string; params: unknown[] }> = [];
    const transactionCalls: DbStatement[][] = [];
    const db: Db = {
      async query<T>(sql: string, params: unknown[] = []) {
        seen.push({ sql, params });
        return [] as T[]; // the signed-record filter excludes the row
      },
      async transaction<T>(statements: DbStatement[]) {
        transactionCalls.push(statements);
        return statements.map(() => []) as T[][];
      },
    };
    const result = await applyReviewAction(db, "firm_1", "doc_signed", "user_bk", { action: "confirm" }, true);
    expect(result).toEqual({ ok: false, status: 404, error: "Not found" });
    const lookup = seen.find((q) => q.sql.includes("cd.id, cd.client_id, cd.status"));
    expect(lookup?.sql).toContain("signature_requests");
    expect(lookup?.params).toEqual(["doc_signed", "firm_1", true, null]);
    expect(transactionCalls).toHaveLength(0);
  });
});
