/**
 * Builds the Folio Professional Excel workbook. exceljs is used because it
 * has no filesystem or native-binary dependency and runs cleanly under
 * Cloudflare Workers with nodejs_compat enabled - verified against this
 * project's own wrangler build before being adopted here. All numeric
 * reconciliation comes from ../services/reporting and ../services/pnl;
 * this module only lays the already-computed data out into worksheets and
 * never recomputes an accounting total itself.
 */
import ExcelJS from "exceljs";
import { sanitizeSpreadsheetCell } from "./excel-safety";
import type { PnlReport } from "./reporting";
import type { BankLedgerRow, ReceiptEvidenceRow, OpenItemRow, ExcludedNonbusinessRow, WaveHandoffRow } from "./reporting";

export type WorkbookInput = {
  clientName: string;
  legalName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  taxYear: number | null;
  accountingBasis: string;
  currency: string;
  generatedAt: string;
  pnl: PnlReport;
  bankLedger: BankLedgerRow[];
  receiptEvidence: ReceiptEvidenceRow[];
  openItems: OpenItemRow[];
  excludedNonbusiness: ExcludedNonbusinessRow[];
  waveHandoff: WaveHandoffRow[];
};

function safeRow(values: Array<string | number | boolean | null>): Array<string | number | boolean | null> {
  return values.map((v) => (typeof v === "string" ? sanitizeSpreadsheetCell(v) : v));
}

function addHeaderRow(sheet: ExcelJS.Worksheet, headers: string[]): void {
  const row = sheet.addRow(headers);
  row.font = { bold: true };
}

export async function buildWorkbook(input: WorkbookInput): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Folio";
  workbook.created = new Date(input.generatedAt);

  const isDraft = !input.pnl.completeness.isComplete;
  const reportStatus = isDraft ? "DRAFT - ITEMS REQUIRE PROFESSIONAL REVIEW" : "FINAL";

  const summary = workbook.addWorksheet("SUMMARY");
  summary.columns = [{ width: 34 }, { width: 40 }];
  const summaryRows: Array<[string, string | number]> = [
    ["Folio", "Professional Export"],
    ["Client", input.clientName],
    ["Legal name", input.legalName ?? "(not on file)"],
    ["Reporting start date", input.periodStart ?? "(unbounded)"],
    ["Reporting end date", input.periodEnd ?? "(unbounded)"],
    ["Tax year", input.taxYear ?? "(not set)"],
    ["Accounting basis", input.accountingBasis],
    ["Reporting currency", input.currency],
    ["Generated", input.generatedAt],
    ["Report status", reportStatus],
    ["Income", input.pnl.income],
    ["Expenses", input.pnl.expenses],
    ["Net", input.pnl.net],
    ["Unresolved item count", input.pnl.completeness.unresolvedTriageCount],
    ["Uncategorized item count", input.pnl.completeness.uncategorizedCount],
    ["Currency conflict count", input.pnl.completeness.currencyConflictCount],
    ["Excluded receipt / nonbusiness count", input.pnl.excludedFiledReceiptCount + input.excludedNonbusiness.length],
  ];
  for (const [label, value] of summaryRows) {
    summary.addRow(safeRow([label, value]));
  }
  if (isDraft) {
    const warningRow = summary.addRow([
      "DRAFT - ITEMS REQUIRE PROFESSIONAL REVIEW: this period has unresolved items (see the Open Items sheet) and is not yet complete books.",
    ]);
    warningRow.font = { bold: true, color: { argb: "FFB00020" } };
    summary.mergeCells(warningRow.number, 1, warningRow.number, 2);
  }

  const pnlSheet = workbook.addWorksheet("P&L");
  addHeaderRow(pnlSheet, ["Type", "Category", "Amount"]);
  for (const row of input.pnl.categorizedIncome) {
    pnlSheet.addRow(safeRow(["Income", row.category, row.total]));
  }
  for (const row of input.pnl.categorizedExpenses) {
    pnlSheet.addRow(safeRow(["Expense", row.category, row.total]));
  }
  pnlSheet.addRow([]);
  const totalIncomeRow = pnlSheet.addRow(safeRow(["", "Total income", input.pnl.income]));
  totalIncomeRow.font = { bold: true };
  const totalExpenseRow = pnlSheet.addRow(safeRow(["", "Total expenses", input.pnl.expenses]));
  totalExpenseRow.font = { bold: true };
  const netRow = pnlSheet.addRow(safeRow(["", "Net", input.pnl.net]));
  netRow.font = { bold: true };

  const bankLedger = workbook.addWorksheet("BANK LEDGER");
  addHeaderRow(bankLedger, [
    "Date", "Description", "Original Signed Amount", "Currency", "Disposition", "Category",
    "Professional Note", "Triage State", "Matched Receipt Status", "Matched Receipt Id",
    "No-Receipt Reason", "Source Filename", "Source Row", "Import Batch Id", "Transaction Id",
  ]);
  for (const row of input.bankLedger) {
    bankLedger.addRow(
      safeRow([
        row.date, row.description, row.amount, row.currency, row.disposition, row.category,
        row.professionalNote, row.triage, row.matchedReceiptStatus, row.matchedReceiptId,
        row.noReceiptReason, row.sourceFilename, row.sourceRow, row.importBatchId, row.transactionId,
      ]),
    );
  }

  const receiptEvidence = workbook.addWorksheet("RECEIPT EVIDENCE");
  addHeaderRow(receiptEvidence, [
    "Receipt Date", "Merchant", "Subtotal", "Tax", "Tip", "Total", "Currency", "Category",
    "Filename", "Validation Status", "Excluded From Operating P&L", "Exclusion Reason",
    "Matched Bank Transaction Id", "Receipt Id", "Authenticated Folio Source URL",
  ]);
  for (const row of input.receiptEvidence) {
    receiptEvidence.addRow(
      safeRow([
        row.date, row.merchant, row.subtotal, row.tax, row.tip, row.total, row.currency, row.category,
        row.filename, row.validationStatus, row.excludedFromOperatingPnl ? "Yes" : "No", row.exclusionReason,
        row.matchedBankTransactionId, row.receiptId, row.sourceUrl,
      ]),
    );
  }

  const openItems = workbook.addWorksheet("OPEN ITEMS");
  addHeaderRow(openItems, ["Kind", "Date", "Transaction Id", "Receipt Id", "Description", "Detail"]);
  for (const row of input.openItems) {
    openItems.addRow(safeRow([row.kind, row.date, row.transactionId, row.receiptId, row.description, row.detail]));
  }

  const excluded = workbook.addWorksheet("EXCLUDED - NONBUSINESS");
  addHeaderRow(excluded, ["Date", "Description", "Amount", "Currency", "Disposition", "Professional Note"]);
  for (const row of input.excludedNonbusiness) {
    excluded.addRow(safeRow([row.date, row.description, row.amount, row.currency, row.disposition, row.professionalNote]));
  }

  const waveHandoff = workbook.addWorksheet("WAVE HANDOFF");
  addHeaderRow(waveHandoff, [
    "Date", "Description", "Amount", "Folio Disposition", "Folio Category", "Business/Nonbusiness Status",
    "Matched Receipt", "Receipt Filename", "Professional Note", "Source Transaction Id",
  ]);
  for (const row of input.waveHandoff) {
    waveHandoff.addRow(
      safeRow([
        row.date, row.description, row.amount, row.disposition, row.category, row.businessStatus,
        row.matchedReceiptId, row.receiptFilename, row.professionalNote, row.sourceTransactionId,
      ]),
    );
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
