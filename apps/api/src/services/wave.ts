/**
 * The Wave basic statement CSV importer only ever accepts Date/Description/
 * Amount. Adding Folio's own columns risks Wave rejecting or misreading the
 * file, so this deliberately stays narrow. Folio's categorization and
 * review decisions belong only in the separate Wave Handoff worksheet.
 */
import { sanitizeSpreadsheetCell } from "./excel-safety";
import type { WaveHandoffRow } from "./reporting";

export type WaveStatementSelection = {
  importBatchId: string | null;
  currency: string;
};

export type WaveStatementValidation =
  | { ok: true }
  | { ok: false; reason: "MIXED_BATCHES" | "MIXED_CURRENCIES" | "NO_TRANSACTIONS" };

/**
 * Refuses to build a statement when the selected rows do not all belong to
 * exactly one source/import-batch and one currency, so unrelated bank
 * accounts or mixed currencies are never silently merged into one file.
 */
export function validateSingleSourceSelection(rows: WaveHandoffRow[]): WaveStatementValidation {
  if (rows.length === 0) return { ok: false, reason: "NO_TRANSACTIONS" };
  const batchIds = new Set(rows.map((r) => r.importBatchId ?? "__none__"));
  if (batchIds.size > 1) return { ok: false, reason: "MIXED_BATCHES" };
  const currencies = new Set(rows.map((r) => r.currency.toUpperCase()));
  if (currencies.size > 1) return { ok: false, reason: "MIXED_CURRENCIES" };
  return { ok: true };
}

function csvEscape(value: string): string {
  const sanitized = sanitizeSpreadsheetCell(value);
  if (/[",\n\r]/.test(sanitized)) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}

/**
 * Only Date, Description, Amount - deliberately no Folio category,
 * disposition, or evidence columns. Rows must already be validated as a
 * single source/import-batch and single currency by the caller.
 */
export function buildWaveStatementCsv(rows: WaveHandoffRow[]): string {
  const lines = ["Date,Description,Amount"];
  for (const row of rows) {
    const date = row.date ?? "";
    const description = csvEscape(row.description ?? "");
    const amount = String(row.amount);
    lines.push(`${date},${description},${amount}`);
  }
  return lines.join("\r\n") + "\r\n";
}
