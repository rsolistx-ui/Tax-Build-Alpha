import { describe, expect, it } from "vitest";
import {
  buildClientDashboardRow,
  buildDocumentWorkflowActions,
  buildUncategorizedReceiptActions,
  sortActions,
  summarize,
  matchesFilter,
  matchesSearch,
  describeAuditEvent,
  type DashboardBankTxn,
  type DashboardReceipt,
  type DashboardClientMeta,
} from "./dashboard";

function meta(overrides: Partial<DashboardClientMeta> = {}): DashboardClientMeta {
  return {
    id: "cli_1",
    name: "Acme LLC",
    legalName: "Acme Legal LLC",
    taxYear: 2026,
    accountingBasis: "cash",
    currency: "USD",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function bankTxn(overrides: Partial<DashboardBankTxn> & { id: string }): DashboardBankTxn {
  return {
    clientId: "cli_1",
    date: "2026-01-05",
    description: "Test txn",
    amount: -50,
    disposition: "unclassified",
    triage: "unmatched",
    categoryId: null,
    currency: "USD",
    ...overrides,
  };
}

function receipt(overrides: Partial<DashboardReceipt> & { id: string }): DashboardReceipt {
  return {
    clientId: "cli_1",
    status: "filed",
    merchant: "Vendor Co",
    date: "2026-01-05",
    currency: "USD",
    categoryId: "cat_1",
    matchedBankDisposition: null,
    ...overrides,
  };
}

describe("buildClientDashboardRow - readiness", () => {
  it("a fully resolved client is ready", () => {
    const { row, actions } = buildClientDashboardRow(
      meta(),
      [bankTxn({ id: "t1", disposition: "business_expense", triage: "no_receipt_required", categoryId: "cat_1" })],
      [receipt({ id: "r1", status: "filed" })],
    );
    expect(row.readiness).toBe("ready");
    expect(row.isComplete).toBe(true);
    expect(actions).toHaveLength(0);
  });

  it("an unresolved triage/unclassified client is books_incomplete", () => {
    const { row } = buildClientDashboardRow(
      meta(),
      [bankTxn({ id: "t1", disposition: "unclassified", triage: "needs_review" })],
      [],
    );
    expect(row.readiness).toBe("books_incomplete");
    expect(row.unclassifiedCount).toBe(1);
    expect(row.unresolvedBankExceptionCount).toBe(1);
  });

  it("a missing-receipt (unmatched) transaction makes the client missing_evidence, overriding books_incomplete", () => {
    const { row } = buildClientDashboardRow(
      meta(),
      [bankTxn({ id: "t1", disposition: "business_expense", triage: "unmatched", categoryId: "cat_1" })],
      [],
    );
    expect(row.readiness).toBe("missing_evidence");
    expect(row.missingEvidenceCount).toBe(1);
  });

  it("a receipt awaiting review with otherwise-complete books is needs_review", () => {
    const { row } = buildClientDashboardRow(meta(), [], [receipt({ id: "r1", status: "review" })]);
    expect(row.readiness).toBe("needs_review");
    expect(row.receiptReviewCount).toBe(1);
  });
});

describe("buildClientDashboardRow - actions and deep links", () => {
  it("produces a currency conflict action with a deterministic deep link", () => {
    const { actions } = buildClientDashboardRow(
      meta({ currency: "USD" }),
      [bankTxn({ id: "t1", disposition: "business_expense", triage: "matched", currency: "EUR", categoryId: "cat_1" })],
      [],
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("currency_conflict");
    expect(actions[0].sourceEntityId).toBe("t1");
    expect(actions[0].deepLink).toBe("/clients/cli_1?tab=bank&focus=t1");
  });

  it("produces a receipt-review action with a deep link into the review tab", () => {
    const { actions } = buildClientDashboardRow(meta(), [], [receipt({ id: "r1", status: "uploaded" })]);
    expect(actions[0].type).toBe("receipt_review");
    expect(actions[0].deepLink).toBe("/clients/cli_1?tab=review&focus=r1");
  });

  it("uncategorized business activity produces its own action distinct from unclassified", () => {
    const { actions, row } = buildClientDashboardRow(
      meta(),
      [bankTxn({ id: "t1", disposition: "business_expense", triage: "matched", categoryId: null })],
      [],
    );
    expect(row.uncategorizedCount).toBe(1);
    expect(actions.map((a) => a.type)).toEqual(["uncategorized_activity"]);
  });

  it("a receipt matched to a personal bank transaction produces a disposition-conflict action, not a plain filed count", () => {
    const { actions, row } = buildClientDashboardRow(
      meta(),
      [],
      [receipt({ id: "r1", status: "filed", matchedBankDisposition: "personal" })],
    );
    expect(row.readiness).toBe("missing_evidence");
    expect(actions[0].type).toBe("receipt_disposition_conflict");
  });
});

describe("sortActions", () => {
  it("orders by priority ascending: conflicts before missing evidence before exceptions before unclassified before uncategorized before receipt review", () => {
    const build = (type: string, priority: number, id: string) => ({
      id,
      clientId: "cli_1",
      clientName: "Acme",
      type: type as any,
      priority,
      explanation: "x",
      date: "2026-01-01",
      sourceEntityId: id,
      deepLink: "/x",
    });
    const actions = [
      build("receipt_review", 6, "f"),
      build("uncategorized_activity", 5, "e"),
      build("unclassified_transaction", 4, "d"),
      build("bank_exception", 3, "c"),
      build("missing_evidence", 2, "b"),
      build("currency_conflict", 1, "a"),
    ];
    const sorted = sortActions([...actions].reverse());
    expect(sorted.map((a) => a.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("a resolved item that no longer appears in the source data produces no action - the queue is derived, not persisted", () => {
    const { actions } = buildClientDashboardRow(
      meta(),
      [bankTxn({ id: "t1", disposition: "business_expense", triage: "matched", categoryId: "cat_1" })],
      [],
    );
    expect(actions).toHaveLength(0);
  });
});

describe("summarize", () => {
  it("aggregates ready/needs-attention counts and per-signal totals across multiple clients", () => {
    const clientA = buildClientDashboardRow(
      meta({ id: "cli_a", name: "A" }),
      [bankTxn({ id: "a1", disposition: "business_expense", triage: "no_receipt_required", categoryId: "cat_1" })],
      [],
    );
    const clientB = buildClientDashboardRow(
      meta({ id: "cli_b", name: "B" }),
      [bankTxn({ id: "b1", disposition: "unclassified", triage: "unmatched" })],
      [receipt({ id: "br1", status: "review" })],
    );
    const rows = [clientA.row, clientB.row];
    const actions = sortActions([...clientA.actions, ...clientB.actions]);
    const summary = summarize(rows, actions);
    expect(summary.clients).toBe(2);
    expect(summary.clientsReady).toBe(1);
    expect(summary.clientsNeedingAttention).toBe(1);
    expect(summary.missingEvidence).toBe(1);
    expect(summary.receiptsAwaitingReview).toBe(1);
    expect(summary.totalOpenActions).toBe(actions.length);
  });

  it("an empty firm produces an all-zero summary rather than an error", () => {
    const summary = summarize([], []);
    expect(summary).toMatchObject({ clients: 0, clientsReady: 0, clientsNeedingAttention: 0, totalOpenActions: 0 });
  });
});

describe("matchesFilter", () => {
  it("filters clients by readiness and by workload signal", () => {
    const ready = buildClientDashboardRow(meta(), [], []).row;
    const needsAttention = buildClientDashboardRow(meta(), [bankTxn({ id: "t1", triage: "unmatched" })], []).row;
    expect(matchesFilter(ready, "ready")).toBe(true);
    expect(matchesFilter(ready, "needs_attention")).toBe(false);
    expect(matchesFilter(needsAttention, "needs_attention")).toBe(true);
    expect(matchesFilter(needsAttention, "missing_evidence")).toBe(true);
    expect(matchesFilter(needsAttention, "ready")).toBe(false);
  });
});

describe("matchesSearch", () => {
  it("matches by client name or legal name, case-insensitively", () => {
    const row = buildClientDashboardRow(meta({ name: "Acme LLC", legalName: "Acme Legal Holdings" }), [], []).row;
    expect(matchesSearch(row, "acme")).toBe(true);
    expect(matchesSearch(row, "HOLDINGS")).toBe(true);
    expect(matchesSearch(row, "nomatch")).toBe(false);
    expect(matchesSearch(row, "")).toBe(true);
  });
});

describe("describeAuditEvent", () => {
  it("turns a raw audit action into a human sentence, never the raw action string alone for known actions", () => {
    const result = describeAuditEvent({
      id: "aud_1",
      clientId: "cli_1",
      clientName: "Acme",
      action: "receipt_filed",
      actorUserId: "user_1",
      createdAt: "2026-01-01T00:00:00Z",
    });
    expect(result.summary).toBe("Receipt filed");
    expect(result.summary).not.toContain("_");
  });

  it("falls back to a readable label for an unrecognized action rather than throwing", () => {
    const result = describeAuditEvent({
      id: "aud_2",
      clientId: "cli_1",
      clientName: "Acme",
      action: "some_future_action",
      actorUserId: null,
      createdAt: "2026-01-01T00:00:00Z",
    });
    expect(result.summary).toBe("some future action");
  });
});

describe("buildDocumentWorkflowActions", () => {
  it("creates a missing_document action for an expected or requested checklist item", () => {
    const actions = buildDocumentWorkflowActions(
      "cli_1",
      "Acme LLC",
      [
        { id: "chk_1", clientId: "cli_1", taxYear: 2026, docType: "prior_year_return", customLabel: null, status: "expected" },
        { id: "chk_2", clientId: "cli_1", taxYear: 2026, docType: "1099", customLabel: null, status: "requested" },
      ],
      [],
    );
    expect(actions).toHaveLength(2);
    expect(actions.every((a) => a.type === "missing_document")).toBe(true);
    expect(actions[0].deepLink).toContain("tab=tax-readiness");
  });

  it("clears the missing_document action once the checklist item is received or reviewed", () => {
    const actions = buildDocumentWorkflowActions(
      "cli_1",
      "Acme LLC",
      [{ id: "chk_1", clientId: "cli_1", taxYear: 2026, docType: "prior_year_return", customLabel: null, status: "received" }],
      [],
    );
    expect(actions).toHaveLength(0);
  });

  it("does not treat completed personal/not_applicable checklist items as missing", () => {
    const actions = buildDocumentWorkflowActions(
      "cli_1",
      "Acme LLC",
      [{ id: "chk_1", clientId: "cli_1", taxYear: 2026, docType: "other", customLabel: "N/A item", status: "not_applicable" }],
      [],
    );
    expect(actions).toHaveLength(0);
  });

  it("creates a document_review action only for documents still needing review", () => {
    const actions = buildDocumentWorkflowActions(
      "cli_1",
      "Acme LLC",
      [],
      [
        { id: "doc_1", clientId: "cli_1", filename: "statement.pdf", documentType: "bank_statement", status: "needs_review" },
        { id: "doc_2", clientId: "cli_1", filename: "confirmed.pdf", documentType: "tax_document", status: "confirmed" },
      ],
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("document_review");
    expect(actions[0].sourceEntityId).toBe("doc_1");
  });

  it("assigns missing_document and document_review the priority tiers required by the milestone", () => {
    const actions = buildDocumentWorkflowActions(
      "cli_1",
      "Acme LLC",
      [{ id: "chk_1", clientId: "cli_1", taxYear: 2026, docType: "1099", customLabel: null, status: "expected" }],
      [{ id: "doc_1", clientId: "cli_1", filename: "receipt.jpg", documentType: "receipt", status: "needs_review" }],
    );
    const missing = actions.find((a) => a.type === "missing_document")!;
    const review = actions.find((a) => a.type === "document_review")!;
    expect(missing.priority).toBeLessThan(review.priority);
  });
});

describe("buildClientDashboardRow - uncategorizedCount includes receipt-line contributions", () => {
  it("does not read 0 when the only blocker is an uncategorized receipt line", () => {
    // All bank activity is already categorized business expense - nothing
    // uncategorized on the bank side - but 2 filed-receipt lines are.
    const { row } = buildClientDashboardRow(
      meta(),
      [bankTxn({ id: "txn_1", disposition: "business_expense", categoryId: "cat_1", triage: "matched" })],
      [],
      2,
    );
    expect(row.readiness).toBe("books_incomplete");
    expect(row.uncategorizedCount).toBe(2);
  });

  it("sums bank-side and receipt-line uncategorized counts, not just one or the other", () => {
    const { row } = buildClientDashboardRow(
      meta(),
      [bankTxn({ id: "txn_1", disposition: "business_expense", categoryId: null })],
      [],
      3,
    );
    expect(row.uncategorizedCount).toBe(4);
  });
});

describe("buildUncategorizedReceiptActions", () => {
  it("builds one action per affected receipt, not one per line", () => {
    const actions = buildUncategorizedReceiptActions("cli_1", "Acme LLC", [
      { receiptId: "rcpt_1", clientId: "cli_1", merchant: "Office Depot", date: "2026-01-05" },
      { receiptId: "rcpt_2", clientId: "cli_1", merchant: null, date: null },
    ]);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({
      type: "uncategorized_receipt_evidence",
      clientId: "cli_1",
      sourceEntityId: "rcpt_1",
      deepLink: "/clients/cli_1?tab=folders&focus=rcpt_1",
    });
    expect(actions[0].explanation).toContain("Office Depot");
  });

  it("returns no actions when nothing is affected", () => {
    expect(buildUncategorizedReceiptActions("cli_1", "Acme LLC", [])).toEqual([]);
  });
});
