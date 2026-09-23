import { describe, expect, it } from "vitest";
import {
  computeCaliforniaConformity,
  computeNewYorkConformity,
  applyStateConformityToDatabase,
  californiaSection179Limit,
  newYorkMctmt,
} from "./state-tax-rules";
import type { Db } from "../db";

function mockDb() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      return [{ id: "mock-mod-id" }] as T[];
    },
    async transaction<T>() {
      return [] as T[][];
    },
  };
  return { db, calls };
}

describe("California Schedule CA worksheet (verified 2026-09-22)", () => {
  it("adds back bonus depreciation, section 179 over the limit, and HSA items with correct citations", () => {
    const result = computeCaliforniaConformity(2024, {
      federalBonusDepreciation: 50000,
      californiaAllowableDepreciation: 10000,
      federalSection179Deduction: 65000,
      section179PropertyCost: 65000,
      hsaContributionsDeducted: 4150,
      hsaEarningsTaxable: 350,
      isCaliforniaLlc: true,
      californiaGrossReceipts: 600000,
      californiaPteTaxPaid: 9300,
    });

    const bonus = result.modifications.find((m) => m.description.includes("bonus depreciation add-back"));
    expect(bonus?.amount).toBe(50000);
    expect(bonus?.statutoryReference).toBe("Cal. Rev. & Tax Code § 17250(a)(4)");
    expect(result.modifications.find((m) => m.modificationType === "subtraction")?.amount).toBe(10000);

    const sec179 = result.modifications.find((m) => m.description.includes("Section 179"));
    expect(sec179?.amount).toBe(40000);
    expect(sec179?.statutoryReference).toBe("Cal. Rev. & Tax Code § 17255");

    const hsa = result.modifications.filter((m) => m.description.includes("HSA"));
    expect(hsa.map((m) => m.amount)).toEqual([4150, 350]);
    expect(hsa.every((m) => m.statutoryReference === "Cal. Rev. & Tax Code § 17215.4")).toBe(true);

    expect(result.specialTaxesOrFees.map((f) => f.amount)).toEqual([800, 2500]);

    // PTE: credit only, no individual-level add-back (the entity adds it back).
    const pte = result.modifications.filter((m) => m.description.includes("pass-through"));
    expect(pte).toHaveLength(1);
    expect(pte[0]).toMatchObject({ modificationType: "credit", amount: 9300, statutoryReference: "Cal. Rev. & Tax Code § 17052.10" });
  });

  it("applies the section 179 phase-out above $200,000 of property", () => {
    expect(californiaSection179Limit(150000)).toBe(25000);
    expect(californiaSection179Limit(210000)).toBe(15000);
    expect(californiaSection179Limit(300000)).toBe(0);
    const result = computeCaliforniaConformity(2024, { federalSection179Deduction: 30000, section179PropertyCost: 210000 });
    expect(result.modifications[0].amount).toBe(15000);
  });

  it("flags a missing property cost instead of silently assuming no phase-out", () => {
    const result = computeCaliforniaConformity(2024, { federalSection179Deduction: 30000 });
    expect(result.notes.some((n) => n.includes("phase-out was not applied"))).toBe(true);
  });

  it("uses § 17052.11 for 2026-2030 and reduces the credit 12.5% when the June 15 payment was missed", () => {
    const made = computeCaliforniaConformity(2026, { californiaPteTaxPaid: 10000, californiaPteJunePaymentMade: true });
    expect(made.modifications[0]).toMatchObject({ amount: 10000, statutoryReference: "Cal. Rev. & Tax Code § 17052.11" });
    const missed = computeCaliforniaConformity(2026, { californiaPteTaxPaid: 10000, californiaPteJunePaymentMade: false });
    expect(missed.modifications[0].amount).toBe(8750);
  });

  it("computes no PTE credit outside 2021-2030", () => {
    const result = computeCaliforniaConformity(2031, { californiaPteTaxPaid: 10000 });
    expect(result.modifications).toHaveLength(0);
    expect(result.notes[0]).toContain("2021 through 2030");
  });

  it("uses total-income LLC fee tiers from § 17942", () => {
    const fee = (income: number) => computeCaliforniaConformity(2024, { isCaliforniaLlc: true, californiaGrossReceipts: income }).specialTaxesOrFees;
    expect(fee(249999)).toHaveLength(1);
    expect(fee(250000)[1].amount).toBe(900);
    expect(fee(1000000)[1].amount).toBe(6000);
    expect(fee(5000000)[1].amount).toBe(11790);
  });
});

describe("New York IT-225 worksheet (verified against IT-225-I 2025)", () => {
  it("uses A-209/S-213 for 168(k) depreciation, A-201 for business income taxes, and A-219 for PTET", () => {
    const result = computeNewYorkConformity(2024, {
      federalBonusDepreciation: 80000,
      newYorkAllowableDepreciation: 16000,
      stateLocalTaxDeductedFed: 10000,
      nyPtetTaxPaid: 12000,
    });

    expect(result.modifications.find((m) => m.stateLineCode?.includes("A-209"))).toMatchObject({ amount: 80000, statutoryReference: "N.Y. Tax Law § 612(b)(8)" });
    expect(result.modifications.find((m) => m.stateLineCode?.includes("S-213"))).toMatchObject({ amount: 16000, statutoryReference: "N.Y. Tax Law § 612(c)(16)" });
    const a201 = result.modifications.find((m) => m.stateLineCode === "Form IT-225 A-201");
    expect(a201).toMatchObject({ amount: 10000, statutoryReference: "N.Y. Tax Law § 612(b)(3)" });
    expect(a201?.explanation).toContain("IT-196");
    expect(result.modifications.some((m) => m.stateLineCode?.includes("S-201") || m.stateLineCode?.includes("A-101"))).toBe(false);
    expect(result.modifications.find((m) => m.modificationType === "credit")).toMatchObject({ amount: 12000, statutoryReference: "N.Y. Tax Law § 606(kkk)" });
    expect(result.modifications.find((m) => m.stateLineCode?.includes("A-219"))?.amount).toBe(12000);
  });

  it("applies the MCTMT rate and threshold for each tax year", () => {
    expect(newYorkMctmt(2022, 1)).toEqual({ rate: 0.0034, threshold: 50000 });
    expect(newYorkMctmt(2023, 1)).toEqual({ rate: 0.0047, threshold: 50000 });
    expect(newYorkMctmt(2023, 2)).toEqual({ rate: 0.0034, threshold: 50000 });
    expect(newYorkMctmt(2024, 1)).toEqual({ rate: 0.006, threshold: 50000 });
    expect(newYorkMctmt(2026, 1)).toEqual({ rate: 0.006, threshold: 150000 });
    expect(newYorkMctmt(2026, 2)).toEqual({ rate: 0.0034, threshold: 150000 });
  });

  it("owes no 2026 MCTMT on $100,000 of Zone 1 earnings, but does for 2025", () => {
    const tax = (year: number) => computeNewYorkConformity(year, { mctdNetSelfEmploymentEarnings: 100000, mctdZone: 1 }).specialTaxesOrFees;
    expect(tax(2025)[0]).toMatchObject({ amount: 600, statutoryCitation: "N.Y. Tax Law § 801(a)" });
    expect(tax(2026)).toHaveLength(0);
  });

  it("persists calculated conformity adjustments via applyStateConformityToDatabase", async () => {
    const { db, calls } = mockDb();
    const result = computeCaliforniaConformity(2024, { federalBonusDepreciation: 20000, hsaContributionsDeducted: 3000 });
    const res = await applyStateConformityToDatabase(db, "firm_1", "client_1", result);
    expect(res.inserted).toBe(2);
    expect(calls[0].sql).toContain("INSERT INTO state_tax_modifications");
  });
});
