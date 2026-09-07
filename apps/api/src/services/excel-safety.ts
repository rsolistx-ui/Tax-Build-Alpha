/**
 * Spreadsheet formula-injection protection. Any user/source-controlled
 * string that Excel, Google Sheets, or LibreOffice could interpret as a
 * formula when a cell is later re-typed, pasted, or round-tripped through
 * CSV must be written as inert literal text instead. Only formulas Folio
 * deliberately generates itself are ever allowed to become real formulas -
 * this module handles the opposite case exclusively.
 */
const DANGEROUS_LEADING_CHARS = ["=", "+", "-", "@", "\t", "\r"];

export function isFormulaInjectionRisk(value: string): boolean {
  return DANGEROUS_LEADING_CHARS.some((char) => value.startsWith(char));
}

/**
 * Prefixing with a single quote forces spreadsheet applications to treat
 * the cell as literal text even if the file is later exported to CSV and
 * reopened, which is the scenario a bare "string" cell type in the xlsx
 * XML does not protect against.
 */
export function sanitizeSpreadsheetCell(value: string): string {
  if (isFormulaInjectionRisk(value)) return `'${value}`;
  return value;
}

export function sanitizeSpreadsheetRow<T extends Record<string, unknown>>(row: T): T {
  const result = { ...row } as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    const value = result[key];
    if (typeof value === "string") {
      result[key] = sanitizeSpreadsheetCell(value);
    }
  }
  return result as T;
}
