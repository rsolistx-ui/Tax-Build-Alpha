import { describe, expect, it } from "vitest";
import { computeDifAuditReport, type DifInputData } from "./dif-audit-scanner";

describe("dif-audit-scanner", () => {
  it("evaluates a clean, well-substantiated business as low audit risk (score <= 30)", () => {
    const cleanData: DifInputData = {
      grossRevenue: 250000,
      totalExpenses: 120000,
      netProfit: 130000,
      expensesByCategory: [
        { categoryName: "Advertising", amount: 15000 },
        { categoryName: "Office Supplies", amount: 12000 },
        { categoryName: "Meals & Dining", amount: 5000 }, // 2.0% of revenue
        { categoryName: "Legal & Professional", amount: 18000 },
        { categoryName: "Contract Labor", amount: 35000 }, // 14% of revenue
        { categoryName: "Auto & Mileage", amount: 10000 }, // 4% of revenue
      ],
      transactions: [
        { id: "tx-1", date: "2026-03-15", amount: -250, description: "Adobe Subscription", categoryName: "Software", disposition: "business_expense", hasReceipt: true },
        { id: "tx-2", date: "2026-04-10", amount: -450, description: "Office Depot Chairs", categoryName: "Office Supplies", disposition: "business_expense", hasReceipt: true },
      ],
    };

    const report = computeDifAuditReport(cleanData);
    expect(report.score).toBeLessThanOrEqual(30);
    expect(report.rating).toBe("low_risk");
    expect(report.findings.length).toBe(0);
    expect(report.comminglingCount).toBe(0);
    expect(report.defenseMemoPreview).toContain("PREPARER REVIEW REQUIRED");
    expect(report.defenseMemoPreview).toContain("LOW RISK");
  });

  it("triggers critical finding when meals & dining exceed 15% of revenue", () => {
    const highMealsData: DifInputData = {
      grossRevenue: 100000,
      totalExpenses: 50000,
      netProfit: 50000,
      expensesByCategory: [
        { categoryName: "Business Meals & Dining", amount: 18000 }, // 18% of revenue!
        { categoryName: "Office Supplies", amount: 12000 },
      ],
      transactions: [],
    };

    const report = computeDifAuditReport(highMealsData);
    expect(report.score).toBeGreaterThanOrEqual(25);
    const mealsFinding = report.findings.find((f) => f.id === "dif-meals-ratio");
    expect(mealsFinding).toBeDefined();
    expect(mealsFinding?.severity).toBe("critical");
    expect(mealsFinding?.codeCitation).toContain("IRC § 274(n)");
    expect(mealsFinding?.clientMetric).toContain("18.0% of Revenue");
  });

  it("detects personal commingled retail and entertainment expenses in operating account", () => {
    const commingledData: DifInputData = {
      grossRevenue: 150000,
      totalExpenses: 80000,
      netProfit: 70000,
      expensesByCategory: [{ categoryName: "General Expense", amount: 80000 }],
      transactions: [
        { id: "tx-1", date: "2026-05-12", amount: -184.50, description: "Lululemon Athletica 984", categoryName: "General Expense", disposition: "business_expense", hasReceipt: true },
        { id: "tx-2", date: "2026-06-01", amount: -245.10, description: "Whole Foods Market #102", categoryName: "General Expense", disposition: "business_expense", hasReceipt: true },
        { id: "tx-3", date: "2026-07-04", amount: -17.99, description: "Netflix Monthly", categoryName: "General Expense", disposition: "business_expense", hasReceipt: true },
      ],
    };

    const report = computeDifAuditReport(commingledData);
    expect(report.comminglingCount).toBe(3);
    const commingledFinding = report.findings.find((f) => f.id === "dif-commingled");
    expect(commingledFinding).toBeDefined();
    expect(commingledFinding?.codeCitation).toContain("IRC § 262(a)");
    expect(commingledFinding?.actionableRemediation).toContain("Owner Draw");
  });

  it("flags unexplained round-number bank transfers", () => {
    const roundTransferData: DifInputData = {
      grossRevenue: 200000,
      totalExpenses: 90000,
      netProfit: 110000,
      expensesByCategory: [],
      transactions: [
        { id: "tx-1", date: "2026-02-01", amount: -1000.00, description: "Transfer to Checking 4491", categoryName: "Uncategorized", disposition: "unclassified", hasReceipt: false },
        { id: "tx-2", date: "2026-03-01", amount: -2500.00, description: "Wire Out Internal", categoryName: null, disposition: "unclassified", hasReceipt: false },
      ],
    };

    const report = computeDifAuditReport(roundTransferData);
    const transferFinding = report.findings.find((f) => f.id === "dif-round-transfers");
    expect(transferFinding).toBeDefined();
    expect(transferFinding?.title).toContain("Round-Dollar Transfers");
  });

  it("flags single invoices > $2,500 under the De Minimis Safe Harbor rule", () => {
    const safeHarborData: DifInputData = {
      grossRevenue: 300000,
      totalExpenses: 150000,
      netProfit: 150000,
      expensesByCategory: [],
      transactions: [
        { id: "tx-1", date: "2026-04-18", amount: -4800.00, description: "Server Rack & Battery Backup", categoryName: "Computer Expense", disposition: "business_expense", hasReceipt: true },
      ],
    };

    const report = computeDifAuditReport(safeHarborData);
    const safeHarborFinding = report.findings.find((f) => f.id === "dif-de-minimis");
    expect(safeHarborFinding).toBeDefined();
    expect(safeHarborFinding?.codeCitation).toContain("Treas. Reg. § 1.263(a)-1(f)");
  });

  it("compiles draft pre-filing review notes that make no preparer representation", () => {
    const testData: DifInputData = {
      grossRevenue: 100000,
      totalExpenses: 80000,
      netProfit: 20000,
      expensesByCategory: [{ categoryName: "Meals & Dining", amount: 12000 }],
      transactions: [],
    };

    const report = computeDifAuditReport(testData);
    expect(report.defenseMemoPreview).toContain("PRE-FILING REVIEW NOTES (DRAFT)");
    expect(report.defenseMemoPreview).not.toMatch(/substantial authority|PRACTITIONER DECLARATION|IRS DIF Risk Score/);
    expect(report.defenseMemoPreview).toContain("IRC § 274(n)");
  });
});
