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
