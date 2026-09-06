import { describe, expect, it } from "vitest";
import {
  filterByDateRange,
  selectBankExpenseTransactions,
  selectBankIncomeTransactions,
  sumAmount,
  mergeExpenseCategories,
  computeCompleteness,
  isUnresolvedTriage,
  type BankTxnForPnl,
} from "./pnl";

function txn(overrides: Partial<BankTxnForPnl> & { id: string }): BankTxnForPnl {
  return {
    date: "2026-03-15",
    amount: -50,
    disposition: "unclassified",
    triage: "unmatched",
    categoryName: null,
    ...overrides,
  };
}

describe("filterByDateRange", () => {
  it("keeps items within an inclusive start/end bound", () => {
    const items = [{ date: "2026-01-31" }, { date: "2026-02-01" }, { date: "2026-02-28" }, { date: "2026-03-01" }];
    const result = filterByDateRange(items, "2026-02-01", "2026-02-28");
    expect(result).toEqual([{ date: "2026-02-01" }, { date: "2026-02-28" }]);
  });

  it("produces different results for a monthly window vs a yearly window", () => {
    const items = [{ date: "2026-01-15" }, { date: "2026-06-15" }, { date: "2026-12-15" }];
    const monthly = filterByDateRange(items, "2026-06-01", "2026-06-30");
    const yearly = filterByDateRange(items, "2026-01-01", "2026-12-31");
    expect(monthly).toHaveLength(1);
    expect(yearly).toHaveLength(3);
  });

  it("is unbounded when both dates are null", () => {
    const items = [{ date: "2020-01-01" }, { date: null }];
    expect(filterByDateRange(items, null, null)).toHaveLength(2);
  });

  it("excludes dateless items once any bound is set", () => {
    const items = [{ date: "2026-05-01" }, { date: null }];
    expect(filterByDateRange(items, "2026-01-01", null)).toEqual([{ date: "2026-05-01" }]);
  });
});

describe("selectBankIncomeTransactions", () => {
  it("includes only transactions explicitly classified business_income", () => {
    const transactions = [
      txn({ id: "1", disposition: "business_income", amount: 500 }),
      txn({ id: "2", disposition: "personal", amount: 500 }),
      txn({ id: "3", disposition: "unclassified", amount: 500 }),
    ];
    expect(selectBankIncomeTransactions(transactions).map((t) => t.id)).toEqual(["1"]);
  });

  it("includes business_income regardless of triage state", () => {
    const transactions = [
      txn({ id: "1", disposition: "business_income", triage: "unmatched" }),
      txn({ id: "2", disposition: "business_income", triage: "matched" }),
    ];
    expect(selectBankIncomeTransactions(transactions)).toHaveLength(2);
  });
});

describe("selectBankExpenseTransactions - exclusions and double-count prevention", () => {
  it("excludes personal activity", () => {
    const transactions = [txn({ id: "1", disposition: "personal", triage: "no_receipt_required" })];
    expect(selectBankExpenseTransactions(transactions)).toHaveLength(0);
  });

  it("excludes transfers", () => {
    const transactions = [txn({ id: "1", disposition: "transfer", triage: "no_receipt_required" })];
    expect(selectBankExpenseTransactions(transactions)).toHaveLength(0);
  });

  it("excludes loans", () => {
    const transactions = [txn({ id: "1", disposition: "loan", triage: "no_receipt_required" })];
    expect(selectBankExpenseTransactions(transactions)).toHaveLength(0);
  });

  it("excludes owner contributions and draws", () => {
    const transactions = [
      txn({ id: "1", disposition: "owner_contribution", triage: "no_receipt_required" }),
      txn({ id: "2", disposition: "owner_draw", triage: "no_receipt_required" }),
    ];
    expect(selectBankExpenseTransactions(transactions)).toHaveLength(0);
  });

  it("excludes unclassified activity, including the deterministic suggestion", () => {
    const transactions = [txn({ id: "1", disposition: "unclassified", triage: "no_receipt_required" })];
    expect(selectBankExpenseTransactions(transactions)).toHaveLength(0);
  });

  it("prevents double counting: a matched transaction is excluded even if classified business_expense", () => {
    const transactions = [
      txn({ id: "1", disposition: "business_expense", triage: "matched" }),
      txn({ id: "2", disposition: "business_expense", triage: "no_receipt_required" }),
    ];
    const result = selectBankExpenseTransactions(transactions);
    expect(result.map((t) => t.id)).toEqual(["2"]);
  });

  it("includes a no-receipt business expense only after explicit classification", () => {
    const unclassified = txn({ id: "1", disposition: "unclassified", triage: "no_receipt_required" });
    const classified = txn({ id: "2", disposition: "business_expense", triage: "no_receipt_required" });
    expect(selectBankExpenseTransactions([unclassified])).toHaveLength(0);
    expect(selectBankExpenseTransactions([classified]).map((t) => t.id)).toEqual(["2"]);
  });

  it("excludes a business_expense transaction still in an unresolved triage state", () => {
    const transactions = [
      txn({ id: "1", disposition: "business_expense", triage: "unmatched" }),
      txn({ id: "2", disposition: "business_expense", triage: "needs_review" }),
      txn({ id: "3", disposition: "business_expense", triage: "likely_match" }),
    ];
    expect(selectBankExpenseTransactions(transactions)).toHaveLength(0);
  });
});

describe("sumAmount", () => {
  it("sums absolute values regardless of sign", () => {
    expect(sumAmount([{ amount: -10 }, { amount: 25.5 }])).toBeCloseTo(35.5);
  });
});

describe("mergeExpenseCategories", () => {
  it("combines receipt and bank rows for the same category case-insensitively", () => {
    const merged = mergeExpenseCategories(
      [{ category: "Office Supplies", count: 3, receiptCount: 2, total: 120 }],
      [{ category: "office supplies", count: 1, total: 40 }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ receiptCount: 2, bankCount: 1, count: 4, total: 160 });
  });

  it("keeps categories that only exist on one side", () => {
    const merged = mergeExpenseCategories(
      [{ category: "Travel", count: 1, receiptCount: 1, total: 200 }],
      [{ category: "Utilities", count: 1, total: 80 }],
    );
    expect(merged.map((r) => r.category).sort()).toEqual(["Travel", "Utilities"]);
  });
});

describe("computeCompleteness", () => {
  it("flags unclassified and unresolved-triage counts and reports incomplete", () => {
    const transactions = [
      txn({ id: "1", disposition: "unclassified", triage: "unmatched" }),
      txn({ id: "2", disposition: "business_expense", triage: "needs_review" }),
      txn({ id: "3", disposition: "business_expense", triage: "no_receipt_required" }),
    ];
    const completeness = computeCompleteness(transactions);
    expect(completeness).toEqual({ unclassifiedCount: 1, unresolvedTriageCount: 2, isComplete: false });
  });

  it("reports complete when nothing is unclassified or unresolved", () => {
    const transactions = [
      txn({ id: "1", disposition: "business_expense", triage: "no_receipt_required" }),
      txn({ id: "2", disposition: "personal", triage: "matched" }),
    ];
    expect(computeCompleteness(transactions).isComplete).toBe(true);
  });
});

describe("isUnresolvedTriage", () => {
  it("treats matched and no_receipt_required as resolved", () => {
    expect(isUnresolvedTriage("matched")).toBe(false);
    expect(isUnresolvedTriage("no_receipt_required")).toBe(false);
  });

  it("treats unmatched/needs_review/likely_match/receipt_pending as unresolved", () => {
    for (const state of ["unmatched", "needs_review", "likely_match", "receipt_pending"]) {
      expect(isUnresolvedTriage(state)).toBe(true);
    }
  });
});
