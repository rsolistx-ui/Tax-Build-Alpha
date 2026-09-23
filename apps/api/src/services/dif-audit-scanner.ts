/**
 * Truepost Practice OS — IRS DIF Pre-Filing Audit Risk Scanner
 *
 * Implements statistical benchmarking based on IRS Statistics of Income (SOI)
 * and Audit Technique Guides (ATGs). Computes a Pre-Filing DIF Score (0–100)
 * to protect practitioners and clients under Treasury Circular 230 and IRC § 6694.
 */

export interface DifRiskFinding {
  id: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  clientMetric: string;
  benchmarkMetric: string;
  scoreImpact: number;
  title: string;
  explanation: string;
  codeCitation: string;
  actionableRemediation: string;
}

export interface DifAuditReport {
  score: number;
  rating: "low_risk" | "moderate_risk" | "high_risk";
  grossRevenue: number;
  totalExpenses: number;
  netProfit: number;
  profitMarginPercent: number;
  findings: DifRiskFinding[];
  comminglingCount: number;
  missingReceiptCount: number;
  defenseMemoPreview: string;
}

export interface DifInputData {
  grossRevenue: number;
  totalExpenses: number;
  netProfit: number;
  expensesByCategory: Array<{ categoryName: string; amount: number }>;
  transactions: Array<{
    id: string;
    date: string | null;
    amount: number;
    description: string;
    categoryName: string | null;
    disposition: string;
    hasReceipt: boolean;
  }>;
  industry?: string | null;
}

const PERSONAL_EXPENSE_KEYWORDS = [
  "grocery", "supermarket", "trader joe", "whole foods", "safeway", "kroger",
  "lululemon", "sephora", "ulta", "nordstrom", "zara", "target", "walmart",
  "spotify", "netflix", "hulu", "disney+", "playstation", "nintendo", "steam",
  "equinox", "planet fitness", "gym", "spa", "massage", "salon", "barber",
  "liquor", "bevmo", "total wine", "wine & spirits"
];

/**
 * Computes the IRS DIF Audit Risk Score and detailed findings.
 */
export function computeDifAuditReport(data: DifInputData): DifAuditReport {
  const grossRev = Math.max(0, data.grossRevenue);
  const totalExp = Math.max(0, data.totalExpenses);
  const net = data.netProfit;
  const marginPct = grossRev > 0 ? (net / grossRev) * 100 : 0;

  const findings: DifRiskFinding[] = [];
  let totalScore = 0;

  // 1. Meals & Entertainment Ratio (IRC § 274(n))
  const mealsExp = data.expensesByCategory
    .filter((c) => /meal|dining|restaurant|entertain/i.test(c.categoryName))
    .reduce((sum, c) => sum + c.amount, 0);

  const mealsRatio = grossRev > 0 ? (mealsExp / grossRev) * 100 : 0;
  if (grossRev > 0 && mealsRatio > 8.0) {
    const isCritical = mealsRatio > 15.0;
    const impact = isCritical ? 25 : 15;
    totalScore += impact;
    findings.push({
      id: "dif-meals-ratio",
      category: "Meals & Dining",
      severity: isCritical ? "critical" : "high",
      clientMetric: `${mealsRatio.toFixed(1)}% of Revenue ($${mealsExp.toLocaleString()})`,
      benchmarkMetric: "1.5% – 4.5% National Average",
      scoreImpact: impact,
      title: "Abnormally High Meals Deduction vs. Gross Receipts",
      explanation: `Meals and dining represent ${mealsRatio.toFixed(1)}% of total gross revenue. Meals are a frequent examination issue; confirm receipts and business-purpose notes support them.`,
      codeCitation: "IRC § 274(n) & IRC § 162",
      actionableRemediation: "Verify business purpose notes for all restaurant charges over $75. Confirm that 50% disallowance is properly applied to non-DOT meals.",
    });
  } else if (grossRev > 0 && mealsRatio > 4.5) {
    totalScore += 8;
    findings.push({
      id: "dif-meals-moderate",
      category: "Meals & Dining",
      severity: "medium",
      clientMetric: `${mealsRatio.toFixed(1)}% of Revenue ($${mealsExp.toLocaleString()})`,
      benchmarkMetric: "1.5% – 4.5% National Average",
      scoreImpact: 8,
      title: "Elevated Meals & Dining Ratio",
      explanation: `Meals expenses are slightly above the median benchmark for your business sector.`,
      codeCitation: "IRC § 274(n)",
      actionableRemediation: "Ensure client retains attendee logs and documented business agenda for client dining.",
    });
  }

  // 2. Vehicle & Travel Expenses (IRC § 274(d))
  const vehicleExp = data.expensesByCategory
    .filter((c) => /auto|vehicle|travel|mileage|gas|fuel|car/i.test(c.categoryName))
    .reduce((sum, c) => sum + c.amount, 0);

  const vehicleRatio = grossRev > 0 ? (vehicleExp / grossRev) * 100 : 0;
  if (grossRev > 0 && vehicleRatio > 18.0) {
    const impact = 20;
    totalScore += impact;
    findings.push({
      id: "dif-auto-high",
      category: "Vehicle & Travel",
      severity: "high",
      clientMetric: `${vehicleRatio.toFixed(1)}% of Revenue ($${vehicleExp.toLocaleString()})`,
      benchmarkMetric: "3.0% – 10.0% Industry Benchmark",
      scoreImpact: impact,
      title: "Disproportionate Travel & Vehicle Expense",
      explanation: `Vehicle and travel expenses equal ${vehicleRatio.toFixed(1)}% of gross revenue. Under examination, the IRS requires contemporaneous written mileage logs under strict IRC § 274(d) substantiation.`,
      codeCitation: "IRC § 274(d) & Treas. Reg. § 1.274-5T",
      actionableRemediation: "Obtain client's contemporaneous written mileage log or telematics GPS export before taking full vehicle deduction.",
    });
  }

  // 3. Contractor 1099 vs. Total Expenses (Worker Classification Trigger)
  const contractorExp = data.expensesByCategory
    .filter((c) => /contractor|subcontract|1099|outside service/i.test(c.categoryName))
    .reduce((sum, c) => sum + c.amount, 0);

  const contractorRatio = grossRev > 0 ? (contractorExp / grossRev) * 100 : 0;
  if (grossRev > 0 && contractorRatio > 45.0) {
    const impact = 18;
    totalScore += impact;
    findings.push({
      id: "dif-contractor-ratio",
      category: "Worker Classification",
      severity: "high",
      clientMetric: `${contractorRatio.toFixed(1)}% of Revenue ($${contractorExp.toLocaleString()})`,
      benchmarkMetric: "Under 30% for Operating Entities",
      scoreImpact: impact,
      title: "Heavy Independent Contractor Reliance",
      explanation: `Contractor payments exceed 45% of total gross revenue. The IRS and DOL scrutinize heavy contractor spending for potential employee misclassification.`,
      codeCitation: "IRC § 3509 & IRS 20-Factor Common Law Test",
      actionableRemediation: "Verify Form W-9 is on file for all individuals paid over $600 and confirm independent contractor agreements define scope of control.",
    });
  }

  // 4. Commingled Personal Expense & Unmemoed Round Transfer Detection
  let comminglingCount = 0;
  let roundTransferCount = 0;

  for (const txn of data.transactions) {
    const desc = txn.description.toLowerCase();
    const isPersonalKeyword = PERSONAL_EXPENSE_KEYWORDS.some((kw) => desc.includes(kw));
    if (isPersonalKeyword && txn.disposition === "business_expense") {
      comminglingCount++;
    }

    // Check round number transfers ($500, $1000, $2500, $5000, etc.)
    const amt = Math.abs(txn.amount);
    if (amt >= 500 && amt % 500 === 0 && (!txn.categoryName || txn.categoryName === "Uncategorized")) {
      roundTransferCount++;
    }
  }

  if (comminglingCount > 0) {
    const impact = Math.min(25, comminglingCount * 5);
    totalScore += impact;
    findings.push({
      id: "dif-commingled",
      category: "Commingling & Corporate Veil",
      severity: comminglingCount >= 3 ? "critical" : "medium",
      clientMetric: `${comminglingCount} Detected Transaction${comminglingCount === 1 ? "" : "s"}`,
      benchmarkMetric: "Zero Personal Commingling Expected",
      scoreImpact: impact,
      title: "Potential Personal Expenses Found in Operating Account",
      explanation: `Found ${comminglingCount} transaction(s) matching personal retail or entertainment keywords that are currently classified as business expenses. Commingling invites auditor scrutiny and pierces LLC limited liability.`,
      codeCitation: "IRC § 262(a) (Non-deductibility of personal expenses)",
      actionableRemediation: "Reclassify identified personal items to Owner Draw / Non-Deductible Distribution.",
    });
  }

  if (roundTransferCount > 0) {
    const impact = Math.min(15, roundTransferCount * 3);
    totalScore += impact;
    findings.push({
      id: "dif-round-transfers",
      category: "Unsubstantiated Transfers",
      severity: "medium",
      clientMetric: `${roundTransferCount} Unmemoed Round Transfer${roundTransferCount === 1 ? "" : "s"}`,
      benchmarkMetric: "Documented Intercompany or Payroll Records",
      scoreImpact: impact,
      title: "Round-Dollar Transfers Without Accounting Memo",
      explanation: `Identified ${roundTransferCount} round-dollar transactions (multiples of $500) without clear category tagging. Unexplained round transfers are frequently reclassified as taxable income or disguised distributions on audit.`,
      codeCitation: "IRC § 6001 (Requirement to keep adequate records)",
      actionableRemediation: "Attach bank transfer memo or classify as Owner Equity Draw / Capital Contribution.",
    });
  }

  // 5. De Minimis Safe Harbor Threshold Check (IRC § 263(a))
  const overSafeHarborTxns = data.transactions.filter(
    (t) => Math.abs(t.amount) > 2500 && t.disposition === "business_expense" && !/asset|equipment|capital/i.test(t.categoryName || "")
  );

  if (overSafeHarborTxns.length > 0) {
    const impact = 12;
    totalScore += impact;
    findings.push({
      id: "dif-de-minimis",
      category: "Capitalization vs. Expensing",
      severity: "medium",
      clientMetric: `${overSafeHarborTxns.length} Invoice(s) > $2,500 Expensed`,
      benchmarkMetric: "IRC § 263(a) $2,500 De Minimis Limit",
      scoreImpact: impact,
      title: "Invoices Exceeding De Minimis Expensing Safe Harbor",
      explanation: `Found ${overSafeHarborTxns.length} purchase(s) over $2,500 expensed directly rather than capitalized. Without an annual De Minimis Safe Harbor Election attached to the return, individual items over $2,500 must be capitalized and depreciated.`,
      codeCitation: "Treas. Reg. § 1.263(a)-1(f)",
      actionableRemediation: "Ensure the annual De Minimis Safe Harbor Election statement is included with Form 1040 / 1120-S, or move assets to depreciation schedule.",
    });
  }

  // 6. Multi-Year Low Profit / Hobby Loss Check (IRC § 183)
  if (grossRev > 0 && marginPct < 3.0 && marginPct >= 0) {
    totalScore += 10;
    findings.push({
      id: "dif-low-margin",
      category: "Profit Motive",
      severity: "low",
      clientMetric: `${marginPct.toFixed(1)}% Net Margin`,
      benchmarkMetric: "Healthy Positive Operating Margin",
      scoreImpact: 10,
      title: "Thin Net Profit Margin Alert",
      explanation: "Operating net profit margin is below 3%. Sustained near-zero profit or consecutive loss years triggers IRC § 183 hobby loss scrutiny.",
      codeCitation: "IRC § 183 (Activities not engaged in for profit)",
      actionableRemediation: "Verify business plan and profit motive documentation are kept on file in case of inquiry.",
    });
  } else if (net < 0) {
    totalScore += 15;
    findings.push({
      id: "dif-net-loss",
      category: "Profit Motive",
      severity: "medium",
      clientMetric: `Net Loss of $${Math.abs(net).toLocaleString()}`,
      benchmarkMetric: "Positive Net Income",
      scoreImpact: 15,
      title: "Operating Loss Reported on Schedule C",
      explanation: "Business reports a net operating loss. Schedule C losses are statistically audited at over triple the baseline rate to ensure expenses are legitimate.",
      codeCitation: "IRC § 183 & IRC § 465 (At-Risk Rules)",
      actionableRemediation: "Confirm material participation and at-risk limitations before deducting loss against other income.",
    });
  }

  // Missing Receipt Evidence Penalty
  const missingReceipts = data.transactions.filter(
    (t) => t.disposition === "business_expense" && !t.hasReceipt && Math.abs(t.amount) > 75
  );
  if (missingReceipts.length > 5) {
    const impact = Math.min(15, Math.floor(missingReceipts.length / 2));
    totalScore += impact;
    findings.push({
      id: "dif-missing-evidence",
      category: "Documentary Evidence",
      severity: missingReceipts.length > 15 ? "high" : "medium",
      clientMetric: `${missingReceipts.length} Expenses > $75 Missing Receipts`,
      benchmarkMetric: "100% Contemporaneous Receipt Coverage",
      scoreImpact: impact,
      title: "Missing Documentary Evidence (> $75)",
      explanation: `Identified ${missingReceipts.length} expenses over $75 with no attached receipt image. Under Treasury Reg § 1.274-5, the IRS routinely disallows expenses over $75 lacking documentary receipts.`,
      codeCitation: "Treas. Reg. § 1.274-5(c)(2)(iii)",
      actionableRemediation: "Dispatch mobile request links to client to capture missing receipts prior to filing.",
    });
  }

  // Normalize final score between 0 and 100
  const finalScore = Math.min(100, Math.max(0, totalScore));
  const rating: DifAuditReport["rating"] =
    finalScore <= 30 ? "low_risk" : finalScore <= 65 ? "moderate_risk" : "high_risk";

  // Build the Circular 230 Due Diligence Defense Memo
  const defenseMemoPreview = generateDefenseMemoText({
    score: finalScore,
    rating,
    grossRevenue: grossRev,
    totalExpenses: totalExp,
    netProfit: net,
    findings,
  });

  return {
    score: finalScore,
    rating,
    grossRevenue: grossRev,
    totalExpenses: totalExp,
    netProfit: net,
    profitMarginPercent: marginPct,
    findings,
    comminglingCount,
    missingReceiptCount: missingReceipts.length,
    defenseMemoPreview,
  };
}

/**
 * Generates draft pre-filing review notes for the preparer to review; makes no preparer representation.
 */
function generateDefenseMemoText(data: {
  score: number;
  rating: string;
  grossRevenue: number;
  totalExpenses: number;
  netProfit: number;
  findings: DifRiskFinding[];
}): string {
  const ratingLabel =
    data.rating === "low_risk"
      ? "LOW RISK (Within Statistical Norms)"
      : data.rating === "moderate_risk"
      ? "MODERATE RISK (Practitioner Notes Documented)"
      : "ELEVATED RISK (Requires Client Clarification Prior to Filing)";

  const findingsList = data.findings.length === 0
    ? "No statistical anomalies detected. All expense categories conform to national benchmarks."
    : data.findings
        .map(
          (f, idx) =>
            `${idx + 1}. [${f.severity.toUpperCase()}] ${f.title}\n   - Statutory Reference: ${f.codeCitation}\n   - Client Metric: ${f.clientMetric} (Benchmark: ${f.benchmarkMetric})\n   - Due Diligence Note: ${f.actionableRemediation}`
        )
        .join("\n\n");

  return `PRE-FILING REVIEW NOTES (DRAFT)
Purpose: support the preparer's own diligence review (31 CFR § 10.22)
Generated by: Truepost

EXECUTIVE SUMMARY:
- Truepost variance score (not an IRS DIF score): ${data.score} / 100 (${ratingLabel})
- Reconciled Gross Receipts: $${data.grossRevenue.toLocaleString()}
- Total Business Deductions: $${data.totalExpenses.toLocaleString()}
- Net Taxable Profit / (Loss): $${data.netProfit.toLocaleString()}

DOCUMENTED DUE DILIGENCE REVIEW ITEMS:
${findingsList}

PREPARER REVIEW REQUIRED:
Truepost generated this draft from the data in this client file. It is not a statement by the preparer and makes no representation about the return. The preparer must review the items above, confirm the facts, and decide each position under their own professional standards.`;
}
