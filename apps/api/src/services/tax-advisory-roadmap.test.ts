import { describe, it, expect } from "vitest";
import {
  calculateSCorpOpt,
  calculateAugustaRule,
  calculateRetirementShelter,
  calculateSection179Strategy,
  generateAdvisoryRoadmap,
} from "./tax-advisory-roadmap";

describe("TaxAdvisoryRoadmap Engine", () => {
  describe("Strategy 1: S-Corporation Reasonable Compensation Optimizer", () => {
    it("identifies high net profit sole proprietorship as a prime S-Corp candidate", () => {
      const netProfit = 120000;
      const res = calculateSCorpOpt(netProfit, "consulting", 40, "sole_proprietorship");

      expect(res.isApplicable).toBe(true);
      expect(res.netProfit).toBe(120000);
      expect(res.solePropSeTax).toBeGreaterThan(15000); // 15.3% on ~110k
      expect(res.recommendedSalary).toBe(72000); // 60% consulting benchmark
      expect(res.recommendedDistribution).toBe(48000);
      expect(res.sCorpPayrollTax).toBeLessThan(res.solePropSeTax);
      expect(res.grossFicaSavings).toBeGreaterThan(5000);
      expect(res.estimatedAdminComplianceCost).toBe(1800);
      expect(res.netAnnualSavings).toBeGreaterThan(3500);
      expect(res.ircAuthority).toContain("IRC §§ 1361");
      expect(res.implementationRoadmap.length).toBeGreaterThanOrEqual(3);
    });

    it("handles zero or negative net profit gracefully with isApplicable=false", () => {
      const res = calculateSCorpOpt(0, "retail", 40, "sole_proprietorship");
      expect(res.isApplicable).toBe(false);
      expect(res.netAnnualSavings).toBe(0);
      expect(res.rationale).toContain("break-even or negative");
    });

    it("respects capital-intensive industry benchmark (40% salary ratio)", () => {
      const netProfit = 150000;
      const res = calculateSCorpOpt(netProfit, "construction", 40, "llc");
      expect(res.isApplicable).toBe(true);
      expect(res.recommendedSalary).toBe(60000); // 40% of 150k
      expect(res.recommendedDistribution).toBe(90000);
    });

    it("enforces reasonable living wage floor for full-time executive", () => {
      const netProfit = 70000;
      const res = calculateSCorpOpt(netProfit, "retail", 40, "llc");
      // 40% of 70k is 28k, but living wage floor for full-time should be 45k
      expect(res.recommendedSalary).toBe(45000);
    });
  });

  describe("Strategy 2: Augusta Rule (IRC § 280A(g)) Home Rental Strategy", () => {
    it("correctly computes tax-free rental income and business tax deduction", () => {
      const res = calculateAugustaRule(12, 1250, 0.28);
      expect(res.isApplicable).toBe(true);
      expect(res.daysRented).toBe(12);
      expect(res.dailyRate).toBe(1250);
      expect(res.totalTaxFreeIncome).toBe(15000);
      expect(res.corporateTaxSavings).toBe(4200); // 15000 * 0.28
      expect(res.totalAnnualSavings).toBe(4200);
      expect(res.ircAuthority).toContain("IRC § 280A(g)");
      expect(res.implementationRoadmap).toContain(
        "Execute formal rental agreement between business entity and homeowner prior to meeting dates."
      );
    });

    it("strictly caps rental days at the 14-day statutory ceiling under IRC § 280A(g)", () => {
      const res = calculateAugustaRule(25, 1000, 0.30); // client requests 25 days
      expect(res.daysRented).toBe(14); // MUST cap at 14 days
      expect(res.totalTaxFreeIncome).toBe(14000);
      expect(res.totalAnnualSavings).toBe(4200);
    });
  });

  describe("Strategy 3: Solo 401(k) & Defined Benefit Retirement Shelter", () => {
    it("computes employee deferral + employer profit sharing for profitable business", () => {
      const netProfit = 100000;
      const w2Salary = 60000;
      const res = calculateRetirementShelter(netProfit, w2Salary, 45, 0.28);

      expect(res.isApplicable).toBe(true);
      expect(res.employeeElectiveDeferral).toBe(23000); // 2024 elective deferral
      expect(res.employerProfitSharing).toBe(15000); // 25% of 60k salary
      expect(res.totalSolo401kContribution).toBe(38000);
      expect(res.cashBalanceEligible).toBe(false); // under $150k
      expect(res.totalRetirementDeduction).toBe(38000);
      expect(res.estimatedTaxSavings).toBe(10640); // 38000 * 0.28
    });

    it("activates Cash Balance Defined Benefit Plan for high-income business (>$150k profit)", () => {
      const netProfit = 280000;
      const w2Salary = 100000;
      const res = calculateRetirementShelter(netProfit, w2Salary, 52, 0.35);

      expect(res.isApplicable).toBe(true);
      // age 52 gets catch-up: 23000 + 7500 = 30500
      expect(res.employeeElectiveDeferral).toBe(30500);
      expect(res.employerProfitSharing).toBe(25000); // 25% of 100k
      expect(res.totalSolo401kContribution).toBe(55500);
      expect(res.cashBalanceEligible).toBe(true);
      expect(res.cashBalanceContribution).toBeGreaterThan(50000);
      expect(res.totalRetirementDeduction).toBeGreaterThan(120000);
      expect(res.estimatedTaxSavings).toBeGreaterThan(40000);
      expect(res.rationale).toContain("Cash Balance Defined Benefit Plan");
    });
  });

  describe("Strategy 4: Section 179 & Heavy Vehicle Accelerated Expensing", () => {
    it("calculates immediate first-year write-off and compares to standard MACRS", () => {
      const equipment = 40000;
      const heavyVehicle = 55000;
      const res = calculateSection179Strategy(equipment, heavyVehicle, 0.30);

      expect(res.isApplicable).toBe(true);
      expect(res.qualifyingAssetPurchases).toBe(95000);
      expect(res.totalFirstYearDeduction).toBe(95000);
      expect(res.firstYearTaxSavings).toBe(28500); // 95k * 0.30
      expect(res.standardMacrsComparison).toBe(5700); // 95k * 0.20 * 0.30
      expect(res.immediateCashAdvantage).toBe(22800); // 28500 - 5700
      expect(res.ircAuthority).toContain("IRC § 179");
    });
  });

  describe("Master Advisory Roadmap Generator", () => {
    it("assembles complete multi-strategy advisory roadmap with a scope notice", () => {
      const roadmap = generateAdvisoryRoadmap("client-123", "Apex Logistics LLC", {
        netProfit: 140000,
        industry: "transportation",
        marginalTaxBracket: 0.28,
        ownerAge: 48,
        hoursWorkedPerWeek: 45,
        augustaDays: 14,
        augustaDailyRate: 1500,
        plannedEquipmentPurchases: 25000,
        heavyVehiclePurchases: 60000,
      });

      expect(roadmap.clientId).toBe("client-123");
      expect(roadmap.clientName).toBe("Apex Logistics LLC");
      expect(roadmap.baselineNetProfit).toBe(140000);
      expect(roadmap.totalEstimatedAnnualSavings).toBeGreaterThan(15000);
      expect(roadmap.executiveSummary).toContain("Apex Logistics LLC");
      expect(roadmap.actionChecklist.length).toBe(3);
      expect(roadmap.actionChecklist.map((c) => c.phase)).toEqual([
        "immediate_30_days",
        "mid_year",
        "year_end_filing",
      ]);
      expect(roadmap.circular230AdvisoryNotice).toContain("does not constitute a formal guarantee");
      expect(roadmap.executiveSummary).not.toContain("full compliance");
      expect(roadmap.strategies.scorpOpt.isApplicable).toBe(true);
      expect(roadmap.strategies.augustaRule.isApplicable).toBe(true);
      expect(roadmap.strategies.retirementShelter.isApplicable).toBe(true);
      expect(roadmap.strategies.section179.isApplicable).toBe(true);
    });
  });
});
