import { describe, expect, it } from "vitest";
import type { PnlReport } from "./reporting";
import { buildTaxHandoff, isAssignableLine, suggestScheduleCLine } from "./tax-handoff";

function report(income: Array<[string | null, string, number]>, expenses: Array<[string | null, string, number]>, isComplete = true): PnlReport {
  return {
    currency: "USD",
    accountingBasis: "cash",
    categorizedIncome: income.map(([categoryId, category, total]) => ({ categoryId, category, count: 1, total })),
    categorizedExpenses: expenses.map(([categoryId, category, total]) => ({ categoryId, category, count: 1, receiptCount: 1, bankCount: 0, total })),
    completeness: { unclassifiedCount: 0, unresolvedTriageCount: 0, uncategorizedCount: isComplete ? 0 : 1, currencyConflictCount: 0, isComplete },
  } as unknown as PnlReport;
}

describe("suggestScheduleCLine", () => {
  it.each([
    ["Meals", "SchC_24b"],
    ["Hotel", "SchC_24a"],
    ["Travel", "SchC_24a"],
    ["Gas & Electric", "SchC_25"],
    ["Gas", "SchC_9"],
    ["Equipment rental", "SchC_20a"],
    ["Office rent", "SchC_20b"],
    ["Supplies", "SchC_22"],
    ["Legal fees", "SchC_17"],
    ["Business insurance", "SchC_15"],
    ["Licenses and permits", "SchC_23"],
    ["Software subscriptions", "SchC_18"],
  ])("suggests a line for %s", (name, code) => {
    expect(suggestScheduleCLine(name, "expense")).toBe(code);
  });

  it.each(["Health insurance", "Bank charges", "Credit card fees", "Taxi", "Miscellaneous"])(
    "leaves %s for the preparer instead of guessing",
    (name) => {
      expect(suggestScheduleCLine(name, "expense")).toBeNull();
    },
  );

  it("puts income on line 1 by default", () => {
    expect(suggestScheduleCLine("Consulting revenue", "income")).toBe("SchC_1");
  });
});

describe("isAssignableLine", () => {
  it("keeps income and expense lines on their own side", () => {
    expect(isAssignableLine("SchC_6", "income")).toBe(true);
    expect(isAssignableLine("SchC_6", "expense")).toBe(false);
    expect(isAssignableLine("SchC_4", "expense")).toBe(true);
    expect(isAssignableLine("SchC_31", "expense")).toBe(false);
  });
});

describe("buildTaxHandoff", () => {
  it("totals categories by line and computes gross income, expenses and tentative profit", () => {
    const handoff = buildTaxHandoff({
      taxYear: 2025,
      report: report(
        [["inc1", "Sales", 50000], ["inc2", "Interest earned", 120]],
        [["c1", "Supplies", 1200.5], ["c2", "Office supplies", 300], ["c3", "Meals", 400], ["c4", "Inventory purchases", 10000]],
      ),
      assigned: new Map([["inc2", "SchC_6"]]),
    });
    const amount = (line: string) => handoff.lines.find((l) => l.line === line)?.amount;
    expect(amount("1")).toBe(50000);
    expect(amount("6")).toBe(120);
    expect(amount("22")).toBe(1200.5);
    expect(amount("18")).toBe(300);
    expect(amount("24b")).toBe(400);
    expect(amount("4")).toBe(10000);
    expect(handoff.totals).toEqual({ grossIncome: 40120, totalExpenses: 1900.5, tentativeProfit: 38219.5 });
    expect(handoff.needsLine).toEqual([]);
  });

  it("uses the preparer's line over the suggestion and ignores a line from the wrong side", () => {
    const handoff = buildTaxHandoff({
      taxYear: 2026,
      report: report([], [["c1", "Supplies", 100], ["c2", "Meals", 50]]),
      assigned: new Map([["c1", "SchC_18"], ["c2", "SchC_1"]]),
    });
    expect(handoff.categories.find((c) => c.categoryId === "c1")).toMatchObject({ lineCode: "SchC_18", source: "preparer" });
    expect(handoff.categories.find((c) => c.categoryId === "c2")).toMatchObject({ lineCode: "SchC_24b", source: "suggested" });
  });

  it("lists unrecognized and uncategorized amounts as needing a line instead of dropping them into other expenses", () => {
    const handoff = buildTaxHandoff({
      taxYear: 2026,
      report: report([], [["c1", "Bank charges", 35], [null, "Uncategorized", 80]], false),
      assigned: new Map(),
    });
    expect(handoff.needsLine.map((c) => c.category)).toEqual(["Bank charges", "Uncategorized"]);
    expect(handoff.lines.find((l) => l.line === "27b")?.amount).toBe(0);
    expect(handoff.totals.totalExpenses).toBe(0);
    expect(handoff.booksComplete).toBe(false);
  });
});
