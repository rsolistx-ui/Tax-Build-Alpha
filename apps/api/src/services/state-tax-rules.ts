import type { Db } from "../db";
import { newId } from "../lib/id";
import { createStateMod, listStateMods } from "./tax-state-mods";

/*
 * Sources verified 2026-09-22 (see docs/LEGAL_COMPLIANCE_REVIEW.md):
 *  CA: R&TC §§ 17250(a)(4), 17255, 17215.4, 17941, 17942, 17052.10, 17052.11 (SB 132, 2025).
 *  NY: Form IT-225-I (2025) codes A-201, A-209, S-213, A-219; Tax Law §§ 612(b)(3), 612(b)(8),
 *      612(b)(43), 612(c)(16), 606(kkk), 801(a); Part Q ch. 58 L. 2023; Part VV ch. 59 L. 2025.
 * These are preparer worksheets: every amount is an input the preparer supplies and reviews.
 */

export interface CaliforniaConformityInput {
  federalBonusDepreciation?: number;
  californiaAllowableDepreciation?: number;
  federalSection179Deduction?: number;
  /** Total cost of section 179 property placed in service this year; drives the $200,000 phase-out. */
  section179PropertyCost?: number;
  hsaContributionsDeducted?: number;
  hsaEarningsTaxable?: number;
  isCaliforniaLlc?: boolean;
  /** Total income under R&TC § 17942(b): gross income plus cost of goods sold. */
  californiaGrossReceipts?: number;
  californiaPteTaxPaid?: number;
  /** 2026+ only: false when the entity missed the June 15 prepayment (credit reduced 12.5%). */
  californiaPteJunePaymentMade?: boolean;
}

export interface NewYorkConformityInput {
  federalBonusDepreciation?: number;
  newYorkAllowableDepreciation?: number;
  /** Income taxes deducted in computing federal AGI (e.g. NYC UBT deducted on Schedule C). Not Schedule A. */
  stateLocalTaxDeductedFed?: number;
  mctdNetSelfEmploymentEarnings?: number;
  mctdZone?: 1 | 2; // Zone 1 = NYC counties; Zone 2 = Dutchess, Nassau, Orange, Putnam, Rockland, Suffolk, Westchester
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
  /** Items the preparer must check or that the engine deliberately did not compute. */
  notes: string[];
}

function totals(modifications: ComputedStateMod[]) {
  const sum = (type: ComputedStateMod["modificationType"]) =>
    modifications.filter((m) => m.modificationType === type).reduce((acc, m) => acc + m.amount, 0);
  return { totalAdditions: sum("addition"), totalSubtractions: sum("subtraction"), totalCredits: sum("credit") };
}

/** R&TC § 17255: $25,000 limit, reduced dollar-for-dollar by cost of section 179 property over $200,000. */
export function californiaSection179Limit(section179PropertyCost: number): number {
  return Math.max(0, 25000 - Math.max(0, section179PropertyCost - 200000));
}

/**
 * California Form 540 & Schedule CA (540) worksheet for common R&TC non-conformity items.
 */
export function computeCaliforniaConformity(
  taxYear: number,
  input: CaliforniaConformityInput,
): StateConformityResult {
  const modifications: ComputedStateMod[] = [];
  const specialTaxesOrFees: StateConformityResult["specialTaxesOrFees"] = [];
  const notes: string[] = [];

  // 1. Bonus depreciation: R&TC § 17250(a)(4) — IRC § 168(k) shall not apply.
  const fedBonus = Number(input.federalBonusDepreciation ?? 0);
  const caDepr = Number(input.californiaAllowableDepreciation ?? 0);
  if (fedBonus > 0) {
    modifications.push({
      state: "CA",
      modificationType: "addition",
      description: "Federal bonus depreciation add-back (IRC § 168(k) non-conformity)",
      amount: fedBonus,
      federalLineCode: "Form 4562",
      stateLineCode: "Schedule CA (540) / FTB 3885A",
      statutoryReference: "Cal. Rev. & Tax Code § 17250(a)(4)",
      explanation: "California does not allow federal bonus depreciation. The federal bonus deduction is added back.",
    });

    if (caDepr > 0) {
      modifications.push({
        state: "CA",
        modificationType: "subtraction",
        description: "California allowable depreciation on the same property",
        amount: caDepr,
        federalLineCode: "Form 4562",
        stateLineCode: "Schedule CA (540) / FTB 3885A",
        statutoryReference: "Cal. Rev. & Tax Code § 17250",
        explanation: "Depreciation California allows in place of the disallowed federal bonus depreciation, as computed on FTB 3885A.",
      });
    }
  }

  // 2. Section 179: R&TC § 17255 — $25,000 limit with $200,000 phase-out.
  const fed179 = Number(input.federalSection179Deduction ?? 0);
  if (fed179 > 0) {
    const cost = input.section179PropertyCost;
    const limit = cost === undefined ? 25000 : californiaSection179Limit(Number(cost));
    if (cost === undefined) {
      notes.push("Section 179: enter the total cost of section 179 property placed in service. California reduces the $25,000 limit dollar-for-dollar above $200,000 (R&TC § 17255); the phase-out was not applied.");
    }
    if (fed179 > limit) {
      const disallowed179 = fed179 - limit;
      modifications.push({
        state: "CA",
        modificationType: "addition",
        description: `Section 179 expense over the California limit of $${limit.toLocaleString()}`,
        amount: disallowed179,
        federalLineCode: "Form 4562 Line 12",
        stateLineCode: "Schedule CA (540) / FTB 3885A",
        statutoryReference: "Cal. Rev. & Tax Code § 17255",
        explanation: `Federal section 179 of $${fed179.toLocaleString()} exceeds the California limit of $${limit.toLocaleString()} by $${disallowed179.toLocaleString()}. The disallowed amount remains depreciable basis for California.`,
      });
      notes.push("Section 179: the disallowed amount stays in California basis. Compute California depreciation on it (FTB 3885A) and enter it as a subtraction.");
    }
  }

  // 3. HSA: R&TC § 17215.4 — IRC § 223 shall not apply.
  const hsaDed = Number(input.hsaContributionsDeducted ?? 0);
  if (hsaDed > 0) {
    modifications.push({
      state: "CA",
      modificationType: "addition",
      description: "HSA deduction add-back (California does not apply IRC § 223)",
      amount: hsaDed,
      federalLineCode: "Form 1040 Schedule 1",
      stateLineCode: "Schedule CA (540)",
      statutoryReference: "Cal. Rev. & Tax Code § 17215.4",
      explanation: "California does not conform to the federal HSA deduction; the federal deduction is added back.",
    });
  }

  const hsaEarn = Number(input.hsaEarningsTaxable ?? 0);
  if (hsaEarn > 0) {
    modifications.push({
      state: "CA",
      modificationType: "addition",
      description: "HSA interest and investment earnings taxable in California",
      amount: hsaEarn,
      federalLineCode: "Excluded federally",
      stateLineCode: "Schedule CA (540)",
      statutoryReference: "Cal. Rev. & Tax Code § 17215.4",
      explanation: "Because IRC § 223 does not apply in California, HSA earnings are California taxable income.",
    });
  }

  // 4. LLC: $800 annual tax (R&TC § 17941) and fee on total income (R&TC § 17942).
  if (input.isCaliforniaLlc) {
    const totalIncome = Number(input.californiaGrossReceipts ?? 0);
    let llcFee = 0;
    if (totalIncome >= 5000000) llcFee = 11790;
    else if (totalIncome >= 1000000) llcFee = 6000;
    else if (totalIncome >= 500000) llcFee = 2500;
    else if (totalIncome >= 250000) llcFee = 900;

    specialTaxesOrFees.push({
      title: "California LLC annual tax",
      amount: 800,
      statutoryCitation: "Cal. Rev. & Tax Code § 17941 (Form 568)",
    });
    if (llcFee > 0) {
      specialTaxesOrFees.push({
        title: `California LLC fee (total income $${totalIncome.toLocaleString()})`,
        amount: llcFee,
        statutoryCitation: "Cal. Rev. & Tax Code § 17942 (Form 568)",
      });
    }
  }

  // 5. PTE elective tax credit: § 17052.10 (2021-2025), § 17052.11 (2026-2030, SB 132).
  const pteTax = Number(input.californiaPteTaxPaid ?? 0);
  if (pteTax > 0) {
    if (taxYear >= 2021 && taxYear <= 2025) {
      modifications.push({
        state: "CA",
        modificationType: "credit",
        description: "California pass-through entity elective tax credit",
        amount: pteTax,
        stateLineCode: "FTB 3804-CR",
        statutoryReference: "Cal. Rev. & Tax Code § 17052.10",
        explanation: "Credit equal to the owner's share of elective tax paid by the entity. The entity, not the owner, adds back any federal deduction for the tax in computing its California income.",
      });
    } else if (taxYear >= 2026 && taxYear <= 2030) {
      const reduced = input.californiaPteJunePaymentMade === false;
      const credit = reduced ? Math.round(pteTax * 0.875 * 100) / 100 : pteTax;
      modifications.push({
        state: "CA",
        modificationType: "credit",
        description: `California pass-through entity elective tax credit${reduced ? " (reduced 12.5% for missed June 15 payment)" : ""}`,
        amount: credit,
        stateLineCode: "FTB 3804-CR",
        statutoryReference: "Cal. Rev. & Tax Code § 17052.11",
        explanation: "Credit for the owner's share of elective tax paid by the entity. The entity adds back any federal deduction for the tax in computing its California income.",
      });
      if (input.californiaPteJunePaymentMade === undefined) {
        notes.push("PTE credit (2026 and later): confirm whether the entity made the June 15 prepayment. If not, the credit is reduced by 12.5%.");
      }
      notes.push("PTE credit (2026 and later): the 12.5% reduction rule was taken from practitioner summaries of SB 132; confirm against R&TC § 17052.11 before filing.");
    } else {
      notes.push(`PTE credit: California's elective tax credit covers taxable years 2021 through 2030; no credit was computed for ${taxYear}.`);
    }
  }

  return { state: "CA", taxYear, modifications, ...totals(modifications), specialTaxesOrFees, notes };
}

/** NY MCTMT rate and threshold on self-employment earnings (Tax Law § 801(a) as amended 2023 and 2025). */
export function newYorkMctmt(taxYear: number, zone: 1 | 2): { rate: number; threshold: number } {
  if (taxYear < 2023) return { rate: 0.0034, threshold: 50000 };
  if (taxYear === 2023) return { rate: zone === 1 ? 0.0047 : 0.0034, threshold: 50000 };
  if (taxYear <= 2025) return { rate: zone === 1 ? 0.006 : 0.0034, threshold: 50000 };
  return { rate: zone === 1 ? 0.006 : 0.0034, threshold: 150000 };
}

/**
 * New York Form IT-201/IT-203 and IT-225 worksheet for common modifications.
 */
export function computeNewYorkConformity(
  taxYear: number,
  input: NewYorkConformityInput,
): StateConformityResult {
  const modifications: ComputedStateMod[] = [];
  const specialTaxesOrFees: StateConformityResult["specialTaxesOrFees"] = [];
  const notes: string[] = [];

  // 1. IRC § 168(k) depreciation: IT-225 A-209 / S-213 via Form IT-398.
  const fedBonus = Number(input.federalBonusDepreciation ?? 0);
  const nyDepr = Number(input.newYorkAllowableDepreciation ?? 0);
  if (fedBonus > 0) {
    modifications.push({
      state: "NY",
      modificationType: "addition",
      description: "A-209: IRC § 168(k) property depreciation add-back",
      amount: fedBonus,
      federalLineCode: "Form 4562",
      stateLineCode: "Form IT-225 A-209 (from Form IT-398 Part 1)",
      statutoryReference: "N.Y. Tax Law § 612(b)(8)",
      explanation: "New York does not follow federal depreciation for IRC § 168(k) property placed in service on or after June 1, 2003, except resurgence zone and New York Liberty Zone property.",
    });

    if (nyDepr > 0) {
      modifications.push({
        state: "NY",
        modificationType: "subtraction",
        description: "S-213: New York depreciation on IRC § 168(k) property",
        amount: nyDepr,
        federalLineCode: "Form 4562",
        stateLineCode: "Form IT-225 S-213 (from Form IT-398)",
        statutoryReference: "N.Y. Tax Law § 612(c)(16)",
        explanation: "Depreciation New York allows on the same property, computed on Form IT-398.",
      });
    }
    notes.push("A-209/S-213: attach Form IT-398. Resurgence zone and New York Liberty Zone property are excepted.");
  }

  // 2. A-201: income taxes deducted in computing federal AGI (Tax Law § 612(b)(3)).
  const incomeTaxesDeducted = Number(input.stateLocalTaxDeductedFed ?? 0);
  if (incomeTaxesDeducted > 0) {
    modifications.push({
      state: "NY",
      modificationType: "addition",
      description: "A-201: income taxes deducted in computing federal adjusted gross income",
      amount: incomeTaxesDeducted,
      federalLineCode: "Schedule C, E or F",
      stateLineCode: "Form IT-225 A-201",
      statutoryReference: "N.Y. Tax Law § 612(b)(3)",
      explanation: "State, local or foreign income taxes (including NYC unincorporated business tax) deducted as a business expense are added back. Income taxes claimed as a federal itemized deduction are not entered here; New York handles them on Form IT-196.",
    });
  }

  // 3. MCTMT on self-employment earnings (Tax Law § 801(a)).
  const seEarnings = Number(input.mctdNetSelfEmploymentEarnings ?? 0);
  if (seEarnings > 0) {
    const zone = input.mctdZone ?? 1;
    const { rate, threshold } = newYorkMctmt(taxYear, zone);
    if (seEarnings > threshold) {
      const amount = Math.round(seEarnings * rate * 100) / 100;
      specialTaxesOrFees.push({
        title: taxYear < 2023
          ? `MCTMT on self-employment earnings (${(rate * 100).toFixed(2)}%)`
          : `MCTMT on self-employment earnings, Zone ${zone} (${(rate * 100).toFixed(2)}%)`,
        amount,
        statutoryCitation: "N.Y. Tax Law § 801(a)",
      });
    }
    if (taxYear >= 2023) notes.push(`MCTMT: the $${threshold.toLocaleString()} threshold applies separately to each zone, even on a joint return. Enter each zone's earnings separately.`);
  }

  // 4. PTET: credit § 606(kkk) (Form IT-653) and add-back A-219 (§ 612(b)(43)).
  const nyPtet = Number(input.nyPtetTaxPaid ?? 0);
  if (nyPtet > 0) {
    modifications.push({
      state: "NY",
      modificationType: "credit",
      description: "New York pass-through entity tax (PTET) credit",
      amount: nyPtet,
      federalLineCode: "Schedule K-1",
      stateLineCode: "Form IT-653",
      statutoryReference: "N.Y. Tax Law § 606(kkk)",
      explanation: "Credit for the owner's direct share of PTET reported by the electing entity. Any excess over tax due is refundable.",
    });

    modifications.push({
      state: "NY",
      modificationType: "addition",
      description: "A-219: PTET deduction add-back",
      amount: nyPtet,
      federalLineCode: "Schedule K-1",
      stateLineCode: "Form IT-225 A-219 (equals Form IT-653 line 1)",
      statutoryReference: "N.Y. Tax Law § 612(b)(43)",
      explanation: "The PTET credit claimed on Form IT-653 is added back.",
    });
  }

  return { state: "NY", taxYear, modifications, ...totals(modifications), specialTaxesOrFees, notes };
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
