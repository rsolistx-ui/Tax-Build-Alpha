import { describe, expect, it } from "vitest";
import { buildBankTransactionsCsv, validateSingleSourceSelection } from "./bank-export";
import type { TransactionReviewRow } from "./reporting";

function row(overrides: Partial<TransactionReviewRow> = {}): TransactionReviewRow {
  return {
    date: "2026-03-01",
    description: "Office Depot",
    amount: -42.5,
    currency: "USD",
    disposition: "business_expense",
    category: "Supplies",
    businessStatus: "business",
    matchedReceiptId: null,
    receiptFilename: null,
    professionalNote: "Reviewed",
    sourceTransactionId: "txn_1",
    importBatchId: "batch_1",
    ...overrides,
  };
}

describe("validateSingleSourceSelection", () => {
  it("rejects an empty selection", () => {
    expect(validateSingleSourceSelection([])).toEqual({ ok: false, reason: "NO_TRANSACTIONS" });
  });

  it("rejects rows spanning more than one import batch", () => {
    const rows = [row({ importBatchId: "batch_1" }), row({ importBatchId: "batch_2" })];
    expect(validateSingleSourceSelection(rows)).toEqual({ ok: false, reason: "MIXED_BATCHES" });
  });

  it("rejects rows spanning more than one currency", () => {
    const rows = [row({ currency: "USD" }), row({ currency: "EUR" })];
    expect(validateSingleSourceSelection(rows)).toEqual({ ok: false, reason: "MIXED_CURRENCIES" });
  });

  it("accepts a single-batch, single-currency selection", () => {
    const rows = [row(), row({ sourceTransactionId: "txn_2" })];
    expect(validateSingleSourceSelection(rows)).toEqual({ ok: true });
  });
});

describe("buildBankTransactionsCsv", () => {
  it("contains only Date, Description, Amount columns", () => {
    const csv = buildBankTransactionsCsv([row()]);
    const [header] = csv.trim().split("\r\n");
    expect(header).toBe("Date,Description,Amount");
  });

  it("never includes a Folio category, disposition, or evidence column", () => {
    const csv = buildBankTransactionsCsv([row()]);
    expect(csv).not.toContain("Supplies");
    expect(csv).not.toContain("business_expense");
    expect(csv).not.toContain("Reviewed");
    expect(csv).not.toContain("txn_1");
  });

  it("reconciles values to the selected source transactions", () => {
    const rows = [row({ date: "2026-03-01", description: "Office Depot", amount: -42.5 })];
    const csv = buildBankTransactionsCsv(rows);
    expect(csv).toContain("2026-03-01,Office Depot,-42.5");
  });

  it("writes a formula-injection risk description as inert text", () => {
    const rows = [row({ description: "=cmd|'/c calc'!A1" })];
    const csv = buildBankTransactionsCsv(rows);
    expect(csv).toContain("'=cmd");
  });
});
