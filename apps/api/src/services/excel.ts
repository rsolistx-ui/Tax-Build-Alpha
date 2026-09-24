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
import type { TaxHandoff } from "./tax-handoff";
import type {
  BankLedgerRow,
  ReceiptEvidenceRow,
  OpenItemRow,
  ExcludedNonbusinessRow,
  TransactionReviewRow,
  ReceiptAwaitingReviewRow,
  OutstandingClientRequestRow,
} from "./reporting";

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
  receiptsAwaitingReview: ReceiptAwaitingReviewRow[];
  outstandingClientRequests: OutstandingClientRequestRow[];
  excludedNonbusiness: ExcludedNonbusinessRow[];
  transactionReview: TransactionReviewRow[];
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

  const isDraft = !input.pnl.completeness.isComplete || input.receiptsAwaitingReview.length > 0 || input.outstandingClientRequests.length > 0;
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
    ["Receipt review queue count", input.receiptsAwaitingReview.length],
    ["Outstanding client request count", input.outstandingClientRequests.length],
    ["Excluded receipt / nonbusiness count", input.pnl.excludedFiledReceiptCount + input.excludedNonbusiness.length],
  ];
  for (const [label, value] of summaryRows) {
    summary.addRow(safeRow([label, value]));
  }
  if (isDraft) {
    const warningRow = summary.addRow([
      "DRAFT - ITEMS REQUIRE PROFESSIONAL REVIEW: this packet has unresolved ledger items, receipt-review items, or outstanding client requests. See the exception sheets before relying on it as complete books.",
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

  const reviewQueue = workbook.addWorksheet("RECEIPT REVIEW QUEUE");
  addHeaderRow(reviewQueue, ["Receipt Date", "Merchant", "Filename", "Receipt Status", "Validation Status", "Review Note", "Receipt Id"]);
  for (const row of input.receiptsAwaitingReview) {
    reviewQueue.addRow(safeRow([row.date, row.merchant, row.filename, row.status, row.validationStatus, row.notes, row.receiptId]));
  }

  const requests = workbook.addWorksheet("OUTSTANDING CLIENT REQUESTS");
  addHeaderRow(requests, ["Request Type", "Title", "Status", "Due At", "Created At", "Request Id"]);
  for (const row of input.outstandingClientRequests) {
    requests.addRow(safeRow([row.requestType, row.title, row.status, row.dueAt, row.createdAt, row.requestId]));
  }

  const excluded = workbook.addWorksheet("EXCLUDED - NONBUSINESS");
  addHeaderRow(excluded, ["Date", "Description", "Amount", "Currency", "Disposition", "Professional Note"]);
  for (const row of input.excludedNonbusiness) {
    excluded.addRow(safeRow([row.date, row.description, row.amount, row.currency, row.disposition, row.professionalNote]));
  }

  const transactionReview = workbook.addWorksheet("TRANSACTION REVIEW");
  addHeaderRow(transactionReview, [
    "Date", "Description", "Amount", "Folio Disposition", "Folio Category", "Business/Nonbusiness Status",
    "Matched Receipt", "Receipt Filename", "Professional Note", "Source Transaction Id",
  ]);
  for (const row of input.transactionReview) {
    transactionReview.addRow(
      safeRow([
        row.date, row.description, row.amount, row.disposition, row.category, row.businessStatus,
        row.matchedReceiptId, row.receiptFilename, row.professionalNote, row.sourceTransactionId,
      ]),
    );
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

/**
 * Tax software handoff workbook: Schedule C lines in form order for the
 * preparer to key into their tax software, plus the category-to-line map
 * behind every amount. Lays out an already-built TaxHandoff; computes nothing.
 */
export async function buildTaxHandoffWorkbook(input: {
  clientName: string;
  legalName: string | null;
  generatedAt: string;
  handoff: TaxHandoff;
}): Promise<Uint8Array> {
  const { handoff } = input;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Truepost";
  workbook.created = new Date(input.generatedAt);
  const isDraft = !handoff.booksComplete || handoff.needsLine.length > 0;

  const sheet = workbook.addWorksheet("SCHEDULE C");
  sheet.columns = [{ width: 8 }, { width: 46 }, { width: 16 }, { width: 44 }, { width: 60 }];
  const info: Array<[string, string | number]> = [
    ["Client", input.clientName],
    ["Legal name", input.legalName ?? "(not on file)"],
    ["Form", `${handoff.form}, tax year ${handoff.taxYear}`],
    ["Books period", `${handoff.periodStart} to ${handoff.periodEnd}`],
    ["Accounting basis", handoff.accountingBasis],
    ["Currency", handoff.currency],
    ["Generated", input.generatedAt],
    ["Status", isDraft ? "DRAFT - ITEMS REQUIRE PROFESSIONAL REVIEW" : "BOOKS COMPLETE"],
  ];
  for (const [label, value] of info) sheet.addRow(safeRow([label, value]));
  if (isDraft) {
    const reasons: string[] = [];
    if (!handoff.booksComplete) reasons.push("the books have unresolved or uncategorized items");
    if (handoff.needsLine.length > 0) reasons.push(`${handoff.needsLine.length} categor${handoff.needsLine.length === 1 ? "y has" : "ies have"} no Schedule C line`);
    const warning = sheet.addRow(safeRow([`DRAFT: ${reasons.join("; ")}. Amounts below leave those items out.`]));
    warning.font = { bold: true, color: { argb: "FFB00020" } };
    sheet.mergeCells(warning.number, 1, warning.number, 5);
  }
  sheet.addRow([]);
  addHeaderRow(sheet, ["Line", "Description", "Amount", "From categories", "Note"]);
  for (const line of handoff.lines) {
    const row = sheet.addRow(safeRow([line.line, line.label, line.amount, line.categories.join(", "), line.note]));
    row.getCell(3).numFmt = "#,##0.00";
  }
  for (const [label, value] of [
    ["Line 7 gross income", handoff.totals.grossIncome],
    ["Line 28 total expenses (before line 13, 27a and 30 worksheets)", handoff.totals.totalExpenses],
    ["Line 29 tentative profit (before line 30 business use of home)", handoff.totals.tentativeProfit],
  ] as Array<[string, number]>) {
    const row = sheet.addRow(safeRow(["", label, value]));
    row.font = { bold: true };
    row.getCell(3).numFmt = "#,##0.00";
  }

  const map = workbook.addWorksheet("CATEGORY MAP");
  map.columns = [{ width: 36 }, { width: 10 }, { width: 16 }, { width: 10 }, { width: 46 }, { width: 22 }];
  addHeaderRow(map, ["Category", "Type", "Amount", "Line", "Line description", "Line chosen by"]);
  for (const cat of handoff.categories) {
    const line = handoff.lines.find((l) => l.code === cat.lineCode);
    const chosenBy = cat.source === "preparer" ? "Preparer" : cat.source === "suggested" ? "Suggested from name" : cat.categoryId ? "NEEDS A LINE" : "NEEDS A CATEGORY";
    const row = map.addRow(safeRow([cat.category, cat.side, cat.total, line?.line ?? "", line?.label ?? "", chosenBy]));
    row.getCell(3).numFmt = "#,##0.00";
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
