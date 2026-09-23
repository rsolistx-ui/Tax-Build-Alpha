/**
 * Individual estimated-tax worksheet under IRC § 6654 (verified 2026-09-23 against
 * 26 U.S.C. § 6654 at law.cornell.edu). Every input is a figure the preparer supplies;
 * this computes the safe-harbor installments and due dates only.
 *
 *  (c)(2)  installments due April 15, June 15, September 15, January 15.
 *  (d)(1)  each installment is 25% of the required annual payment, which is the lesser of
 *          90% of current-year tax or 100% of prior-year tax (prior year must be a 12-month
 *          year with a return filed); 110% when prior-year AGI exceeded $150,000
 *          ($75,000 married filing separately).
 *  (e)(1)  no addition to tax when tax after withholding is under $1,000.
 *  (g)     withholding is treated as paid in equal parts on each due date.
 *  (h)     the January installment is not required if the return is filed and paid by January 31.
 *  (i)     farmers and fishermen: 66 2/3% instead of 90%, one installment due January 15.
 *  § 7503  a due date on a Saturday, Sunday or legal holiday moves to the next business day.
 */
export type EstimatedTaxInput = {
  taxYear: number;
  priorYearTax?: number | null;
  priorYearAgi?: number | null;
  /** The prior year was a 12-month year and a return was filed. */
  priorYearQualifies?: boolean;
  marriedFilingSeparately?: boolean;
  /** Projected total tax for the current year. */
  currentYearTax?: number | null;
  expectedWithholding?: number;
  farmerOrFisherman?: boolean;
};

export type Installment = { number: number; dueDate: string; amount: number };
export type EstimatedTaxResult = {
  requiredAnnualPayment: number | null;
  basis: string;
  installments: Installment[];
  notes: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);

function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7));
}

/** Legal holidays that can land on an estimated-tax due date. */
function holidays(year: number): Set<string> {
  const set = new Set<string>();
  set.add(iso(nthWeekday(year, 0, 1, 3))); // Martin Luther King Jr. Day, third Monday of January
  // DC Emancipation Day, April 16; observed Friday if Saturday, Monday if Sunday.
  const emancipation = new Date(Date.UTC(year, 3, 16));
  const dow = emancipation.getUTCDay();
  set.add(iso(dow === 6 ? new Date(Date.UTC(year, 3, 15)) : dow === 0 ? new Date(Date.UTC(year, 3, 17)) : emancipation));
  return set;
}

export function nextBusinessDay(date: Date): string {
  const d = new Date(date);
  for (;;) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays(d.getUTCFullYear()).has(iso(d))) return iso(d);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

export function installmentDueDates(taxYear: number): string[] {
  return [
    new Date(Date.UTC(taxYear, 3, 15)),
    new Date(Date.UTC(taxYear, 5, 15)),
    new Date(Date.UTC(taxYear, 8, 15)),
    new Date(Date.UTC(taxYear + 1, 0, 15)),
  ].map(nextBusinessDay);
}

export function computeEstimatedTax(input: EstimatedTaxInput): EstimatedTaxResult {
  const notes: string[] = [];
  const withholding = Math.max(0, input.expectedWithholding ?? 0);
  const currentPct = input.farmerOrFisherman ? 2 / 3 : 0.9;
  const threshold = input.marriedFilingSeparately ? 75000 : 150000;
  const priorPct = (input.priorYearAgi ?? 0) > threshold ? 1.1 : 1.0;

  const options: Array<{ amount: number; basis: string }> = [];
  if (input.currentYearTax != null) {
    options.push({
      amount: input.currentYearTax * currentPct,
      basis: input.farmerOrFisherman ? "66 2/3% of current-year tax (§ 6654(i))" : "90% of current-year tax (§ 6654(d)(1)(B)(i))",
    });
  }
  if (input.priorYearTax != null && input.priorYearQualifies !== false && !input.farmerOrFisherman) {
    options.push({
      amount: input.priorYearTax * priorPct,
      basis: priorPct === 1.1 ? "110% of prior-year tax (§ 6654(d)(1)(C))" : "100% of prior-year tax (§ 6654(d)(1)(B)(ii))",
    });
  } else if (input.priorYearTax != null && input.priorYearQualifies === false) {
    notes.push("Prior-year safe harbor unavailable: the prior year was not a 12-month year with a return filed.");
  }
  if (!options.length) {
    return { requiredAnnualPayment: null, basis: "Enter prior-year tax or projected current-year tax.", installments: [], notes };
  }

  const best = options.reduce((a, b) => (b.amount < a.amount ? b : a));
  const required = round2(best.amount);
  const dates = installmentDueDates(input.taxYear);

  if (input.currentYearTax != null && input.currentYearTax - withholding < 1000) {
    notes.push("Tax after withholding is under $1,000, so no underpayment addition applies (§ 6654(e)(1)).");
  }

  let installments: Installment[];
  if (input.farmerOrFisherman) {
    installments = [{ number: 1, dueDate: dates[3], amount: round2(Math.max(0, required - withholding)) }];
    notes.push("Farmers and fishermen make one installment, due January 15 (§ 6654(i)).");
  } else {
    // § 6654(g): withholding counts as paid in equal parts on each due date.
    installments = dates.map((dueDate, i) => ({ number: i + 1, dueDate, amount: round2(Math.max(0, required / 4 - withholding / 4)) }));
    notes.push("The January installment is not needed if the return is filed and the balance paid by January 31 (§ 6654(h)).");
  }
  if (priorPct === 1.1 && input.priorYearTax != null) notes.push(`Prior-year AGI exceeded $${threshold.toLocaleString()}, so the prior-year safe harbor is 110%.`);

  return { requiredAnnualPayment: required, basis: best.basis, installments, notes };
}
