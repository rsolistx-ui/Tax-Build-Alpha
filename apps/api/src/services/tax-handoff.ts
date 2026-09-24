import type { Db } from "../db";
import { newId } from "../lib/id";
import type { PnlReport } from "./reporting";

/**
 * Tax software handoff: the client's books for one tax year, totalled by
 * Schedule C line, for the preparer to key into the tax software they file
 * with. Truepost does not compute or file the return. Every category is either
 * assigned a line (by the preparer, or suggested from its name) or listed as
 * needing one; nothing is silently dropped into "Other expenses".
 */

export type ScheduleCLine = { code: string; line: string; label: string; kind: "income" | "cogs" | "expense" };

// Lines a category can land on. Totals (3, 5, 7, 28, 29, 31) are computed, and
// 12, 13, 30 and 27a come from depletion, depreciation, home-office and Form 7205
// worksheets, not the books, so none of those are assignable.
export const SCHEDULE_C_LINES: ScheduleCLine[] = [
  { code: "SchC_1", line: "1", label: "Gross receipts or sales", kind: "income" },
  { code: "SchC_2", line: "2", label: "Returns and allowances", kind: "income" },
  { code: "SchC_6", line: "6", label: "Other income", kind: "income" },
  { code: "SchC_4", line: "4", label: "Cost of goods sold", kind: "cogs" },
  { code: "SchC_8", line: "8", label: "Advertising", kind: "expense" },
  { code: "SchC_9", line: "9", label: "Car and truck expenses", kind: "expense" },
  { code: "SchC_10", line: "10", label: "Commissions and fees", kind: "expense" },
  { code: "SchC_11", line: "11", label: "Contract labor", kind: "expense" },
  { code: "SchC_14", line: "14", label: "Employee benefit programs", kind: "expense" },
  { code: "SchC_15", line: "15", label: "Insurance (other than health)", kind: "expense" },
  { code: "SchC_16a", line: "16a", label: "Interest: mortgage", kind: "expense" },
  { code: "SchC_16b", line: "16b", label: "Interest: other", kind: "expense" },
  { code: "SchC_17", line: "17", label: "Legal and professional services", kind: "expense" },
  { code: "SchC_18", line: "18", label: "Office expense", kind: "expense" },
  { code: "SchC_19", line: "19", label: "Pension and profit-sharing plans", kind: "expense" },
  { code: "SchC_20a", line: "20a", label: "Rent or lease: vehicles, machinery, equipment", kind: "expense" },
  { code: "SchC_20b", line: "20b", label: "Rent or lease: other business property", kind: "expense" },
  { code: "SchC_21", line: "21", label: "Repairs and maintenance", kind: "expense" },
  { code: "SchC_22", line: "22", label: "Supplies", kind: "expense" },
  { code: "SchC_23", line: "23", label: "Taxes and licenses", kind: "expense" },
  { code: "SchC_24a", line: "24a", label: "Travel", kind: "expense" },
  { code: "SchC_24b", line: "24b", label: "Deductible meals", kind: "expense" },
  { code: "SchC_25", line: "25", label: "Utilities", kind: "expense" },
  { code: "SchC_26", line: "26", label: "Wages", kind: "expense" },
  { code: "SchC_27b", line: "27b", label: "Other expenses (itemize on Part V, line 48)", kind: "expense" },
];

const LINE_BY_CODE = new Map(SCHEDULE_C_LINES.map((l) => [l.code, l]));

export function isAssignableLine(code: string, side: "income" | "expense"): boolean {
  const line = LINE_BY_CODE.get(code);
  if (!line) return false;
  return side === "income" ? line.kind === "income" : line.kind !== "income";
}

// Ordered: the first match wins, so the more specific patterns come first.
// An empty code means "recognized, but not a Schedule C line" (e.g. health insurance).
const EXPENSE_SUGGESTIONS: Array<[RegExp, string]> = [
  [/\b(meals?|food|restaurants?|dining)\b/i, "SchC_24b"],
  [/\b(travel|hotels?|lodging|airfare|flights?)\b/i, "SchC_24a"],
  [/\b(utilit(y|ies)|electric(ity)?|water|internet|phone|telephone|cell(ular)?)\b/i, "SchC_25"],
  [/\b(equipment|machinery|vehicle) (rent|rental|lease)\b/i, "SchC_20a"],
  [/\b(rent|rental|lease)\b/i, "SchC_20b"],
  [/\b(car|truck|auto|vehicle|fuel|gas|gasoline|mileage|parking|tolls?)\b/i, "SchC_9"],
  [/\b(advertising|marketing|promotion)\b/i, "SchC_8"],
  [/\b(commissions?|merchant fees?|processing fees?)\b/i, "SchC_10"],
  [/\b(contract labor|contractors?|subcontractors?|freelancers?)\b/i, "SchC_11"],
  [/\bhealth insurance\b/i, ""],
  [/\binsurance\b/i, "SchC_15"],
  [/\bmortgage interest\b/i, "SchC_16a"],
  [/\binterest\b/i, "SchC_16b"],
  [/\b(legal|attorneys?|accounting|bookkeeping|professional (fees|services))\b/i, "SchC_17"],
  [/\b(office|software|subscriptions?|postage)\b/i, "SchC_18"],
  [/\b(repairs?|maintenance)\b/i, "SchC_21"],
  [/\b(supplies|supply)\b/i, "SchC_22"],
  [/\b(taxes|tax|licenses?|permits?)\b/i, "SchC_23"],
  [/\b(wages|payroll|salar(y|ies))\b/i, "SchC_26"],
  [/\b(cost of goods|cogs|inventory)\b/i, "SchC_4"],
];

/** A suggested Schedule C line from a category's name, or null when the name gives no safe answer. */
export function suggestScheduleCLine(categoryName: string, side: "income" | "expense"): string | null {
  if (side === "income") return "SchC_1";
  for (const [pattern, code] of EXPENSE_SUGGESTIONS) {
    if (pattern.test(categoryName)) return code || null;
  }
  return null;
}

export type HandoffCategory = {
  categoryId: string | null;
  category: string;
  side: "income" | "expense";
  total: number;
  lineCode: string | null;
  source: "preparer" | "suggested" | "none";
};

export type HandoffLine = ScheduleCLine & { amount: number; categories: string[]; note: string | null };

export type TaxHandoff = {
  taxYear: number;
  form: "Schedule C";
  periodStart: string;
  periodEnd: string;
  currency: string;
  accountingBasis: string;
  booksComplete: boolean;
  completeness: PnlReport["completeness"];
  lines: HandoffLine[];
  totals: { grossIncome: number; totalExpenses: number; tentativeProfit: number };
  categories: HandoffCategory[];
  needsLine: HandoffCategory[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const LINE_NOTES: Record<string, string> = {
  SchC_24b: "Book amount. Enter only the deductible portion (generally 50%).",
  SchC_4: "Complete Part III (cost of goods sold) in the tax software.",
  SchC_27b: "Itemize each category on Part V, line 48.",
  SchC_9: "Actual expenses. If the client takes the standard mileage rate, use the mileage log instead.",
};

/** Pure: lays an already-computed P&L out by Schedule C line. Never recomputes a book total. */
export function buildTaxHandoff(input: {
  taxYear: number;
  report: PnlReport;
  assigned: Map<string, string>;
}): TaxHandoff {
  const { taxYear, report, assigned } = input;
  const categories: HandoffCategory[] = [];
  const place = (row: { categoryId: string | null; category: string; total: number }, side: "income" | "expense") => {
    const chosen = row.categoryId ? assigned.get(row.categoryId) : undefined;
    const validChosen = chosen && isAssignableLine(chosen, side) ? chosen : null;
    const suggested = row.categoryId ? suggestScheduleCLine(row.category, side) : null;
    const lineCode = validChosen ?? suggested;
    categories.push({
      categoryId: row.categoryId,
      category: row.category,
      side,
      total: round2(Number(row.total)),
      lineCode,
      source: validChosen ? "preparer" : suggested ? "suggested" : "none",
    });
  };
  for (const row of report.categorizedIncome) place(row, "income");
  for (const row of report.categorizedExpenses) place(row, "expense");

  const lines: HandoffLine[] = SCHEDULE_C_LINES.map((l) => {
    const onLine = categories.filter((c) => c.lineCode === l.code);
    return {
      ...l,
      amount: round2(onLine.reduce((sum, c) => sum + c.total, 0)),
      categories: onLine.map((c) => c.category),
      note: LINE_NOTES[l.code] ?? null,
    };
  });
  const amountOf = (code: string) => lines.find((l) => l.code === code)?.amount ?? 0;
  // Line 7 = line 1 - line 2 - line 4 + line 6 (lines 3 and 5 are subtotals).
  const grossIncome = round2(amountOf("SchC_1") - amountOf("SchC_2") - amountOf("SchC_4") + amountOf("SchC_6"));
  const totalExpenses = round2(lines.filter((l) => l.kind === "expense").reduce((sum, l) => sum + l.amount, 0));

  return {
    taxYear,
    form: "Schedule C",
    periodStart: `${taxYear}-01-01`,
    periodEnd: `${taxYear}-12-31`,
    currency: report.currency,
    accountingBasis: report.accountingBasis,
    booksComplete: report.completeness.isComplete,
    completeness: report.completeness,
    lines,
    totals: { grossIncome, totalExpenses, tentativeProfit: round2(grossIncome - totalExpenses) },
    categories,
    needsLine: categories.filter((c) => c.lineCode === null),
  };
}

export async function getAssignedLines(db: Db, firmId: string, clientId: string, taxYear: number): Promise<Map<string, string>> {
  const rows = await db.query<{ category_id: string; form_line_code: string }>(
    `SELECT category_id, form_line_code FROM category_tax_lines WHERE firm_id = $1 AND client_id = $2 AND tax_year = $3`,
    [firmId, clientId, taxYear],
  );
  return new Map(rows.map((r) => [r.category_id, r.form_line_code]));
}

/** Records the preparer's line for one category, or clears it (back to the suggestion) when lineCode is null. */
export async function setCategoryLine(
  db: Db,
  input: { firmId: string; clientId: string; categoryId: string; taxYear: number; lineCode: string | null; userId: string },
): Promise<void> {
  if (input.lineCode === null) {
    await db.query(
      `DELETE FROM category_tax_lines WHERE firm_id = $1 AND client_id = $2 AND category_id = $3 AND tax_year = $4`,
      [input.firmId, input.clientId, input.categoryId, input.taxYear],
    );
    return;
  }
  await db.query(
    `INSERT INTO category_tax_lines (id, firm_id, client_id, category_id, tax_year, form_line_code, set_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (client_id, category_id, tax_year)
     DO UPDATE SET form_line_code = EXCLUDED.form_line_code, set_by_user_id = EXCLUDED.set_by_user_id, updated_at = NOW()`,
    [newId("ctl"), input.firmId, input.clientId, input.categoryId, input.taxYear, input.lineCode, input.userId],
  );
}
