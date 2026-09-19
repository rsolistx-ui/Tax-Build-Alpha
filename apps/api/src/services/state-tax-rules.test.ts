import { describe, expect, it } from "vitest";
import {
  computeCaliforniaConformity,
  computeNewYorkConformity,
  applyStateConformityToDatabase,
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

describe("California Form 540 / Schedule CA Conformity Engine", () => {
  it("accurately computes CA non-conformity adjustments for bonus depreciation, sec 179, and HSA", () => {
    const result = computeCaliforniaConformity(2024, {
      federalBonusDepreciation: 50000,
      californiaAllowableDepreciation: 10000,
      federalSection179Deduction: 65000, // $40k above $25k limit
      hsaContributionsDeducted: 4150,
      hsaEarningsTaxable: 350,
      isCaliforniaLlc: true,
      californiaGrossReceipts: 600000, // triggers $2,500 gross receipts fee
      californiaPteTaxPaid: 9300,
    });

    expect(result.state).toBe("CA");
    expect(result.taxYear).toBe(2024);

    // 1. Bonus depreciation
    const bonusAdd = result.modifications.find((m) => m.description.includes("bonus depreciation add-back"));
    expect(bonusAdd).toBeDefined();
    expect(bonusAdd?.amount).toBe(50000);
    expect(bonusAdd?.stateLineCode).toContain("Schedule CA (540)");

    // 2. California allowable MACRS subtraction
    const deprSub = result.modifications.find((m) => m.modificationType === "subtraction");
    expect(deprSub?.amount).toBe(10000);

    // 3. Section 179 excess over $25,000 cap (65000 - 25000 = 40000)
    const sec179Mod = result.modifications.find((m) => m.description.includes("Section 179"));
    expect(sec179Mod?.amount).toBe(40000);
    expect(sec179Mod?.statutoryReference).toBe("Cal. Rev. & Tax Code § 17255");

    // 4. HSA add-back
    const hsaMod = result.modifications.find((m) => m.description.includes("HSA contribution"));
    expect(hsaMod?.amount).toBe(4150);

    // 5. CA LLC $800 minimum tax and fee
    expect(result.specialTaxesOrFees).toHaveLength(2);
    expect(result.specialTaxesOrFees[0].amount).toBe(800);
    expect(result.specialTaxesOrFees[1].amount).toBe(2500); // $500k - $1M bracket

    // 6. PTE Elective Tax credit
    const pteCredit = result.modifications.find((m) => m.modificationType === "credit");
    expect(pteCredit?.amount).toBe(9300);
    expect(result.totalCredits).toBe(9300);
  });
});

describe("New York Form IT-201 / IT-225 Conformity Engine", () => {
  it("accurately computes NY modifications (A-201, S-201, A-101) and MCTMT mobility tax", () => {
    const result = computeNewYorkConformity(2024, {
      federalBonusDepreciation: 80000,
      newYorkAllowableDepreciation: 16000,
      stateLocalTaxDeductedFed: 10000,
      mctdNetSelfEmploymentEarnings: 150000, // over $50k threshold
      mctdZone: 1, // NYC 0.60%
      nyPtetTaxPaid: 12000,
    });

    expect(result.state).toBe("NY");

    // 1. Code A-201 bonus depreciation add-back
    const a201 = result.modifications.find((m) => m.stateLineCode?.includes("A-201"));
    expect(a201).toBeDefined();
    expect(a201?.amount).toBe(80000);
    expect(a201?.statutoryReference).toBe("N.Y. Tax Law § 612(b)(8)");

    // 2. Code S-201 NY allowable depreciation subtraction
    const s201 = result.modifications.find((m) => m.stateLineCode?.includes("S-201"));
    expect(s201?.amount).toBe(16000);

    // 3. Code A-101 SALT add-back
    const a101 = result.modifications.find((m) => m.stateLineCode?.includes("A-101"));
    expect(a101?.amount).toBe(10000);

    // 4. MCTMT mobility tax (150,000 * 0.006 = 900)
    expect(result.specialTaxesOrFees).toHaveLength(1);
    expect(result.specialTaxesOrFees[0].amount).toBe(900);
    expect(result.specialTaxesOrFees[0].statutoryCitation).toContain("Article 23 § 801");

    // 5. PTET credit
    const ptet = result.modifications.find((m) => m.modificationType === "credit");
    expect(ptet?.amount).toBe(12000);
  });

  it("persists calculated conformity adjustments into database via applyStateConformityToDatabase", async () => {
    const { db, calls } = mockDb();
    const result = computeCaliforniaConformity(2024, {
      federalBonusDepreciation: 20000,
      hsaContributionsDeducted: 3000,
    });

    const res = await applyStateConformityToDatabase(db, "firm_1", "client_1", result);
    expect(res.inserted).toBe(2);
    expect(calls.length).toBe(2);
    expect(calls[0].sql).toContain("INSERT INTO state_tax_modifications");
  });
});
