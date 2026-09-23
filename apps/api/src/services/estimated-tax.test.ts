import { describe, expect, it } from "vitest";
import { computeEstimatedTax, installmentDueDates, nextBusinessDay } from "./estimated-tax";

describe("estimated tax (IRC § 6654)", () => {
  it("uses the lesser of 90% current or 100% prior-year tax, in four 25% installments", () => {
    const r = computeEstimatedTax({ taxYear: 2026, priorYearTax: 8000, priorYearAgi: 90000, currentYearTax: 10000 });
    expect(r.requiredAnnualPayment).toBe(8000);
    expect(r.basis).toContain("100% of prior-year tax");
    expect(r.installments.map((i) => i.amount)).toEqual([2000, 2000, 2000, 2000]);
  });

  it("applies 110% when prior-year AGI exceeded $150,000, or $75,000 married filing separately", () => {
    expect(computeEstimatedTax({ taxYear: 2026, priorYearTax: 10000, priorYearAgi: 150001 }).requiredAnnualPayment).toBe(11000);
    expect(computeEstimatedTax({ taxYear: 2026, priorYearTax: 10000, priorYearAgi: 150000 }).requiredAnnualPayment).toBe(10000);
    expect(computeEstimatedTax({ taxYear: 2026, priorYearTax: 10000, priorYearAgi: 80000, marriedFilingSeparately: true }).requiredAnnualPayment).toBe(11000);
  });

  it("spreads withholding evenly across the installments", () => {
    const r = computeEstimatedTax({ taxYear: 2026, priorYearTax: 8000, priorYearAgi: 50000, expectedWithholding: 4000 });
    expect(r.installments.map((i) => i.amount)).toEqual([1000, 1000, 1000, 1000]);
  });

  it("does not use the prior-year safe harbor when the prior year does not qualify", () => {
    const r = computeEstimatedTax({ taxYear: 2026, priorYearTax: 1000, priorYearQualifies: false, currentYearTax: 20000 });
    expect(r.requiredAnnualPayment).toBe(18000);
  });

  it("uses 66 2/3% and one January installment for farmers and fishermen", () => {
    const r = computeEstimatedTax({ taxYear: 2026, currentYearTax: 9000, farmerOrFisherman: true });
    expect(r.requiredAnnualPayment).toBe(6000);
    expect(r.installments).toEqual([{ number: 1, dueDate: "2027-01-15", amount: 6000 }]);
  });

  it("notes the under-$1,000 exception", () => {
    expect(computeEstimatedTax({ taxYear: 2026, currentYearTax: 1500, expectedWithholding: 700 }).notes.join(" ")).toContain("§ 6654(e)(1)");
  });

  it("moves due dates off weekends and legal holidays (§ 7503)", () => {
    // Jan 15, 2028 is a Saturday; Monday Jan 17 is MLK Day, so the date moves to Tuesday Jan 18.
    expect(installmentDueDates(2027)).toEqual(["2027-04-15", "2027-06-15", "2027-09-15", "2028-01-18"]);
    // April 15, 2022 was Emancipation Day observed (April 16 was a Saturday), so the date moved to Monday April 18.
    expect(nextBusinessDay(new Date(Date.UTC(2022, 3, 15)))).toBe("2022-04-18");
    expect(installmentDueDates(2026)).toEqual(["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"]);
  });
});
