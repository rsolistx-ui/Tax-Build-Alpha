/**
 * Truepost Tax Advisory Roadmap Generator & Strategy Engine
 *
 * Implements high-leverage tax optimization strategies for small business owners
 * and closely held entities, complying with IRS statutory guidelines and
 * Treasury Circular 230 due diligence standards.
 *
 * Strategies:
 * 1. S-Corp Reasonable Compensation Optimizer (IRC §§ 1361, 1366, 3121, Watson v. US)
 * 2. Augusta Rule Home Rental Strategy (IRC § 280A(g))
 * 3. Solo 401(k) & Cash Balance Defined Benefit Retirement Maximizer (IRC §§ 401(k), 404, 415)
 * 4. Section 179 Accelerated Depreciation & Heavy Vehicle Write-Off (IRC §§ 168(k), 179, 280F)
 */

export interface SCorpOptResult {
  strategyId: "scorp_recomp";
  strategyTitle: string;
  isApplicable: boolean;
  netProfit: number;
  solePropSeTax: number;
  recommendedSalary: number;
  recommendedDistribution: number;
  sCorpPayrollTax: number;
  grossFicaSavings: number;
  estimatedAdminComplianceCost: number;
  netAnnualSavings: number;
  ircAuthority: string;
  implementationRoadmap: string[];
  rationale: string;
}

export interface AugustaRuleResult {
  strategyId: "augusta_rule";
  strategyTitle: string;
  isApplicable: boolean;
  daysRented: number;
  dailyRate: number;
  totalTaxFreeIncome: number;
  corporateTaxSavings: number;
  ownerPersonalSavings: number;
  totalAnnualSavings: number;
  ircAuthority: string;
  implementationRoadmap: string[];
  rationale: string;
}

export interface RetirementMaximizerResult {
  strategyId: "retirement_shelter";
  strategyTitle: string;
  isApplicable: boolean;
  ownerAge: number;
  employeeElectiveDeferral: number;
  employerProfitSharing: number;
  totalSolo401kContribution: number;
  cashBalanceEligible: boolean;
  cashBalanceContribution: number;
  totalRetirementDeduction: number;
  estimatedTaxSavings: number;
  ircAuthority: string;
  implementationRoadmap: string[];
  rationale: string;
}

export interface Section179Result {
  strategyId: "section_179";
  strategyTitle: string;
  isApplicable: boolean;
  qualifyingAssetPurchases: number;
  section179Deduction: number;
  firstYearBonusDepreciation: number;
  totalFirstYearDeduction: number;
  firstYearTaxSavings: number;
  standardMacrsComparison: number;
  immediateCashAdvantage: number;
  ircAuthority: string;
  implementationRoadmap: string[];
  rationale: string;
}

export interface TaxAdvisoryRoadmap {
  generatedAt: string;
  clientId: string;
  clientName: string;
  taxYear: number;
  baselineNetProfit: number;
  effectiveTaxBracketPercent: number;
  totalEstimatedAnnualSavings: number;
  executiveSummary: string;
  strategies: {
    scorpOpt: SCorpOptResult;
    augustaRule: AugustaRuleResult;
    retirementShelter: RetirementMaximizerResult;
    section179: Section179Result;
  };
  actionChecklist: {
    phase: "immediate_30_days" | "mid_year" | "year_end_filing";
    title: string;
    description: string;
    statutoryRef: string;
  }[];
  circular230AdvisoryNotice: string;
}

export interface AdvisoryInputs {
  taxYear?: number;
  netProfit: number;
  entityType?: string | null;
  industry?: string | null;
  marginalTaxBracket?: number; // e.g. 0.24, 0.32, 0.37 (default 0.28)
  ownerAge?: number; // default 45
  hoursWorkedPerWeek?: number; // default 40
  augustaDays?: number; // default 12 (max 14)
  augustaDailyRate?: number; // default $1,250
  plannedEquipmentPurchases?: number; // default $0
  heavyVehiclePurchases?: number; // default $0
}

/**
 * 2024–2026 Statutory Constants
 */
const SS_WAGE_BASE_CAP = 168600; // 2024 Social Security wage base ($176,100 for 2025)
const OASDI_RATE = 0.124; // 12.4% OASDI
const MEDICARE_RATE = 0.029; // 2.9% Medicare
const ADDITIONAL_MEDICARE_RATE = 0.009; // 0.9% on earnings > $200k
const SECTION_179_CAP = 1220000; // $1.22M cap under IRC § 179
const SOLO_401K_ELECTIVE_LIMIT_UNDER_50 = 23000;
const SOLO_401K_CATCH_UP_50_PLUS = 7500;
const SOLO_401K_TOTAL_DC_CAP = 69000;

/**
 * Strategy 1: S-Corporation Reasonable Compensation Optimizer
 * Evaluates payroll tax savings under IRC § 1361/1366 while strictly respecting
 * Watson v. US, McAlary Ltd, and IRS Fact Sheet FS-2008-25.
 */
export function calculateSCorpOpt(
  netProfit: number,
  industry?: string | null,
  hoursPerWeek: number = 40,
  currentEntityType?: string | null
): SCorpOptResult {
  if (netProfit <= 0) {
    return {
      strategyId: "scorp_recomp",
      strategyTitle: "S-Corporation Reasonable Compensation Optimization",
      isApplicable: false,
      netProfit: 0,
      solePropSeTax: 0,
      recommendedSalary: 0,
      recommendedDistribution: 0,
      sCorpPayrollTax: 0,
      grossFicaSavings: 0,
      estimatedAdminComplianceCost: 0,
      netAnnualSavings: 0,
      ircAuthority: "IRC §§ 1361, 1366, 3121; Treas. Reg. § 1.1366-1",
      implementationRoadmap: [
        "Monitor net operating profitability before considering Form 2553 election.",
      ],
      rationale: "Operating profit is currently break-even or negative. S-Corporation election requires positive net earnings to produce tax savings.",
    };
  }

  // Sole Proprietorship / Disregarded Single-Member LLC SE Tax:
  // 92.35% of net profit is subject to SE tax (12.4% OASDI up to cap + 2.9% Medicare + 0.9% additional over $200k)
  const seBase = netProfit * 0.9235;
  const seSs = Math.min(seBase, SS_WAGE_BASE_CAP) * OASDI_RATE;
  const seMed = seBase * MEDICARE_RATE;
  const seAddMed = Math.max(0, seBase - 200000) * ADDITIONAL_MEDICARE_RATE;
  const solePropSeTax = Math.round(seSs + seMed + seAddMed);

  // Determine Reasonable Compensation based on Industry & Effort
  // Service-intensive industries require higher salary ratio (55-65%)
  // Capital/inventory-intensive businesses can justify lower salary ratio (35-45%)
  const ind = (industry || "").toLowerCase();
  let baseSalaryPercent = 0.50; // default 50/50 split
  if (
    ind.includes("consult") ||
    ind.includes("legal") ||
    ind.includes("account") ||
    ind.includes("medical") ||
    ind.includes("dental") ||
    ind.includes("engineer") ||
    ind.includes("software")
  ) {
    baseSalaryPercent = 0.60;
  } else if (
    ind.includes("real estate") ||
    ind.includes("construction") ||
    ind.includes("retail") ||
    ind.includes("transport") ||
    ind.includes("manufactur")
  ) {
    baseSalaryPercent = 0.40;
  }

  // Part-time adjustment
  const hoursMultiplier = Math.min(1.0, Math.max(0.4, hoursPerWeek / 40));
  let recommendedSalary = Math.round(netProfit * baseSalaryPercent * hoursMultiplier);

  // IRS Floor: A full-time executive shouldn't be under minimum wage / reasonable living wage ($35k floor if profit permits)
  if (hoursPerWeek >= 30 && netProfit >= 70000) {
    recommendedSalary = Math.max(recommendedSalary, 45000);
  }
  // Salary cannot exceed net profit
  recommendedSalary = Math.min(recommendedSalary, netProfit);

  const recommendedDistribution = Math.max(0, netProfit - recommendedSalary);

  // S-Corp Payroll Tax (FICA) only on salary
  const sCorpSs = Math.min(recommendedSalary, SS_WAGE_BASE_CAP) * OASDI_RATE;
  const sCorpMed = recommendedSalary * MEDICARE_RATE;
  const sCorpAddMed = Math.max(0, recommendedSalary - 200000) * ADDITIONAL_MEDICARE_RATE;
  const sCorpPayrollTax = Math.round(sCorpSs + sCorpMed + sCorpAddMed);

  // Gross savings
  const grossFicaSavings = Math.max(0, solePropSeTax - sCorpPayrollTax);

  // Realistic annual administrative cost:
  // Payroll service ($600/yr) + Form 1120-S tax return prep ($1,200/yr) = $1,800
  const estimatedAdminComplianceCost = 1800;
  const netAnnualSavings = Math.max(0, grossFicaSavings - estimatedAdminComplianceCost);

  const isApplicable = netProfit >= 55000 && netAnnualSavings >= 2000;

  const isAlreadySCorp = (currentEntityType || "").toLowerCase().includes("s_corp");

  const rationale = isAlreadySCorp
    ? `Client is currently structured as an S-Corporation. By optimizing officer compensation to a defensible $${recommendedSalary.toLocaleString()} (based on ${Math.round(baseSalaryPercent * 100)}% industry benchmark), the remaining $${recommendedDistribution.toLocaleString()} is protected from payroll taxes while preserving IRS audit defense under Watson v. US.`
    : isApplicable
    ? `At $${netProfit.toLocaleString()} net profit, the client is losing approximately $${solePropSeTax.toLocaleString()} to Self-Employment Tax. Electing S-Corporation status (Form 2553) with a $${recommendedSalary.toLocaleString()} defensible officer salary preserves $${recommendedDistribution.toLocaleString()} in tax-free distributions, delivering $${netAnnualSavings.toLocaleString()} in net annual cash savings after compliance costs.`
    : `S-Corporation election is break-even or marginal at the current profit level ($${netProfit.toLocaleString()}). Recommended threshold is $55,000+ net profit.`;

  return {
    strategyId: "scorp_recomp",
    strategyTitle: "S-Corporation Reasonable Compensation Optimization",
    isApplicable,
    netProfit,
    solePropSeTax,
    recommendedSalary,
    recommendedDistribution,
    sCorpPayrollTax,
    grossFicaSavings,
    estimatedAdminComplianceCost,
    netAnnualSavings,
    ircAuthority: "IRC §§ 1361, 1366, 3121; David E. Watson, P.C. v. United States, 668 F.3d 1008; Rev. Rul. 74-44",
    implementationRoadmap: [
      "File IRS Form 2553 (Election by a Small Business Corporation) or late-relief election under Rev. Proc. 2013-30.",
      `Set up automated executive payroll run for officer salary ($${recommendedSalary.toLocaleString()}/year, or $${Math.round(recommendedSalary / 12).toLocaleString()}/month).`,
      "Draft formal Corporate Resolution establishing officer compensation and job description.",
      `Schedule quarterly shareholder distributions for remainder ($${Math.round(recommendedDistribution / 4).toLocaleString()}/quarter).`,
    ],
    rationale,
  };
}

/**
 * Strategy 2: Augusta Rule (IRC § 280A(g)) 14-Day Home Rental Strategy
 * Allows business owner to rent primary residence to business for up to 14 days/year.
 * 100% tax-free income to owner; 100% tax-deductible to business.
 */
export function calculateAugustaRule(
  daysRented: number = 12,
  dailyMarketRate: number = 1250,
  ownerTaxBracket: number = 0.28
): AugustaRuleResult {
  // Cap strictly at 14 statutory days under IRC § 280A(g)
  const validDays = Math.min(14, Math.max(1, Math.round(daysRented)));
  const validRate = Math.max(100, Math.round(dailyMarketRate));
  const totalTaxFreeIncome = validDays * validRate;

  // The business deducts this amount as an ordinary and necessary rent expense (IRC § 162).
  // Cash saved equals business tax deduction (at effective bracket) + 0% tax to homeowner.
  const totalAnnualSavings = Math.round(totalTaxFreeIncome * ownerTaxBracket);

  return {
    strategyId: "augusta_rule",
    strategyTitle: "Augusta Rule (IRC § 280A(g)) Corporate Meeting Rental Strategy",
    isApplicable: totalTaxFreeIncome > 0,
    daysRented: validDays,
    dailyRate: validRate,
    totalTaxFreeIncome,
    corporateTaxSavings: totalAnnualSavings,
    ownerPersonalSavings: totalTaxFreeIncome, // $0 taxes owed on personal 1040 for this income
    totalAnnualSavings,
    ircAuthority: "IRC § 280A(g); IRC § 162(a)(3); IRS Publication 587",
    implementationRoadmap: [
      `Obtain 3 independent commercial venue rate quotes in client's zip code establishing average fair market value (~$${validRate.toLocaleString()}/day).`,
      `Adopt corporate resolution authorizing ${validDays} formal business meeting days at primary residence.`,
      "Execute formal rental agreement between business entity and homeowner prior to meeting dates.",
      "Maintain detailed meeting minutes, attendee sign-in roster, and agenda for each rental date.",
      "Issue payment directly from business operating bank account to homeowner with memo 'IRC § 280A Rental'.",
    ],
    rationale: `Under IRC § 280A(g), renting personal residence to the business for ${validDays} days at $${validRate.toLocaleString()}/day generates $${totalTaxFreeIncome.toLocaleString()} in 100% tax-free income to the owner, while generating an identical $${totalTaxFreeIncome.toLocaleString()} corporate tax write-off, saving an estimated $${totalAnnualSavings.toLocaleString()} in income taxes.`,
  };
}

/**
 * Strategy 3: Solo 401(k) & Cash Balance Defined Benefit Retirement Shelter
 * Compares standard limits against Solo 401(k) and Cash Balance Plan for high earners.
 */
export function calculateRetirementShelter(
  netProfit: number,
  w2Salary: number = 0,
  ownerAge: number = 45,
  marginalBracket: number = 0.28
): RetirementMaximizerResult {
  if (netProfit <= 15000) {
    return {
      strategyId: "retirement_shelter",
      strategyTitle: "Solo 401(k) & Defined Benefit Retirement Shelter",
      isApplicable: false,
      ownerAge,
      employeeElectiveDeferral: 0,
      employerProfitSharing: 0,
      totalSolo401kContribution: 0,
      cashBalanceEligible: false,
      cashBalanceContribution: 0,
      totalRetirementDeduction: 0,
      estimatedTaxSavings: 0,
      ircAuthority: "IRC §§ 401(k), 404, 415; ERISA § 401",
      implementationRoadmap: ["Evaluate retirement plan setup when net profit exceeds $30,000."],
      rationale: "Current net earnings do not yet generate sufficient surplus cash flow for significant qualified retirement plan shelter.",
    };
  }

  // Compensation base for 401(k):
  // If W-2 salary provided (S-Corp), use salary. Otherwise (Sole Prop), use net profit minus 50% SE tax.
  const compBase = w2Salary > 0 ? w2Salary : netProfit * 0.9235 * 0.8;

  // 1. Employee Elective Deferral
  const catchUp = ownerAge >= 50 ? SOLO_401K_CATCH_UP_50_PLUS : 0;
  const employeeDeferral = Math.min(compBase, SOLO_401K_ELECTIVE_LIMIT_UNDER_50 + catchUp);

  // 2. Employer Profit Sharing: up to 25% of W-2 comp (or 20% for unincorporated)
  const profitSharePct = w2Salary > 0 ? 0.25 : 0.20;
  let employerProfitShare = Math.round(compBase * profitSharePct);

  // Ensure total doesn't exceed DC statutory ceiling ($69,000 + catch-up)
  const maxTotalSolo = SOLO_401K_TOTAL_DC_CAP + catchUp;
  if (employeeDeferral + employerProfitShare > maxTotalSolo) {
    employerProfitShare = Math.max(0, maxTotalSolo - employeeDeferral);
  }

  const totalSolo401k = employeeDeferral + employerProfitShare;

  // 3. Cash Balance Defined Benefit Plan:
  // For owners with net profit > $150,000, an actuarially designed Cash Balance Plan can shelter
  // an additional $80,000 to $250,000+ per year depending on age.
  const cashBalanceEligible = netProfit >= 150000;
  let cashBalanceContribution = 0;
  if (cashBalanceEligible) {
    if (ownerAge >= 50) {
      cashBalanceContribution = Math.min(180000, Math.round(netProfit * 0.40));
    } else {
      cashBalanceContribution = Math.min(100000, Math.round(netProfit * 0.25));
    }
  }

  const totalRetirementDeduction = totalSolo401k + cashBalanceContribution;
  const estimatedTaxSavings = Math.round(totalRetirementDeduction * marginalBracket);

  return {
    strategyId: "retirement_shelter",
    strategyTitle: "Solo 401(k) & Defined Benefit Retirement Shelter",
    isApplicable: totalRetirementDeduction >= 15000,
    ownerAge,
    employeeElectiveDeferral: employeeDeferral,
    employerProfitSharing: employerProfitShare,
    totalSolo401kContribution: totalSolo401k,
    cashBalanceEligible,
    cashBalanceContribution,
    totalRetirementDeduction,
    estimatedTaxSavings,
    ircAuthority: "IRC §§ 401(a), 401(k), 404(a)(3), 415(c); SECURE Act 2.0",
    implementationRoadmap: [
      "Adopt a prototype Solo 401(k) plan agreement with checkbook control and loan provisions.",
      `Make employee salary deferral of $${employeeDeferral.toLocaleString()} before December 31.`,
      `Fund employer profit-sharing contribution ($${employerProfitShare.toLocaleString()}) by tax return filing deadline (including extensions).`,
      cashBalanceEligible
        ? `Engage enrolled actuary to design paired Cash Balance plan sheltering up to $${cashBalanceContribution.toLocaleString()} additional pre-tax income.`
        : "Re-evaluate Cash Balance DB plan when annual profit crosses $150,000.",
    ],
    rationale: `By structuring an owner-only Solo 401(k)${cashBalanceEligible ? " paired with a Cash Balance Defined Benefit Plan" : ""}, the client can legally divert up to $${totalRetirementDeduction.toLocaleString()} into tax-deferred accounts, slashing taxable income and creating an estimated $${estimatedTaxSavings.toLocaleString()} in immediate tax savings.`,
  };
}

/**
 * Strategy 4: Section 179 Accelerated Depreciation & Heavy Vehicle Write-Off
 * Evaluates immediate 100% first-year expensing under IRC § 179 and bonus depreciation.
 */
export function calculateSection179Strategy(
  plannedEquipmentPurchases: number = 0,
  heavyVehiclePurchases: number = 0,
  marginalBracket: number = 0.28
): Section179Result {
  const totalAssets = plannedEquipmentPurchases + heavyVehiclePurchases;

  // Equipment eligible for § 179 up to $1,220,000
  const equipmentDeduction = Math.min(plannedEquipmentPurchases, SECTION_179_CAP);

  // Heavy vehicles (>6,000 lbs GVWR): under IRC § 179, qualifying passenger SUVs capped at $30,500;
  // full-bed trucks / cargo vans eligible for 100% expensing.
  // We model average heavy vehicle full write-off or up to $30,500+ standard bonus.
  const heavyVehicleDeduction = Math.min(heavyVehiclePurchases, SECTION_179_CAP);

  const section179Deduction = equipmentDeduction + heavyVehicleDeduction;
  const firstYearBonusDepreciation = 0; // 60% bonus under TCJA phaseout for 2024, but 179 absorbs up to $1.22M first
  const totalFirstYearDeduction = Math.min(totalAssets, section179Deduction);

  const firstYearTaxSavings = Math.round(totalFirstYearDeduction * marginalBracket);

  // Standard 5-year MACRS first-year rate is only 20%
  const standardMacrsFirstYear = Math.round(totalAssets * 0.20 * marginalBracket);
  const immediateCashAdvantage = Math.max(0, firstYearTaxSavings - standardMacrsFirstYear);

  const isApplicable = totalAssets >= 5000;

  return {
    strategyId: "section_179",
    strategyTitle: "Section 179 Accelerated Depreciation & Heavy Vehicle Write-Off",
    isApplicable,
    qualifyingAssetPurchases: totalAssets,
    section179Deduction: totalFirstYearDeduction,
    firstYearBonusDepreciation,
    totalFirstYearDeduction,
    firstYearTaxSavings,
    standardMacrsComparison: standardMacrsFirstYear,
    immediateCashAdvantage,
    ircAuthority: "IRC § 179; IRC § 168(k); IRC § 280F; Rev. Proc. 2024-13",
    implementationRoadmap: [
      "Verify asset placed-in-service date occurs prior to December 31 of current tax year.",
      "For vehicles: verify Gross Vehicle Weight Rating (GVWR) exceeds 6,000 lbs on door jamb VIN sticker.",
      "Maintain mileage and business use log confirming >50% qualified business use.",
      "Elect Form 4562 Part I (Election to Expense Certain Property Under Section 179).",
    ],
    rationale: totalAssets > 0
      ? `Purchasing $${totalAssets.toLocaleString()} in qualifying equipment/vehicles allows electing immediate Section 179 first-year expensing, producing $${firstYearTaxSavings.toLocaleString()} in immediate cash tax savings (an immediate $${immediateCashAdvantage.toLocaleString()} liquidity advantage over standard 5-year MACRS depreciation).`
      : "Client has not yet designated capital equipment or qualifying vehicle purchases. Adding $35,000+ in operational equipment or a >6,000 lb GVWR vehicle can yield over $9,800 in immediate first-year tax write-offs.",
  };
}

/**
 * Master Advisory Engine: Generates Full Tax Advisory Strategy Roadmap
 */
export function generateAdvisoryRoadmap(
  clientId: string,
  clientName: string,
  inputs: AdvisoryInputs
): TaxAdvisoryRoadmap {
  const taxYear = inputs.taxYear || new Date().getFullYear();
  const netProfit = Math.max(0, inputs.netProfit);
  const bracket = inputs.marginalTaxBracket || 0.28;
  const ownerAge = inputs.ownerAge || 45;
  const hours = inputs.hoursWorkedPerWeek || 40;
  const augustaDays = inputs.augustaDays ?? 12;
  const augustaRate = inputs.augustaDailyRate ?? 1250;
  const equipment = (inputs.plannedEquipmentPurchases || 0) + (inputs.heavyVehiclePurchases || 0);

  // Run all 4 strategy calculations
  const scorpOpt = calculateSCorpOpt(netProfit, inputs.industry, hours, inputs.entityType);
  const augustaRule = calculateAugustaRule(augustaDays, augustaRate, bracket);
  const retirementShelter = calculateRetirementShelter(
    netProfit,
    scorpOpt.recommendedSalary,
    ownerAge,
    bracket
  );
  const section179 = calculateSection179Strategy(
    inputs.plannedEquipmentPurchases || 0,
    inputs.heavyVehiclePurchases || 0,
    bracket
  );

  // Calculate aggregated savings
  let totalEstimatedAnnualSavings = 0;
  if (scorpOpt.isApplicable) totalEstimatedAnnualSavings += scorpOpt.netAnnualSavings;
  if (augustaRule.isApplicable) totalEstimatedAnnualSavings += augustaRule.totalAnnualSavings;
  if (retirementShelter.isApplicable) totalEstimatedAnnualSavings += retirementShelter.estimatedTaxSavings;
  if (section179.isApplicable) totalEstimatedAnnualSavings += section179.firstYearTaxSavings;

  // Executive summary
  const applicableCount = [
    scorpOpt.isApplicable,
    augustaRule.isApplicable,
    retirementShelter.isApplicable,
    section179.isApplicable,
  ].filter(Boolean).length;

  const executiveSummary = `Comprehensive tax strategy analysis for ${clientName} identified ${applicableCount} high-leverage tax mitigation strategies across corporate structure, statutory deductions, qualified retirement shelters, and capital asset timing. Implementing these recommendations is projected to deliver approximately $${totalEstimatedAnnualSavings.toLocaleString()} in combined annual and first-year tax savings. Each strategy requires preparer review against the client's facts before it is recommended.`;

  // Action checklist by phase
  const actionChecklist: TaxAdvisoryRoadmap["actionChecklist"] = [
    {
      phase: "immediate_30_days",
      title: "Adopt Corporate Resolutions & Augusta Rental Agreement",
      description: `Execute rental agreement for up to ${augustaRule.daysRented} corporate meeting days at fair market value rate ($${augustaRule.dailyRate}/day). Record formal board/shareholder minutes.`,
      statutoryRef: "IRC § 280A(g)",
    },
    {
      phase: "mid_year",
      title: scorpOpt.isApplicable ? "Form 2553 S-Corporation Election & Payroll Setup" : "Quarterly Estimated Tax & Entity Review",
      description: scorpOpt.isApplicable
        ? `Submit IRS Form 2553 and establish officer payroll of $${scorpOpt.recommendedSalary.toLocaleString()}/yr ($${Math.round(scorpOpt.recommendedSalary / 12).toLocaleString()}/mo) to eliminate $${scorpOpt.grossFicaSavings.toLocaleString()} in self-employment taxes.`
        : "Review year-to-date operating net profit against $55,000 S-Corp crossover threshold.",
      statutoryRef: scorpOpt.isApplicable ? "IRC § 1362(a); Rev. Proc. 2013-30" : "IRC § 6654",
    },
    {
      phase: "year_end_filing",
      title: "Execute Retirement Funding & Section 179 Asset Placements",
      description: `Maximize Solo 401(k) salary deferral and profit-sharing contributions (up to $${retirementShelter.totalRetirementDeduction.toLocaleString()}). Confirm capital equipment placements prior to Dec 31 for full first-year expensing.`,
      statutoryRef: "IRC §§ 179, 401(k), 404",
    },
  ];

  // Circular 230 Due Diligence Advisory Notice
  const circular230AdvisoryNotice = `IMPORTANT: This draft tax planning analysis is prepared for the confidential use of ${clientName}. The tax planning calculations and recommendations contained herein are based upon historical ledger data and assumptions provided by management. Application of tax strategies depends upon the specific facts, circumstances, and substantiation maintained by the taxpayer. This analysis does not constitute a formal guarantee of tax results, and timely execution of legal agreements, payroll filings, and corporate minutes is required to substantiate positions upon examination.`;

  return {
    generatedAt: new Date().toISOString(),
    clientId,
    clientName,
    taxYear,
    baselineNetProfit: netProfit,
    effectiveTaxBracketPercent: Math.round(bracket * 100),
    totalEstimatedAnnualSavings,
    executiveSummary,
    strategies: {
      scorpOpt,
      augustaRule,
      retirementShelter,
      section179,
    },
    actionChecklist,
    circular230AdvisoryNotice,
  };
}
