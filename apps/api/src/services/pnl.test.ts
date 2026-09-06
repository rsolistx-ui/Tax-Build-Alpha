import { describe, expect, it } from "vitest";
import {
  filterByDateRange,
  selectBankExpenseTransactions,
  selectBankIncomeTransactions,
  sumBankExpenseAmount,
  sumBankIncomeAmount,
  isReceiptDispositionConflict,
  mergeExpenseCategories,
  computeCompleteness,
  isUnresolvedTriage,
  isAccrualBasisSupported,
  isValidCalendarDate,
  isCurrencyMismatch,
  normalizeCurrencyCode,
  isReceiptCurrencyConflict,
  type BankTxnForPnl,
} from "./pnl";

function txn(overrides: Partial<BankTxnForPnl> & { id: string }): BankTxnForPnl {
  return {
    date: "2026-03-15",
    amount: -50,
    disposition: "unclassified",
    triage: "unmatched",
    categoryId: null,
    categoryName: null,
    currency: "USD",
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

describe("sumBankExpenseAmount - signed accounting", () => {
  it("a normal debit expense of -100 nets to expense of 100", () => {
    expect(sumBankExpenseAmount([{ amount: -100 }])).toBeCloseTo(100);
  });

  it("a vendor refund/contra credit reduces the net expense: -100 debit + 20 refund = 80", () => {
    expect(sumBankExpenseAmount([{ amount: -100 }, { amount: 20 }])).toBeCloseTo(80);
  });

  it("multiple mixed-sign transactions net correctly", () => {
    expect(sumBankExpenseAmount([{ amount: -40 }, { amount: -60 }, { amount: 15 }, { amount: -5 }])).toBeCloseTo(90);
  });

  it("a fully offset debit and refund nets to zero", () => {
    expect(sumBankExpenseAmount([{ amount: -100 }, { amount: 100 }])).toBeCloseTo(0);
  });
});

describe("sumBankIncomeAmount - signed accounting", () => {
  it("a normal income credit of +1000 nets to income of 1000", () => {
    expect(sumBankIncomeAmount([{ amount: 1000 }])).toBeCloseTo(1000);
  });

  it("an income reversal debit reduces net income: +1000 - 100 reversal = 900", () => {
    expect(sumBankIncomeAmount([{ amount: 1000 }, { amount: -100 }])).toBeCloseTo(900);
  });

  it("a fully reversed income transaction nets to zero", () => {
    expect(sumBankIncomeAmount([{ amount: 1000 }, { amount: -1000 }])).toBeCloseTo(0);
  });
});

describe("isReceiptDispositionConflict", () => {
  it("is false when there is no matched bank transaction", () => {
    expect(isReceiptDispositionConflict(null)).toBe(false);
  });

  it("is false when the matched bank transaction is also business_expense", () => {
    expect(isReceiptDispositionConflict("business_expense")).toBe(false);
  });

  it("is true when the matched bank transaction is personal", () => {
    expect(isReceiptDispositionConflict("personal")).toBe(true);
  });

  it("is true when the matched bank transaction is a transfer", () => {
    expect(isReceiptDispositionConflict("transfer")).toBe(true);
  });

  it("is true for owner_contribution, owner_draw, loan, other_excluded, and business_income", () => {
    for (const disposition of ["owner_contribution", "owner_draw", "loan", "other_excluded", "business_income"] as const) {
      expect(isReceiptDispositionConflict(disposition)).toBe(true);
    }
  });
});

describe("mergeExpenseCategories - canonical category identity", () => {
  it("merges Supplies/supplies into one category when they share a category id", () => {
    const merged = mergeExpenseCategories(
      [{ categoryId: "cat_1", category: "Supplies", count: 3, receiptCount: 2, total: 120 }],
      [{ categoryId: "cat_1", category: "supplies", count: 1, total: 40 }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ categoryId: "cat_1", receiptCount: 2, bankCount: 1, count: 4, total: 160 });
  });

  it("merges Office Supplies/office-supplies display-name mismatches sharing a category id", () => {
    const merged = mergeExpenseCategories(
      [{ categoryId: "cat_2", category: "Office Supplies", count: 1, receiptCount: 1, total: 50 }],
      [{ categoryId: "cat_2", category: "office-supplies", count: 2, total: 30 }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ count: 3, total: 80 });
  });

  it("keeps a custom category distinct from other categories", () => {
    const merged = mergeExpenseCategories(
      [{ categoryId: "cat_custom", category: "Client Gifts & Swag", count: 1, receiptCount: 1, total: 200 }],
      [{ categoryId: "cat_other", category: "Utilities", count: 1, total: 80 }],
    );
    expect(merged.map((r) => r.category).sort()).toEqual(["Client Gifts & Swag", "Utilities"]);
  });

  it("merges a receipt row and a bank row for the same category into one row, not two", () => {
    const merged = mergeExpenseCategories(
      [{ categoryId: "cat_3", category: "Travel", count: 2, receiptCount: 2, total: 300 }],
      [{ categoryId: "cat_3", category: "Travel", count: 1, total: 75 }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ count: 3, receiptCount: 2, bankCount: 1, total: 375 });
  });

  it("groups uncategorized receipt and bank rows into a single uncategorized bucket", () => {
    const merged = mergeExpenseCategories(
      [{ categoryId: null, category: "Uncategorized", count: 1, receiptCount: 1, total: 20 }],
      [{ categoryId: null, category: "Uncategorized", count: 1, total: 15 }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ categoryId: null, count: 2, total: 35 });
  });
});

describe("computeCompleteness", () => {
  it("flags unclassified and unresolved-triage counts and reports incomplete", () => {
    const transactions = [
      txn({ id: "1", disposition: "unclassified", triage: "unmatched" }),
      txn({ id: "2", disposition: "business_expense", triage: "needs_review", categoryId: "cat_1" }),
      txn({ id: "3", disposition: "business_expense", triage: "no_receipt_required", categoryId: "cat_1" }),
    ];
    const completeness = computeCompleteness({
      transactions,
      clientCurrency: "USD",
      uncategorizedReceiptLineCount: 0,
      receiptCurrencyConflictCount: 0,
    });
    expect(completeness).toEqual({
      unclassifiedCount: 1,
      unresolvedTriageCount: 2,
      uncategorizedCount: 0,
      currencyConflictCount: 0,
      isComplete: false,
    });
  });

  it("counts uncategorized business-expense and business-income bank transactions", () => {
    const transactions = [
      txn({ id: "1", disposition: "business_expense", triage: "no_receipt_required", categoryId: null }),
      txn({ id: "2", disposition: "business_income", triage: "matched", categoryId: null }),
      txn({ id: "3", disposition: "personal", triage: "matched", categoryId: null }),
    ];
    const completeness = computeCompleteness({
      transactions,
      clientCurrency: "USD",
      uncategorizedReceiptLineCount: 0,
      receiptCurrencyConflictCount: 0,
    });
    expect(completeness.uncategorizedCount).toBe(2);
    expect(completeness.isComplete).toBe(false);
  });

  it("does not require a category on excluded/personal transactions", () => {
    const transactions = [txn({ id: "1", disposition: "personal", triage: "matched", categoryId: null })];
    const completeness = computeCompleteness({
      transactions,
      clientCurrency: "USD",
      uncategorizedReceiptLineCount: 0,
      receiptCurrencyConflictCount: 0,
    });
    expect(completeness.uncategorizedCount).toBe(0);
    expect(completeness.isComplete).toBe(true);
  });

  it("includes uncategorized filed-receipt expense lines in the count and blocks completeness", () => {
    const completeness = computeCompleteness({
      transactions: [],
      clientCurrency: "USD",
      uncategorizedReceiptLineCount: 3,
      receiptCurrencyConflictCount: 0,
    });
    expect(completeness.uncategorizedCount).toBe(3);
    expect(completeness.isComplete).toBe(false);
  });

  it("blocks completeness when there is a currency conflict", () => {
    const completeness = computeCompleteness({
      transactions: [],
      clientCurrency: "USD",
      uncategorizedReceiptLineCount: 0,
      receiptCurrencyConflictCount: 1,
    });
    expect(completeness.isComplete).toBe(false);
  });

  it("reports complete when nothing is unclassified, unresolved, uncategorized, or in currency conflict", () => {
    const transactions = [
      txn({ id: "1", disposition: "business_expense", triage: "no_receipt_required", categoryId: "cat_1" }),
      txn({ id: "2", disposition: "personal", triage: "matched" }),
    ];
    const completeness = computeCompleteness({
      transactions,
      clientCurrency: "USD",
      uncategorizedReceiptLineCount: 0,
      receiptCurrencyConflictCount: 0,
    });
    expect(completeness.isComplete).toBe(true);
  });

  it("does not let a foreign-currency unclassified transaction disappear from completeness", () => {
    const transactions = [txn({ id: "1", disposition: "unclassified", triage: "unmatched", currency: "EUR" })];
    const completeness = computeCompleteness({
      transactions,
      clientCurrency: "USD",
      uncategorizedReceiptLineCount: 0,
      receiptCurrencyConflictCount: 0,
    });
    expect(completeness.unclassifiedCount).toBe(1);
    expect(completeness.isComplete).toBe(false);
  });

  it("does not let a foreign-currency unresolved-triage transaction disappear from completeness", () => {
    const transactions = [
      txn({ id: "1", disposition: "business_expense", triage: "needs_review", categoryId: "cat_1", currency: "EUR" }),
    ];
    const completeness = computeCompleteness({
      transactions,
      clientCurrency: "USD",
      uncategorizedReceiptLineCount: 0,
      receiptCurrencyConflictCount: 0,
    });
    expect(completeness.unresolvedTriageCount).toBe(1);
    expect(completeness.isComplete).toBe(false);
  });

  it("counts explicitly classified foreign-currency business activity as a currency conflict", () => {
    const transactions = [
      txn({ id: "1", disposition: "business_expense", triage: "no_receipt_required", categoryId: "cat_1", currency: "EUR" }),
      txn({ id: "2", disposition: "business_income", triage: "matched", categoryId: "cat_1", currency: "eur" }),
    ];
    const completeness = computeCompleteness({
      transactions,
      clientCurrency: "USD",
      uncategorizedReceiptLineCount: 0,
      receiptCurrencyConflictCount: 0,
    });
    expect(completeness.currencyConflictCount).toBe(2);
    expect(completeness.isComplete).toBe(false);
  });

  it("does not flag foreign-currency personal/excluded activity as a currency conflict", () => {
    const transactions = [
      txn({ id: "1", disposition: "personal", triage: "matched", currency: "EUR" }),
      txn({ id: "2", disposition: "transfer", triage: "matched", currency: "GBP" }),
    ];
    const completeness = computeCompleteness({
      transactions,
      clientCurrency: "USD",
      uncategorizedReceiptLineCount: 0,
      receiptCurrencyConflictCount: 0,
    });
    expect(completeness.currencyConflictCount).toBe(0);
    expect(completeness.isComplete).toBe(true);
  });

  it("does not double-flag a foreign-currency business transaction as also uncategorized", () => {
    const transactions = [
      txn({ id: "1", disposition: "business_expense", triage: "no_receipt_required", categoryId: null, currency: "EUR" }),
    ];
    const completeness = computeCompleteness({
      transactions,
      clientCurrency: "USD",
      uncategorizedReceiptLineCount: 0,
      receiptCurrencyConflictCount: 0,
    });
    expect(completeness.currencyConflictCount).toBe(1);
    expect(completeness.uncategorizedCount).toBe(0);
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

describe("isAccrualBasisSupported", () => {
  it("supports cash basis", () => {
    expect(isAccrualBasisSupported("cash")).toBe(true);
  });

  it("supports an unset basis (defaults to cash-derived reporting)", () => {
    expect(isAccrualBasisSupported(null)).toBe(true);
  });

  it("does not support accrual basis", () => {
    expect(isAccrualBasisSupported("accrual")).toBe(false);
  });
});

describe("isValidCalendarDate", () => {
  it("accepts a real calendar date", () => {
    expect(isValidCalendarDate("2026-03-15")).toBe(true);
  });

  it("rejects a non-date string", () => {
    expect(isValidCalendarDate("foo")).toBe(false);
  });

  it("rejects an out-of-range month", () => {
    expect(isValidCalendarDate("2026-13-01")).toBe(false);
  });

  it("rejects a day that does not exist in the given month", () => {
    expect(isValidCalendarDate("2026-02-30")).toBe(false);
  });

  it("accepts a leap-day date only in a leap year", () => {
    expect(isValidCalendarDate("2024-02-29")).toBe(true);
    expect(isValidCalendarDate("2026-02-29")).toBe(false);
  });
});

describe("isCurrencyMismatch", () => {
  it("is false when currencies match, case-insensitively", () => {
    expect(isCurrencyMismatch("usd", "USD")).toBe(false);
  });

  it("is true when currencies differ", () => {
    expect(isCurrencyMismatch("EUR", "USD")).toBe(true);
  });
});

describe("isReceiptCurrencyConflict", () => {
  it("is a conflict when currencies differ and the receipt is still eligible as a business expense", () => {
    expect(
      isReceiptCurrencyConflict({ receiptCurrency: "EUR", clientCurrency: "USD", matchedBankDisposition: null }),
    ).toBe(true);
  });

  it("is a conflict when currencies differ and the matched bank transaction is unclassified", () => {
    expect(
      isReceiptCurrencyConflict({ receiptCurrency: "EUR", clientCurrency: "USD", matchedBankDisposition: "unclassified" }),
    ).toBe(true);
  });

  it("is a conflict when currencies differ and the matched bank transaction is business_expense", () => {
    expect(
      isReceiptCurrencyConflict({ receiptCurrency: "EUR", clientCurrency: "USD", matchedBankDisposition: "business_expense" }),
    ).toBe(true);
  });

  it("is not a conflict when currencies match", () => {
    expect(
      isReceiptCurrencyConflict({ receiptCurrency: "USD", clientCurrency: "usd", matchedBankDisposition: null }),
    ).toBe(false);
  });

  it("is not a conflict when the matched bank transaction is already excluded as nonbusiness (personal)", () => {
    expect(
      isReceiptCurrencyConflict({ receiptCurrency: "EUR", clientCurrency: "USD", matchedBankDisposition: "personal" }),
    ).toBe(false);
  });

  it("is not a conflict for any nonbusiness disposition (transfer, owner, loan, other-excluded, business income)", () => {
    for (const disposition of ["transfer", "owner_contribution", "owner_draw", "loan", "other_excluded", "business_income"] as const) {
      expect(
        isReceiptCurrencyConflict({ receiptCurrency: "EUR", clientCurrency: "USD", matchedBankDisposition: disposition }),
      ).toBe(false);
    }
  });
});

describe("normalizeCurrencyCode", () => {
  it("normalizes lowercase currency codes to uppercase", () => {
    expect(normalizeCurrencyCode("usd")).toBe("USD");
  });

  it("normalizes mixed-case currency codes to uppercase", () => {
    expect(normalizeCurrencyCode("Usd")).toBe("USD");
  });

  it("rejects a value with a digit", () => {
    expect(normalizeCurrencyCode("US1")).toBeNull();
  });

  it("rejects a value that is too short", () => {
    expect(normalizeCurrencyCode("US")).toBeNull();
  });

  it("rejects a value that is too long", () => {
    expect(normalizeCurrencyCode("USDD")).toBeNull();
  });
});
