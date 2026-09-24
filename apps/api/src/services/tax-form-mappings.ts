import type { Db } from "../db";
import { newId } from "../lib/id";

export interface TaxFormMapping {
  id: string;
  firm_id: string;
  client_id: string;
  tax_form: string;
  tax_year: number;
  form_line_code: string;
  form_line_label: string;
  account_id: string | null;
  mapping_type: "direct" | "aggregation" | "calculation" | "manual_entry";
  calculation_formula: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function createTaxFormMapping(
  db: Db,
  firmId: string,
  clientId: string,
  input: {
    taxForm: string;
    taxYear: number;
    formLineCode: string;
    formLineLabel: string;
    accountId?: string;
    mappingType: "direct" | "aggregation" | "calculation" | "manual_entry";
    calculationFormula?: string;
    sortOrder?: number;
    isActive?: boolean;
  }
) {
  const id = newId("tfm");
  const now = new Date().toISOString();

  await db.query(
    `INSERT INTO tax_form_mappings
      (id, firm_id, client_id, tax_form, tax_year, form_line_code, form_line_label,
       account_id, mapping_type, calculation_formula, sort_order, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [id, firmId, clientId, input.taxForm, input.taxYear, input.formLineCode,
     input.formLineLabel, input.accountId ?? null, input.mappingType,
     input.calculationFormula ?? null, input.sortOrder ?? 0,
     input.isActive ?? true, now, now],
  );

  const [row] = await db.query<any>(
    `SELECT * FROM tax_form_mappings WHERE id = $1`,
    [id],
  );
  return mapTaxFormMapping(row);
}

export async function getTaxFormMappings(db: Db, firmId: string, clientId: string): Promise<TaxFormMapping[]> {
  const rows = await db.query<any>(
    `SELECT * FROM tax_form_mappings
     WHERE firm_id = $1 AND client_id = $2 AND is_active = TRUE
     ORDER BY tax_form, tax_year, sort_order, form_line_code`,
    [firmId, clientId],
  );
  return rows.map(mapTaxFormMapping);
}

export async function getTaxFormMapping(db: Db, firmId: string, mappingId: string) {
  const [row] = await db.query<any>(
    `SELECT * FROM tax_form_mappings WHERE id = $1 AND firm_id = $2`,
    [mappingId, firmId],
  );
  return row ? mapTaxFormMapping(row) : undefined;
}

export async function updateTaxFormMapping(
  db: Db,
  firmId: string,
  mappingId: string,
  patch: {
    accountId?: string;
    mappingType?: "direct" | "aggregation" | "calculation" | "manual_entry";
    calculationFormula?: string;
    sortOrder?: number;
    isActive?: boolean;
  }
) {
  const sets: string[] = [];
  const params: any[] = [mappingId, firmId];
  let idx = 3;

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      sets.push(`${col} = $${idx++}`);
      params.push(value);
    }
  }
  if (sets.length === 0) {
    const m = await getTaxFormMapping(db, firmId, mappingId);
    if (!m) throw new Error("Mapping not found");
    return m;
  }
  sets.push(`updated_at = NOW()`);
  await db.query(`UPDATE tax_form_mappings SET ${sets.join(', ')} WHERE id = $1 AND firm_id = $2`, params);
  const [row] = await db.query<any>(`SELECT * FROM tax_form_mappings WHERE id = $1`, [mappingId]);
  return mapTaxFormMapping(row);
}

export async function deleteTaxFormMapping(db: Db, firmId: string, mappingId: string): Promise<void> {
  await db.query(`DELETE FROM tax_form_mappings WHERE id = $1 AND firm_id = $2`, [mappingId, firmId]);
}

export type SeedableTaxForm = "1040" | "SchC" | "1120" | "1120S" | "1065" | "state_CA" | "state_NY";

/**
 * Best-effort default form for a client's free-text entity type. Only a
 * suggestion: the professional picks the form before anything is seeded.
 */
export function suggestTaxFormForEntity(entityType: string | null | undefined): SeedableTaxForm {
  const e = (entityType ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (e.includes("s_corp") || e === "scorp" || e.includes("1120s")) return "1120S";
  if (e.includes("c_corp") || e === "ccorp" || e === "corporation" || e.includes("1120")) return "1120";
  if (e.includes("partnership") || e.includes("1065")) return "1065";
  if (e.includes("sole") || e.includes("llc") || e.includes("schedule_c") || e === "schc") return "SchC";
  return "1040";
}

export async function seedDefaultTaxFormMappings(
  db: Db,
  firmId: string,
  clientId: string,
  taxForm: SeedableTaxForm,
  taxYear: number
): Promise<number> {
  const templates = getDefaultTaxFormTemplates(taxForm, taxYear);
  if (templates.length === 0) return 0;

  // One statement: each db.query is a Neon HTTP subrequest, and the Workers
  // free plan allows 50 per request. The old per-line check/insert/re-read
  // loop made ~90 for Schedule C and failed. Existing lines are skipped by
  // the per-client unique index (idx_tax_mapping_unique).
  const params: unknown[] = [firmId, clientId, taxForm, taxYear];
  const values = templates.map((entry) => {
    params.push(newId("tfm"), entry.formLineCode, entry.formLineLabel, entry.sortOrder);
    const n = params.length;
    return `($${n - 3}, $1, $2, $3, $4, $${n - 2}, $${n - 1}, 'direct', $${n}, TRUE, NOW(), NOW())`;
  });
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO tax_form_mappings
      (id, firm_id, client_id, tax_form, tax_year, form_line_code, form_line_label, mapping_type, sort_order, is_active, created_at, updated_at)
     VALUES ${values.join(", ")}
     ON CONFLICT (firm_id, client_id, tax_form, tax_year, form_line_code) WHERE client_id IS NOT NULL DO NOTHING
     RETURNING id`,
    params,
  );
  const seeded = inserted.length;
  return seeded;
}

function getDefaultTaxFormTemplates(taxForm: string, taxYear: number): Array<{
  formLineCode: string;
  formLineLabel: string;
  sortOrder: number;
}> {
  const templates: Record<string, Array<{ formLineCode: string; formLineLabel: string; sortOrder: number }>> = {
    "1040": [
      { formLineCode: "1040_1", formLineLabel: "Wages, salaries, tips", sortOrder: 1 },
      { formLineCode: "1040_2", formLineLabel: "Tax-exempt interest", sortOrder: 2 },
      { formLineCode: "1040_3", formLineLabel: "Qualified dividends", sortOrder: 3 },
      { formLineCode: "1040_4", formLineLabel: "IRA distributions", sortOrder: 4 },
      { formLineCode: "1040_5", formLineLabel: "Pensions and annuities", sortOrder: 5 },
      { formLineCode: "1040_6", formLineLabel: "Social security benefits", sortOrder: 6 },
      { formLineCode: "1040_7", formLineLabel: "Capital gain or (loss)", sortOrder: 7 },
      { formLineCode: "1040_8", formLineLabel: "Other income", sortOrder: 8 },
      { formLineCode: "1040_9", formLineLabel: "Total income", sortOrder: 9 },
      { formLineCode: "1040_11", formLineLabel: "Adjusted gross income", sortOrder: 11 },
      { formLineCode: "1040_12", formLineLabel: "Standard deduction", sortOrder: 12 },
      { formLineCode: "1040_13", formLineLabel: "Qualified business income deduction", sortOrder: 13 },
      { formLineCode: "1040_14", formLineLabel: "Taxable income", sortOrder: 14 },
      { formLineCode: "1040_16", formLineLabel: "Tax", sortOrder: 16 },
      { formLineCode: "1040_19", formLineLabel: "Total tax", sortOrder: 19 },
      { formLineCode: "1040_24", formLineLabel: "Total payments", sortOrder: 24 },
      { formLineCode: "1040_25", formLineLabel: "Refund", sortOrder: 25 },
      { formLineCode: "1040_26", formLineLabel: "Amount you owe", sortOrder: 26 },
    ],
    "1120": [
      { formLineCode: "1120_1", formLineLabel: "Gross receipts or sales", sortOrder: 1 },
      { formLineCode: "1120_2", formLineLabel: "Returns and allowances", sortOrder: 2 },
      { formLineCode: "1120_3", formLineLabel: "Cost of goods sold", sortOrder: 3 },
      { formLineCode: "1120_4", formLineLabel: "Gross profit", sortOrder: 4 },
      { formLineCode: "1120_5", formLineLabel: "Dividends", sortOrder: 5 },
      { formLineCode: "1120_6", formLineLabel: "Interest", sortOrder: 6 },
      { formLineCode: "1120_7", formLineLabel: "Gross rents", sortOrder: 7 },
      { formLineCode: "1120_8", formLineLabel: "Gross royalties", sortOrder: 8 },
      { formLineCode: "1120_9", formLineLabel: "Capital gain net income", sortOrder: 9 },
      { formLineCode: "1120_10", formLineLabel: "Net gain (loss) from Form 4797", sortOrder: 10 },
      { formLineCode: "1120_11", formLineLabel: "Other income", sortOrder: 11 },
      { formLineCode: "1120_12", formLineLabel: "Total income", sortOrder: 12 },
      { formLineCode: "1120_13", formLineLabel: "Compensation of officers", sortOrder: 13 },
      { formLineCode: "1120_14", formLineLabel: "Salaries and wages", sortOrder: 14 },
      { formLineCode: "1120_15", formLineLabel: "Repairs and maintenance", sortOrder: 15 },
      { formLineCode: "1120_16", formLineLabel: "Bad debts", sortOrder: 16 },
      { formLineCode: "1120_17", formLineLabel: "Rents", sortOrder: 17 },
      { formLineCode: "1120_18", formLineLabel: "Taxes and licenses", sortOrder: 18 },
      { formLineCode: "1120_19", formLineLabel: "Interest", sortOrder: 19 },
      { formLineCode: "1120_20", formLineLabel: "Charitable contributions", sortOrder: 20 },
      { formLineCode: "1120_21", formLineLabel: "Depreciation", sortOrder: 21 },
      { formLineCode: "1120_22", formLineLabel: "Depletion", sortOrder: 22 },
      { formLineCode: "1120_23", formLineLabel: "Advertising", sortOrder: 23 },
      { formLineCode: "1120_24", formLineLabel: "Pension, profit-sharing plans", sortOrder: 24 },
      { formLineCode: "1120_25", formLineLabel: "Employee benefit programs", sortOrder: 25 },
      { formLineCode: "1120_26", formLineLabel: "Other deductions", sortOrder: 26 },
      { formLineCode: "1120_27", formLineLabel: "Total deductions", sortOrder: 27 },
      { formLineCode: "1120_28", formLineLabel: "Taxable income before NOL", sortOrder: 28 },
      { formLineCode: "1120_29", formLineLabel: "Net operating loss deduction", sortOrder: 29 },
      { formLineCode: "1120_30", formLineLabel: "Taxable income", sortOrder: 30 },
    ],
    "1120S": [
      { formLineCode: "1120S_1", formLineLabel: "Gross receipts or sales", sortOrder: 1 },
      { formLineCode: "1120S_2", formLineLabel: "Returns and allowances", sortOrder: 2 },
      { formLineCode: "1120S_3", formLineLabel: "Cost of goods sold", sortOrder: 3 },
      { formLineCode: "1120S_4", formLineLabel: "Gross profit", sortOrder: 4 },
      { formLineCode: "1120S_5", formLineLabel: "Other income (loss)", sortOrder: 5 },
      { formLineCode: "1120S_6", formLineLabel: "Total income (loss)", sortOrder: 6 },
      { formLineCode: "1120S_7", formLineLabel: "Compensation of officers", sortOrder: 7 },
      { formLineCode: "1120S_8", formLineLabel: "Salaries and wages", sortOrder: 8 },
      { formLineCode: "1120S_9", formLineLabel: "Repairs and maintenance", sortOrder: 9 },
      { formLineCode: "1120S_10", formLineLabel: "Bad debts", sortOrder: 10 },
      { formLineCode: "1120S_11", formLineLabel: "Rents", sortOrder: 11 },
      { formLineCode: "1120S_12", formLineLabel: "Taxes and licenses", sortOrder: 12 },
      { formLineCode: "1120S_13", formLineLabel: "Interest", sortOrder: 13 },
      { formLineCode: "1120S_14", formLineLabel: "Depreciation", sortOrder: 14 },
      { formLineCode: "1120S_15", formLineLabel: "Depletion", sortOrder: 15 },
      { formLineCode: "1120S_16", formLineLabel: "Advertising", sortOrder: 15 },
      { formLineCode: "1120S_17", formLineLabel: "Pension, profit-sharing plans", sortOrder: 16 },
      { formLineCode: "1120S_18", formLineLabel: "Employee benefit programs", sortOrder: 17 },
      { formLineCode: "1120S_19", formLineLabel: "Other deductions", sortOrder: 18 },
      { formLineCode: "1120S_20", formLineLabel: "Total deductions", sortOrder: 19 },
      { formLineCode: "1120S_21", formLineLabel: "Ordinary business income (loss)", sortOrder: 20 },
    ],
    "1065": [
      { formLineCode: "1065_1", formLineLabel: "Gross receipts or sales", sortOrder: 1 },
      { formLineCode: "1065_2", formLineLabel: "Returns and allowances", sortOrder: 2 },
      { formLineCode: "1065_3", formLineLabel: "Cost of goods sold", sortOrder: 3 },
      { formLineCode: "1065_4", formLineLabel: "Gross profit", sortOrder: 4 },
      { formLineCode: "1065_5", formLineLabel: "Other income (loss)", sortOrder: 5 },
      { formLineCode: "1065_6", formLineLabel: "Total income (loss)", sortOrder: 6 },
      { formLineCode: "1065_7", formLineLabel: "Salaries and wages", sortOrder: 7 },
      { formLineCode: "1065_8", formLineLabel: "Guaranteed payments to partners", sortOrder: 8 },
      { formLineCode: "1065_9", formLineLabel: "Repairs and maintenance", sortOrder: 9 },
      { formLineCode: "1065_10", formLineLabel: "Bad debts", sortOrder: 10 },
      { formLineCode: "1065_11", formLineLabel: "Rents", sortOrder: 11 },
      { formLineCode: "1065_12", formLineLabel: "Taxes and licenses", sortOrder: 12 },
      { formLineCode: "1065_13", formLineLabel: "Interest", sortOrder: 13 },
      { formLineCode: "1065_14", formLineLabel: "Depreciation", sortOrder: 14 },
      { formLineCode: "1065_15", formLineLabel: "Depletion", sortOrder: 15 },
      { formLineCode: "1065_16", formLineLabel: "Retirement plans", sortOrder: 16 },
      { formLineCode: "1065_17", formLineLabel: "Employee benefit programs", sortOrder: 17 },
      { formLineCode: "1065_18", formLineLabel: "Other deductions", sortOrder: 18 },
      { formLineCode: "1065_19", formLineLabel: "Total deductions", sortOrder: 19 },
      { formLineCode: "1065_20", formLineLabel: "Ordinary business income (loss)", sortOrder: 20 },
    ],
    // Schedule C (Form 1040), Profit or Loss From Business: Parts I and II line numbers.
    "SchC": [
      { formLineCode: "SchC_1", formLineLabel: "Gross receipts or sales", sortOrder: 1 },
      { formLineCode: "SchC_2", formLineLabel: "Returns and allowances", sortOrder: 2 },
      { formLineCode: "SchC_4", formLineLabel: "Cost of goods sold", sortOrder: 4 },
      { formLineCode: "SchC_6", formLineLabel: "Other income", sortOrder: 6 },
      { formLineCode: "SchC_7", formLineLabel: "Gross income", sortOrder: 7 },
      { formLineCode: "SchC_8", formLineLabel: "Advertising", sortOrder: 8 },
      { formLineCode: "SchC_9", formLineLabel: "Car and truck expenses", sortOrder: 9 },
      { formLineCode: "SchC_10", formLineLabel: "Commissions and fees", sortOrder: 10 },
      { formLineCode: "SchC_11", formLineLabel: "Contract labor", sortOrder: 11 },
      { formLineCode: "SchC_13", formLineLabel: "Depreciation and section 179", sortOrder: 13 },
      { formLineCode: "SchC_14", formLineLabel: "Employee benefit programs", sortOrder: 14 },
      { formLineCode: "SchC_15", formLineLabel: "Insurance (other than health)", sortOrder: 15 },
      { formLineCode: "SchC_16a", formLineLabel: "Interest: mortgage", sortOrder: 16 },
      { formLineCode: "SchC_16b", formLineLabel: "Interest: other", sortOrder: 17 },
      { formLineCode: "SchC_17", formLineLabel: "Legal and professional services", sortOrder: 18 },
      { formLineCode: "SchC_18", formLineLabel: "Office expense", sortOrder: 19 },
      { formLineCode: "SchC_19", formLineLabel: "Pension and profit-sharing plans", sortOrder: 20 },
      { formLineCode: "SchC_20a", formLineLabel: "Rent or lease: vehicles, machinery, equipment", sortOrder: 21 },
      { formLineCode: "SchC_20b", formLineLabel: "Rent or lease: other business property", sortOrder: 22 },
      { formLineCode: "SchC_21", formLineLabel: "Repairs and maintenance", sortOrder: 23 },
      { formLineCode: "SchC_22", formLineLabel: "Supplies", sortOrder: 24 },
      { formLineCode: "SchC_23", formLineLabel: "Taxes and licenses", sortOrder: 25 },
      { formLineCode: "SchC_24a", formLineLabel: "Travel", sortOrder: 26 },
      { formLineCode: "SchC_24b", formLineLabel: "Deductible meals", sortOrder: 27 },
      { formLineCode: "SchC_25", formLineLabel: "Utilities", sortOrder: 28 },
      { formLineCode: "SchC_26", formLineLabel: "Wages", sortOrder: 29 },
      { formLineCode: "SchC_27b", formLineLabel: "Other expenses", sortOrder: 30 },
      { formLineCode: "SchC_28", formLineLabel: "Total expenses", sortOrder: 31 },
      { formLineCode: "SchC_30", formLineLabel: "Business use of home", sortOrder: 32 },
      { formLineCode: "SchC_31", formLineLabel: "Net profit or (loss)", sortOrder: 33 },
    ],
    "state_CA": [
      { formLineCode: "CA_1", formLineLabel: "Federal taxable income", sortOrder: 1 },
      { formLineCode: "CA_2", formLineLabel: "Additions", sortOrder: 2 },
      { formLineCode: "CA_3", formLineLabel: "Subtractions", sortOrder: 3 },
      { formLineCode: "CA_4", formLineLabel: "Net income", sortOrder: 4 },
      { formLineCode: "CA_5", formLineLabel: "Apportionment factor", sortOrder: 5 },
      { formLineCode: "CA_6", formLineLabel: "California net income", sortOrder: 6 },
      { formLineCode: "CA_7", formLineLabel: "Tax", sortOrder: 7 },
    ],
    "state_NY": [
      { formLineCode: "NY_1", formLineLabel: "Federal taxable income", sortOrder: 1 },
      { formLineCode: "NY_2", formLineLabel: "Additions", sortOrder: 2 },
      { formLineCode: "NY_3", formLineLabel: "Subtractions", sortOrder: 3 },
      { formLineCode: "NY_4", formLineLabel: "Net income", sortOrder: 4 },
      { formLineCode: "NY_5", formLineLabel: "Apportionment factor", sortOrder: 5 },
      { formLineCode: "NY_6", formLineLabel: "New York net income", sortOrder: 6 },
      { formLineCode: "NY_7", formLineLabel: "Tax", sortOrder: 7 },
    ],
  };

  return templates[taxForm] || [];
}

function mapTaxFormMapping(row: any): any {
  return {
    id: row.id,
    firm_id: row.firm_id,
    client_id: row.client_id,
    tax_form: row.tax_form,
    tax_year: row.tax_year,
    form_line_code: row.form_line_code,
    form_line_label: row.form_line_label,
    account_id: row.account_id,
    mapping_type: row.mapping_type,
    calculation_formula: row.calculation_formula,
    sort_order: row.sort_order,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}