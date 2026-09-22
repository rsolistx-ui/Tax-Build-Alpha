import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildWorkbook, type WorkbookInput } from "./excel";
import type { PnlReport } from "./reporting";

function completePnl(overrides: Partial<PnlReport> = {}): PnlReport {
  return {
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    currency: "USD",
    accountingBasis: "cash",
    accrualSupported: true,
    income: 1000,
    expenses: 400,
    net: 600,
    categorizedExpenses: [
      { categoryId: "cat_1", category: "Supplies", count: 2, receiptCount: 2, bankCount: 0, total: 400 },
    ],
    categorizedIncome: [{ categoryId: null, category: "Consulting", count: 1, total: 1000 }],
    counts: { filedReceipts: 2, matchedBankTransactions: 0, noReceiptBusinessExpenses: 0, businessIncomeTransactions: 1 },
    completeness: { unclassifiedCount: 0, unresolvedTriageCount: 0, uncategorizedCount: 0, currencyConflictCount: 0, isComplete: true },
    excludedFiledReceiptCount: 0,
    excludedFiledReceipts: [],
    note: "test",
    ...overrides,
  };
}

function baseInput(overrides: Partial<WorkbookInput> = {}): WorkbookInput {
  return {
    clientName: "Phyllis Client",
    legalName: "Phyllis Client LLC",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    taxYear: 2026,
    accountingBasis: "cash",
    currency: "USD",
    generatedAt: "2026-09-06T00:00:00.000Z",
    pnl: completePnl(),
    bankLedger: [],
    receiptEvidence: [],
    openItems: [],
    receiptsAwaitingReview: [],
    outstandingClientRequests: [],
    excludedNonbusiness: [],
    transactionReview: [],
    ...overrides,
  };
}

async function readWorkbook(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.buffer as ArrayBuffer);
  return wb;
}

function cellText(sheet: ExcelJS.Worksheet, row: number, col: number): string {
  return String(sheet.getRow(row).getCell(col).value ?? "");
}

describe("buildWorkbook", () => {
  it("SUMMARY sheet income/expenses/net exactly reconcile to the canonical P&L", async () => {
    const wb = await readWorkbook(await buildWorkbook(baseInput()));
    const summary = wb.getWorksheet("SUMMARY")!;
    const values = new Map<string, unknown>();
    summary.eachRow((row) => {
      values.set(String(row.getCell(1).value), row.getCell(2).value);
    });
    expect(values.get("Income")).toBe(1000);
    expect(values.get("Expenses")).toBe(400);
    expect(values.get("Net")).toBe(600);
  });

  it("P&L sheet category totals reconcile to the canonical P&L categories", async () => {
    const wb = await readWorkbook(await buildWorkbook(baseInput()));
    const pnlSheet = wb.getWorksheet("P&L")!;
    let foundSupplies = false;
    let foundConsulting = false;
    pnlSheet.eachRow((row) => {
      if (row.getCell(2).value === "Supplies") {
        expect(row.getCell(3).value).toBe(400);
        foundSupplies = true;
      }
      if (row.getCell(2).value === "Consulting") {
        expect(row.getCell(3).value).toBe(1000);
        foundConsulting = true;
      }
    });
    expect(foundSupplies).toBe(true);
    expect(foundConsulting).toBe(true);
  });

  it("marks the report DRAFT when the P&L is incomplete", async () => {
    const incomplete = completePnl({
      completeness: { unclassifiedCount: 1, unresolvedTriageCount: 0, uncategorizedCount: 0, currencyConflictCount: 0, isComplete: false },
    });
    const wb = await readWorkbook(await buildWorkbook(baseInput({ pnl: incomplete })));
    const summary = wb.getWorksheet("SUMMARY")!;
    let statusValue: unknown;
    let hasDraftWarning = false;
    summary.eachRow((row) => {
      if (row.getCell(1).value === "Report status") statusValue = row.getCell(2).value;
      const text = String(row.getCell(1).value ?? "");
      if (text.includes("DRAFT - ITEMS REQUIRE PROFESSIONAL REVIEW")) hasDraftWarning = true;
    });
    expect(statusValue).toBe("DRAFT - ITEMS REQUIRE PROFESSIONAL REVIEW");
    expect(hasDraftWarning).toBe(true);
  });

  it("never marks a complete report DRAFT", async () => {
    const wb = await readWorkbook(await buildWorkbook(baseInput()));
    const summary = wb.getWorksheet("SUMMARY")!;
    let statusValue: unknown;
    summary.eachRow((row) => {
      if (row.getCell(1).value === "Report status") statusValue = row.getCell(2).value;
    });
    expect(statusValue).toBe("FINAL");
  });

  it("marks a packet DRAFT when a receipt or client request still needs action", async () => {
    const wb = await readWorkbook(await buildWorkbook(baseInput({
      receiptsAwaitingReview: [{
        receiptId: "rec_review", date: null, merchant: null, filename: "blurry.jpg", status: "review", validationStatus: "manual_review_required", notes: "Unreadable",
      }],
      outstandingClientRequests: [{
        requestId: "req_1", requestType: "missing_receipt", title: "Need clearer image", status: "requested", dueAt: null, createdAt: "2026-09-20T00:00:00.000Z",
      }],
    })));
    const summary = wb.getWorksheet("SUMMARY")!;
    expect(cellText(summary, 10, 2)).toBe("DRAFT - ITEMS REQUIRE PROFESSIONAL REVIEW");
    expect(wb.getWorksheet("RECEIPT REVIEW QUEUE")!.rowCount).toBe(2);
    expect(wb.getWorksheet("OUTSTANDING CLIENT REQUESTS")!.rowCount).toBe(2);
  });
});

describe("buildWorkbook excluded/nonbusiness visibility", () => {
  it("keeps excluded personal activity out of the P&L sheet's category rows but present in the Excluded and Bank Ledger sheets", async () => {
    const input = baseInput({
      bankLedger: [
        {
          transactionId: "txn_personal",
          date: "2026-03-01",
          description: "Grocery run",
          amount: -30,
          currency: "USD",
          disposition: "personal",
          category: null,
          professionalNote: "Confirmed personal",
          triage: "matched",
          matchedReceiptStatus: null,
          matchedReceiptId: null,
          noReceiptReason: null,
          sourceFilename: null,
          sourceRow: null,
          importBatchId: null,
        },
      ],
      excludedNonbusiness: [
        {
          transactionId: "txn_personal",
          date: "2026-03-01",
          description: "Grocery run",
          amount: -30,
          currency: "USD",
          disposition: "personal",
          professionalNote: "Confirmed personal",
        },
      ],
    });
    const wb = await readWorkbook(await buildWorkbook(input));

    const pnlSheet = wb.getWorksheet("P&L")!;
    let personalInPnl = false;
    pnlSheet.eachRow((row) => {
      if (String(row.getCell(2).value ?? "").includes("Grocery")) personalInPnl = true;
    });
    expect(personalInPnl).toBe(false);

    const bankLedger = wb.getWorksheet("BANK LEDGER")!;
    expect(cellText(bankLedger, 2, 2)).toBe("Grocery run");

    const excluded = wb.getWorksheet("EXCLUDED - NONBUSINESS")!;
    expect(cellText(excluded, 2, 2)).toBe("Grocery run");
  });
});

describe("buildWorkbook formula-injection safety", () => {
  it.each(["=cmd|'/c calc'!A1", "+1+1", "-2+3", "@SUM(1,2)"])(
    "writes a merchant name %s as inert text, never a live formula",
    async (dangerous) => {
      const input = baseInput({
        receiptEvidence: [
          {
            receiptId: "rec_1",
            date: "2026-03-01",
            merchant: dangerous,
            subtotal: 10,
            tax: 1,
            tip: 0,
            total: 11,
            currency: "USD",
            category: "Supplies",
            filename: dangerous,
            validationStatus: "pass",
            excludedFromOperatingPnl: false,
            exclusionReason: null,
            matchedBankTransactionId: null,
            sourceUrl: "/api/clients/client_1/receipts/rec_1/source",
          },
        ],
      });
      const wb = await readWorkbook(await buildWorkbook(input));
      const receiptSheet = wb.getWorksheet("RECEIPT EVIDENCE")!;
      const merchantCell = receiptSheet.getRow(2).getCell(2);
      // exceljs reports a formula cell's .type as Formula; a sanitized cell
      // must always come back as a plain string value instead.
      expect(typeof merchantCell.value).toBe("string");
      expect(String(merchantCell.value)).toContain(dangerous);
    },
  );
});

describe("buildWorkbook receipt source URL", () => {
  it("points to the authenticated Folio receipt source endpoint", async () => {
    const input = baseInput({
      receiptEvidence: [
        {
          receiptId: "rec_1",
          date: "2026-03-01",
          merchant: "Office Depot",
          subtotal: 10,
          tax: 1,
          tip: 0,
          total: 11,
          currency: "USD",
          category: "Supplies",
          filename: "r.jpg",
          validationStatus: "pass",
          excludedFromOperatingPnl: false,
          exclusionReason: null,
          matchedBankTransactionId: null,
          sourceUrl: "/api/clients/client_1/receipts/rec_1/source",
        },
      ],
    });
    const wb = await readWorkbook(await buildWorkbook(input));
    const receiptSheet = wb.getWorksheet("RECEIPT EVIDENCE")!;
    expect(cellText(receiptSheet, 2, 15)).toBe("/api/clients/client_1/receipts/rec_1/source");
  });
});
