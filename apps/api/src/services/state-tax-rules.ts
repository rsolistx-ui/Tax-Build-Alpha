import type { Db } from "../db";
import { newId } from "../lib/id";
import { createStateMod, listStateMods } from "./tax-state-mods";

export interface CaliforniaConformityInput {
  federalBonusDepreciation?: number;
  californiaAllowableDepreciation?: number;
  federalSection179Deduction?: number;
  hsaContributionsDeducted?: number;
  hsaEarningsTaxable?: number;
  isCaliforniaLlc?: boolean;
  californiaGrossReceipts?: number;
  californiaPteTaxPaid?: number;
}

export interface NewYorkConformityInput {
  federalBonusDepreciation?: number;
  newYorkAllowableDepreciation?: number;
  stateLocalTaxDeductedFed?: number;
  mctdNetSelfEmploymentEarnings?: number;
  mctdZone?: 1 | 2; // Zone 1 = NYC (0.60%), Zone 2 = Suburbs (0.34%)
  nyPtetTaxPaid?: number;
}

export interface ComputedStateMod {
  state: "CA" | "NY";
  modificationType: "addition" | "subtraction" | "credit" | "other";
  description: string;
  amount: number;
  federalLineCode?: string;
  stateLineCode?: string;
  statutoryReference: string;
  explanation: string;
}

export interface StateConformityResult {
  state: "CA" | "NY";
  taxYear: number;
  modifications: ComputedStateMod[];
  totalAdditions: number;
  totalSubtractions: number;
  totalCredits: number;
  specialTaxesOrFees: {
    title: string;
    amount: number;
    statutoryCitation: string;
  }[];
}

/**
 * California Form 540 & Schedule CA (540) Conformity Engine:
 * Implements California Revenue and Taxation Code (R&TC) non-conformity rules.
 */
export function computeCaliforniaConformity(
  taxYear: number,
  input: CaliforniaConformityInput,
): StateConformityResult {
  const modifications: ComputedStateMod[] = [];
  const specialTaxesOrFees: StateConformityResult["specialTaxesOrFees"] = [];

  // 1. Bonus Depreciation Non-Conformity (IRC § 168(k) vs R&TC § 17201 / 17250)
  // California does not conform to federal 100%, 80%, or 60% bonus depreciation.
  const fedBonus = Number(input.federalBonusDepreciation ?? 0);
  const caDepr = Number(input.californiaAllowableDepreciation ?? 0);
  if (fedBonus > 0) {
    modifications.push({
      state: "CA",
      modificationType: "addition",
      description: "Federal bonus depreciation add-back (IRC § 168(k) non-conformity)",
      amount: fedBonus,
      federalLineCode: "Form 4562 Line 14/25",
      stateLineCode: "Schedule CA (540) Part I Section B Line 8z",
      statutoryReference: "Cal. Rev. & Tax Code § 17250",
      explanation: "California does not allow federal bonus depreciation. Full federal bonus deduction is added back.",
    });

    if (caDepr > 0) {
      modifications.push({
        state: "CA",
        modificationType: "subtraction",
        description: "California regular allowable MACRS/straight-line depreciation deduction",
        amount: caDepr,
        federalLineCode: "Form 4562",
        stateLineCode: "Schedule CA (540) Part I Section B Line 8z (Col B)",
        statutoryReference: "Cal. Rev. & Tax Code § 17250",
        explanation: "California MACRS depreciation allowable in place of disallowed federal bonus depreciation.",
      });
    }
  }

  // 2. California Section 179 Expense Limit ($25,000 Cap)
  // Federal limit exceeds $1.1M; California caps deduction at $25,000 (R&TC § 17255).
  const fed179 = Number(input.federalSection179Deduction ?? 0);
  const CA_179_CAP = 25000;
  if (fed179 > CA_179_CAP) {
    const disallowed179 = fed179 - CA_179_CAP;
    modifications.push({
      state: "CA",
      modificationType: "addition",
      description: `Section 179 expense excess over California $25,000 statutory ceiling`,
      amount: disallowed179,
      federalLineCode: "Form 4562 Line 12",
      stateLineCode: "Schedule CA (540) Part II / FTB 3885A",
      statutoryReference: "Cal. Rev. & Tax Code § 17255",
      explanation: `Federal Sec 179 was $${fed179.toLocaleString()}, which exceeds the California statutory limit of $25,000 by $${disallowed179.toLocaleString()}.`,
    });
  }

  // 3. Health Savings Account (HSA) Non-Conformity (IRC § 223 vs R&TC § 17215)
  // California does not recognize HSA deductions or tax-exempt status of HSA earnings.
  const hsaDed = Number(input.hsaContributionsDeducted ?? 0);
  if (hsaDed > 0) {
    modifications.push({
      state: "CA",
      modificationType: "addition",
      description: "HSA contribution deduction add-back (CA does not recognize IRC § 223)",
      amount: hsaDed,
      federalLineCode: "Form 1040 Schedule 1 Line 13",
      stateLineCode: "Schedule CA (540) Part I Section C Line 13",
      statutoryReference: "Cal. Rev. & Tax Code § 17215",
      explanation: "California does not conform to federal HSA deductions. Contributions are taxable California income.",
    });
  }

  const hsaEarn = Number(input.hsaEarningsTaxable ?? 0);
  if (hsaEarn > 0) {
    modifications.push({
      state: "CA",
      modificationType: "addition",
      description: "HSA account interest & investment earnings taxable in California",
      amount: hsaEarn,
      federalLineCode: "Form 1040 Schedule B (Exempt Fed)",
      stateLineCode: "Schedule CA (540) Part I Section A Line 2b",
      statutoryReference: "Cal. Rev. & Tax Code § 17215",
      explanation: "HSA earnings are not exempt under California law and must be recognized as California taxable interest/dividends.",
    });
  }

  // 4. California LLC Annual Minimum Franchise Tax ($800) & Gross Receipts Fee
  // R&TC § 17941 & § 17942
  if (input.isCaliforniaLlc) {
    let llcFee = 0;
    const receipts = Number(input.californiaGrossReceipts ?? 0);
    if (receipts >= 5000000) {
      llcFee = 11790;
    } else if (receipts >= 1000000) {
      llcFee = 6000;
    } else if (receipts >= 500000) {
      llcFee = 2500;
    } else if (receipts >= 250000) {
      llcFee = 900;
    }

    specialTaxesOrFees.push({
      title: "California Annual LLC Minimum Franchise Tax",
      amount: 800,
      statutoryCitation: "Cal. Rev. & Tax Code § 17941 (Form 568)",
    });

    if (llcFee > 0) {
      specialTaxesOrFees.push({
        title: `California LLC Gross Receipts Fee (Receipts: $${receipts.toLocaleString()})`,
        amount: llcFee,
        statutoryCitation: "Cal. Rev. & Tax Code § 17942 (Form 568 Line 2)",
      });
    }
  }

  // 5. California Pass-Through Entity (PTE) Elective Tax Credit (AB 150)
  // R&TC § 17052.10 (9.3% elective tax)
  const pteTax = Number(input.californiaPteTaxPaid ?? 0);
  if (pteTax > 0) {
    modifications.push({
      state: "CA",
      modificationType: "credit",
      description: "California Pass-Through Entity Elective Tax Credit (AB 150)",
      amount: pteTax,
      federalLineCode: "Schedule K-1 (PTE SALT Deduction)",
      stateLineCode: "Form 3804-CR / Form 540 Line 43",
      statutoryReference: "Cal. Rev. & Tax Code § 17052.10",
      explanation: "9.3% PTE elective tax paid at entity level yields nonrefundable credit on California individual return.",
    });
    // PTE tax deducted on federal Schedule K-1 must be added back to California taxable income
    modifications.push({
      state: "CA",
      modificationType: "addition",
      description: "PTE elective tax deducted on federal K-1 add-back to CA income",
      amount: pteTax,
      federalLineCode: "Schedule K-1 Box 1",
      stateLineCode: "Schedule CA (540) Part I Line 5",
      statutoryReference: "Cal. Rev. & Tax Code § 17052.10(h)",
      explanation: "Required state addition to prevent double deduction of the entity-level elective tax.",
    });
  }

  const totalAdditions = modifications
    .filter((m) => m.modificationType === "addition")
    .reduce((acc, m) => acc + m.amount, 0);

  const totalSubtractions = modifications
    .filter((m) => m.modificationType === "subtraction")
    .reduce((acc, m) => acc + m.amount, 0);

  const totalCredits = modifications
    .filter((m) => m.modificationType === "credit")
    .reduce((acc, m) => acc + m.amount, 0);

  return {
    state: "CA",
    taxYear,
    modifications,
    totalAdditions,
    totalSubtractions,
    totalCredits,
    specialTaxesOrFees,
  };
}

/**
 * New York Form IT-201 & IT-225 Conformity Engine:
 * Implements New York State Tax Law Article 22 & Article 23 conformity rules.
 */
export function computeNewYorkConformity(
  taxYear: number,
  input: NewYorkConformityInput,
): StateConformityResult {
  const modifications: ComputedStateMod[] = [];
  const specialTaxesOrFees: StateConformityResult["specialTaxesOrFees"] = [];

  // 1. Bonus Depreciation Add-Back (NY Form IT-225, Code A-201)
  // NY Tax Law § 612(b)(8)
  const fedBonus = Number(input.federalBonusDepreciation ?? 0);
  const nyDepr = Number(input.newYorkAllowableDepreciation ?? 0);
  if (fedBonus > 0) {
    modifications.push({
      state: "NY",
      modificationType: "addition",
      description: "Code A-201: Federal special depreciation (bonus depreciation) add-back",
      amount: fedBonus,
      federalLineCode: "Form 4562 Line 14/25",
      stateLineCode: "Form IT-225 Line 1 / Code A-201",
      statutoryReference: "N.Y. Tax Law § 612(b)(8)",
      explanation: "NY requires adding back IRC § 168(k) special depreciation for property placed in service outside the NY Resurgence Zone.",
    });

    if (nyDepr > 0) {
      modifications.push({
        state: "NY",
        modificationType: "subtraction",
        description: "Code S-201: Regular New York allowable depreciation deduction",
        amount: nyDepr,
        federalLineCode: "Form 4562",
        stateLineCode: "Form IT-225 Line 10 / Code S-201",
        statutoryReference: "N.Y. Tax Law § 612(c)(16)",
        explanation: "Allowable New York MACRS depreciation in lieu of federal bonus depreciation.",
      });
    }
  }

  // 2. State & Local Income Taxes Deducted on Federal Return (NY Form IT-225, Code A-101)
  // NY Tax Law § 612(b)(3)
  const salt = Number(input.stateLocalTaxDeductedFed ?? 0);
  if (salt > 0) {
    modifications.push({
      state: "NY",
      modificationType: "addition",
      description: "Code A-101: State and local income taxes deducted on federal Schedule A",
      amount: salt,
      federalLineCode: "Schedule A Line 5a",
      stateLineCode: "Form IT-225 Line 1 / Code A-101",
      statutoryReference: "N.Y. Tax Law § 612(b)(3)",
      explanation: "New York requires add-back of state and local income taxes claimed as federal itemized deductions.",
    });
  }

  // 3. New York Metropolitan Commuter Transportation Mobility Tax (MCTMT)
  // NY Tax Law Article 23 (Form IT-201-B / MTA Mobility Tax)
  // Applies to individuals with net earnings from self-employment allocated to the 12-county MCTD > $50,000.
  const seEarnings = Number(input.mctdNetSelfEmploymentEarnings ?? 0);
  const MCTD_THRESHOLD = 50000;
  if (seEarnings > MCTD_THRESHOLD) {
    // Zone 1 = NYC (0.60%); Zone 2 = Dutchess, Nassau, Orange, Putnam, Rockland, Suffolk, Westchester (0.34%)
    const zone = input.mctdZone ?? 1;
    const rate = zone === 1 ? 0.006 : 0.0034;
    const mctmtAmount = Math.round(seEarnings * rate * 100) / 100;

    specialTaxesOrFees.push({
      title: `Metropolitan Commuter Transportation Mobility Tax (MCTMT Zone ${zone} - ${(rate * 100).toFixed(2)}%)`,
      amount: mctmtAmount,
      statutoryCitation: "N.Y. Tax Law Article 23 § 801 (Form IT-201-B)",
    });
  }

  // 4. NY Pass-Through Entity Tax (PTET) Credit & Add-Back
  // NY Tax Law § 612(b)(43) & § 606(kkk) (Form IT-653)
  const nyPtet = Number(input.nyPtetTaxPaid ?? 0);
  if (nyPtet > 0) {
    modifications.push({
      state: "NY",
      modificationType: "credit",
      description: "New York Pass-Through Entity Tax (PTET) Credit",
      amount: nyPtet,
      federalLineCode: "Schedule K-1",
      stateLineCode: "Form IT-653 / Form IT-201 Line 65",
      statutoryReference: "N.Y. Tax Law § 606(kkk)",
      explanation: "Elective pass-through entity tax credit against NY individual income tax liability.",
    });

    modifications.push({
      state: "NY",
      modificationType: "addition",
      description: "Code A-219: NY PTET deducted at federal entity level add-back",
      amount: nyPtet,
      federalLineCode: "Schedule K-1 Box 1",
      stateLineCode: "Form IT-225 Line 1 / Code A-219",
      statutoryReference: "N.Y. Tax Law § 612(b)(43)",
      explanation: "Required addition modification to prevent double benefit of the entity-level deduction.",
    });
  }

  const totalAdditions = modifications
    .filter((m) => m.modificationType === "addition")
    .reduce((acc, m) => acc + m.amount, 0);

  const totalSubtractions = modifications
    .filter((m) => m.modificationType === "subtraction")
    .reduce((acc, m) => acc + m.amount, 0);

  const totalCredits = modifications
    .filter((m) => m.modificationType === "credit")
    .reduce((acc, m) => acc + m.amount, 0);

  return {
    state: "NY",
    taxYear,
    modifications,
    totalAdditions,
    totalSubtractions,
    totalCredits,
    specialTaxesOrFees,
  };
}

/**
 * Persists calculated state conformity modifications directly to PostgreSQL state_tax_modifications.
 */
export async function applyStateConformityToDatabase(
  db: Db,
  firmId: string,
  clientId: string,
  result: StateConformityResult,
): Promise<{ inserted: number }> {
  let count = 0;
  for (const mod of result.modifications) {
    await createStateMod(db, firmId, clientId, {
      state: mod.state,
      taxYear: result.taxYear,
      modificationType: mod.modificationType,
      description: `${mod.description} [${mod.statutoryReference}]`,
      amount: mod.amount,
      federalLineCode: mod.federalLineCode,
      stateLineCode: mod.stateLineCode,
    });
    count++;
  }
  return { inserted: count };
}
