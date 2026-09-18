import { describe, expect, it } from "vitest";
import type { Db } from "../db";
import { TaxRadarAdvisoryService } from "./tax-radar-advisory";

type Route = { match: RegExp; rows: Record<string, unknown>[] };

function fakeDb(routes: Route[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      for (const route of routes) {
        if (route.match.test(sql)) return route.rows as T[];
      }
      return [] as T[];
    },
    async transaction<T>() {
      return [] as T[][];
    },
  };
  return { db, calls };
}

describe("TaxRadarAdvisoryService", () => {
  it("scans bank and receipt payees and flags contractors exceeding $600 without W-9", async () => {
    const { db } = fakeDb([
      // Bank transactions
      {
        match: /FROM bank_transactions/i,
        rows: [
          { payee: "Apex Electrical Services", total: "1250.00" },
          { payee: "Bob's Painting Co", total: "450.00" },
          { payee: "Shell Oil", total: "220.00" }, // Should be excluded as corporate fuel
        ],
      },
      // Receipts
      {
        match: /FROM receipts/i,
        rows: [
          { payee: "Bob's Painting Co", total: "350.00" }, // 450 + 350 = 800 (exceeds 600!)
        ],
      },
      // W-9 records: Apex has W-9, Bob does not
      {
        match: /FROM contractor_w9_records/i,
        rows: [
          { contractor_name: "Apex Electrical Services", has_w9: true, ein_ssn_last4: "8812" },
        ],
      },
    ]);

    const service = new TaxRadarAdvisoryService(db);
    const radar = await service.scan1099Radar("firm_1", "cli_1");

    expect(radar).toHaveLength(2); // Apex and Bob (Shell excluded)

    const apex = radar.find((r) => r.contractorName === "Apex Electrical Services");
    expect(apex).toBeDefined();
    expect(apex?.totalPaid).toBe(1250);
    expect(apex?.needs1099).toBe(true);
    expect(apex?.hasW9).toBe(true);
    expect(apex?.status).toBe("ready_to_file");

    const bob = radar.find((r) => r.contractorName === "Bob's Painting Co");
    expect(bob).toBeDefined();
    expect(bob?.totalPaid).toBe(800);
    expect(bob?.needs1099).toBe(true);
    expect(bob?.hasW9).toBe(false);
    expect(bob?.status).toBe("missing_w9");
  });

  it("calculates S-Corp tax savings accurately for a profitable business", () => {
    const { db } = fakeDb([]);
    const service = new TaxRadarAdvisoryService(db);

    const analysis = service.calculateSCorpSavings(100000);
    expect(analysis.isRecommended).toBe(true);
    expect(analysis.solePropSeTax).toBeGreaterThan(14000);
    expect(analysis.sCorpReasonableSalary).toBe(60000);
    expect(analysis.sCorpDistribution).toBe(40000);
    expect(analysis.netAnnualSavings).toBeGreaterThan(3000);
    expect(analysis.advisorySummary).toContain("IRS Form 2553");
  });

  it("does not recommend S-Corp election when net profit is too low to offset compliance costs", () => {
    const { db } = fakeDb([]);
    const service = new TaxRadarAdvisoryService(db);

    const lowProfit = service.calculateSCorpSavings(25000);
    expect(lowProfit.isRecommended).toBe(false);
  });
});
