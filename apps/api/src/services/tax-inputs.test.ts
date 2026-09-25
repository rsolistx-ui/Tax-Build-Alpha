import { describe, expect, it } from "vitest";
import { summarizeTaxInputs, TAX_INPUT_SCHEMAS, type TaxInputRow } from "./tax-inputs";

const row = (kind: TaxInputRow["kind"], data: unknown, id = `${kind}-${Math.random()}`): TaxInputRow => ({ id, kind, data, updatedAt: "2026-09-25" });
const base = { trips: [], bookedBusinessIncome: 0, tentativeProfit: 0, depositsByPayer: new Map() };

describe("summarizeTaxInputs", () => {
  it("takes business miles from the mileage log by vehicle name, and gives unnamed trips to the only vehicle", () => {
    const s = summarizeTaxInputs({
      ...base,
      rows: [row("vehicle", { description: "2022 F-150", totalMiles: 20000, commutingMiles: 1000 })],
      trips: [{ vehicle: "2022 f-150", miles: 3000 }, { vehicle: null, miles: 1000 }, { vehicle: "Rental", miles: 50 }],
    });
    expect(s.vehicles[0]).toMatchObject({ businessMiles: 4000, otherPersonalMiles: 15000, businessUsePercent: 20, writtenEvidence: true, problems: [] });
    expect(s.unassignedTripMiles).toBe(50);
  });

  it("flags a vehicle whose business and commuting miles exceed the total, and one with no log", () => {
    const s = summarizeTaxInputs({
      ...base,
      rows: [row("vehicle", { description: "Van", totalMiles: 100 }), row("vehicle", { description: "Car", totalMiles: 500 })],
      trips: [{ vehicle: "Van", miles: 150 }],
    });
    expect(s.vehicles[0].problems[0]).toContain("more than the total");
    expect(s.vehicles[1].problems[0]).toContain("No mileage log");
    expect(s.vehicles[1].writtenEvidence).toBe(false);
  });

  it("works out the home office business share (regular) and the limited simplified amount", () => {
    const regular = summarizeTaxInputs({
      ...base,
      tentativeProfit: 50000,
      rows: [row("home_office", { method: "regular", officeSqFt: 200, homeSqFt: 2000, regularAndExclusiveUse: true, principalPlaceOrClientMeetings: true, expenses: { utilities: 3000, insurance: 1200 } })],
    });
    expect(regular.homeOffice).toMatchObject({ businessUsePercent: 10, businessShareTotal: 420, simplifiedDeduction: null, qualifies: true });
    const simplified = summarizeTaxInputs({
      ...base,
      tentativeProfit: 400,
      rows: [row("home_office", { method: "simplified", officeSqFt: 250, regularAndExclusiveUse: true, principalPlaceOrClientMeetings: true })],
    });
    expect(simplified.homeOffice?.simplifiedDeduction).toBe(400); // 250 x $5 = 1250, limited to the 400 profit
  });

  it("ties business 1099s to booked income and flags a shortfall", () => {
    const s = summarizeTaxInputs({
      ...base,
      bookedBusinessIncome: 9000,
      depositsByPayer: new Map([["acme co", { total: 6000, count: 3 }]]),
      rows: [
        row("form_1099", { form: "1099-NEC", payerName: "Acme Co", amount: 6000 }),
        row("form_1099", { form: "1099-K", payerName: "Stripe", amount: 5000 }),
        row("form_1099", { form: "1099-INT", payerName: "Bank", amount: 40 }),
      ],
    });
    expect(s.tieOut).toMatchObject({ reportedOnBusiness1099s: 11000, bookedBusinessIncome: 9000, reportedMoreThanBooked: 2000 });
    expect(s.tieOut.notes.join(" ")).toContain("1099-K");
    expect(s.forms1099[0].possibleDeposits).toEqual({ total: 6000, count: 3 });
    expect(s.forms1099[2].possibleDeposits).toBeNull(); // interest is not business income
  });

  it("does not match deposits for payer names too short to be meaningful", () => {
    const s = summarizeTaxInputs({
      ...base,
      depositsByPayer: new Map([["co", { total: 999, count: 9 }]]),
      rows: [row("form_1099", { form: "1099-NEC", payerName: "Co", amount: 100 })],
    });
    expect(s.forms1099[0].possibleDeposits).toBeNull();
  });

  it("totals estimated payments by quarter, federal and per state, and computes asset business basis", () => {
    const s = summarizeTaxInputs({
      ...base,
      rows: [
        row("estimated_payment", { jurisdiction: "federal", paidDate: "2026-04-15", quarter: 1, amount: 1000 }),
        row("estimated_payment", { jurisdiction: "federal", paidDate: "2027-01-15", quarter: 4, amount: 1200 }),
        row("estimated_payment", { jurisdiction: "state", state: "TX", paidDate: "2026-06-15", quarter: 2, amount: 300 }),
        row("asset", { description: "Laptop", category: "computer_equipment", placedInService: "2026-03-01", cost: 2400, businessUsePercent: 75 }),
      ],
    });
    expect(s.estimatedPayments.federal).toEqual({ byQuarter: [1000, 0, 0, 1200], total: 2200 });
    expect(s.estimatedPayments.states).toEqual([{ state: "TX", byQuarter: [0, 300, 0, 0], total: 300 }]);
    expect(s.assets[0].businessBasis).toBe(1800);
  });

  it("skips saved rows that no longer validate instead of guessing", () => {
    const s = summarizeTaxInputs({ ...base, rows: [row("asset", { description: "Broken" })] });
    expect(s.assets).toEqual([]);
    expect(s.unreadable).toBe(1);
  });
});

describe("TAX_INPUT_SCHEMAS", () => {
  it("requires a state for a state estimated payment", () => {
    expect(TAX_INPUT_SCHEMAS.estimated_payment.safeParse({ jurisdiction: "state", paidDate: "2026-04-15", quarter: 1, amount: 10 }).success).toBe(false);
  });
  it("rejects a business-use percentage over 100", () => {
    expect(TAX_INPUT_SCHEMAS.asset.safeParse({ description: "X", category: "other", placedInService: "2026-01-01", cost: 1, businessUsePercent: 120 }).success).toBe(false);
  });
});
