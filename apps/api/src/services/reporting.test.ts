import { describe, expect, it } from "vitest";
import type { Db } from "../db";
import { getBankLedger, getReceiptEvidence, getOpenItems, getExcludedNonbusiness, getUncategorizedReceiptLineCounts } from "./reporting";

function fakeDb(overrides: Record<string, unknown[]>): Db {
  return {
    async query<T>(sql: string) {
      for (const [key, rows] of Object.entries(overrides)) {
        if (sql.includes(key)) return rows as T[];
      }
      return [] as T[];
    },
    async transaction() {
      return [];
    },
  };
}

describe("getBankLedger", () => {
  it("maps raw_json source metadata and preserves the professional note and category", async () => {
    const db = fakeDb({
      "mr.status AS matched_receipt_status": [
        {
          id: "txn_1",
          txn_date: "2026-03-01",
          description: "Office Depot",
          amount: -42.5,
          currency: "usd",
          disposition: "business_expense",
          category_name: "Supplies",
          disposition_note: "Confirmed by Phyllis",
          triage: "no_receipt_required",
          matched_receipt_id: null,
          matched_receipt_status: null,
          resolution_reason: "Lost receipt, confirmed via bank statement",
          raw_json: { importBatchId: "batch_1", sourceFilename: "chase_march.csv", sourceRow: 4 },
        },
      ],
    });
    const [row] = await getBankLedger(db, "client_1", null, null);
    expect(row.currency).toBe("USD");
    expect(row.category).toBe("Supplies");
    expect(row.professionalNote).toBe("Confirmed by Phyllis");
    expect(row.noReceiptReason).toBe("Lost receipt, confirmed via bank statement");
    expect(row.importBatchId).toBe("batch_1");
    expect(row.sourceFilename).toBe("chase_march.csv");
    expect(row.sourceRow).toBe(4);
  });
});

describe("getReceiptEvidence", () => {
  it("builds an authenticated Folio source URL that requires an active account", async () => {
    const db = fakeDb({
      "SELECT default_currency FROM client_profiles WHERE client_id = $1": [{ default_currency: "USD" }],
      "matched_bank_disposition": [
        {
          id: "rec_1",
          extracted_date: "2026-03-01",
          extracted_merchant: "Office Depot",
          extracted_subtotal: 40,
          extracted_tax: 2.5,
          extracted_tip: null,
          extracted_total: 42.5,
          extracted_currency: "USD",
          category_name: "Supplies",
          filename: "receipt.jpg",
          validation_status: "pass",
          matched_bank_id: null,
          matched_bank_disposition: null,
        },
      ],
    });
    const [row] = await getReceiptEvidence(db, "client_1", null, null);
    expect(row.sourceUrl).toBe("/api/clients/client_1/receipts/rec_1/source");
    expect(row.excludedFromOperatingPnl).toBe(false);
  });

  it("marks a receipt excluded when its matched bank transaction conflicts with a business expense", async () => {
    const db = fakeDb({
      "SELECT default_currency FROM client_profiles WHERE client_id = $1": [{ default_currency: "USD" }],
      "matched_bank_disposition": [
        {
          id: "rec_2",
          extracted_date: "2026-03-01",
          extracted_merchant: "Office Depot",
          extracted_subtotal: 40,
          extracted_tax: 2.5,
          extracted_tip: null,
          extracted_total: 42.5,
          extracted_currency: "USD",
          category_name: "Supplies",
          filename: "receipt.jpg",
          validation_status: "pass",
          matched_bank_id: "txn_9",
          matched_bank_disposition: "personal",
        },
      ],
    });
    const [row] = await getReceiptEvidence(db, "client_1", null, null);
    expect(row.excludedFromOperatingPnl).toBe(true);
    expect(row.exclusionReason).toContain("personal");
  });
});

describe("getOpenItems", () => {
  it("surfaces an unclassified bank transaction as an open item", async () => {
    const db = fakeDb({
      "SELECT default_currency FROM client_profiles WHERE client_id = $1": [{ default_currency: "USD" }],
      "mr.status AS matched_receipt_status": [
        {
          id: "txn_1",
          txn_date: "2026-03-01",
          description: "Unknown deposit",
          amount: 100,
          currency: "USD",
          disposition: "unclassified",
          category_name: null,
          disposition_note: null,
          triage: "unmatched",
          matched_receipt_id: null,
          matched_receipt_status: null,
          resolution_reason: null,
          raw_json: {},
        },
      ],
      "matched_bank_disposition": [],
    });
    const items = await getOpenItems(db, "client_1", null, null);
    expect(items.some((i) => i.kind === "unclassified_bank_transaction" && i.transactionId === "txn_1")).toBe(true);
  });

  it("surfaces a foreign-currency business transaction as a currency conflict", async () => {
    const db = fakeDb({
      "SELECT default_currency FROM client_profiles WHERE client_id = $1": [{ default_currency: "USD" }],
      "mr.status AS matched_receipt_status": [
        {
          id: "txn_2",
          txn_date: "2026-03-01",
          description: "EUR supplier",
          amount: -50,
          currency: "EUR",
          disposition: "business_expense",
          category_name: "Supplies",
          disposition_note: null,
          triage: "no_receipt_required",
          matched_receipt_id: null,
          matched_receipt_status: null,
          resolution_reason: "Confirmed",
          raw_json: {},
        },
      ],
      "matched_bank_disposition": [],
    });
    const items = await getOpenItems(db, "client_1", null, null);
    expect(items.some((i) => i.kind === "currency_conflict" && i.transactionId === "txn_2")).toBe(true);
  });
});

describe("getExcludedNonbusiness", () => {
  it("includes deliberately personal activity but never a business expense", async () => {
    const db = fakeDb({
      "mr.status AS matched_receipt_status": [
        {
          id: "txn_personal",
          txn_date: "2026-03-01",
          description: "Grocery run",
          amount: -30,
          currency: "USD",
          disposition: "personal",
          category_name: null,
          disposition_note: "Confirmed personal by Phyllis",
          triage: "matched",
          matched_receipt_id: null,
          matched_receipt_status: null,
          resolution_reason: null,
          raw_json: {},
        },
        {
          id: "txn_business",
          txn_date: "2026-03-01",
          description: "Office Depot",
          amount: -20,
          currency: "USD",
          disposition: "business_expense",
          category_name: "Supplies",
          disposition_note: null,
          triage: "no_receipt_required",
          matched_receipt_id: null,
          matched_receipt_status: null,
          resolution_reason: "Confirmed",
          raw_json: {},
        },
      ],
    });
    const rows = await getExcludedNonbusiness(db, "client_1", null, null);
    expect(rows).toHaveLength(1);
    expect(rows[0].transactionId).toBe("txn_personal");
    expect(rows[0].professionalNote).toBe("Confirmed personal by Phyllis");
  });
});

describe("getUncategorizedReceiptLineCounts", () => {
  it("returns an empty map without querying when given no clients", async () => {
    let queried = false;
    const db: Db = {
      async query() {
        queried = true;
        return [];
      },
      async transaction() {
        return [];
      },
    };
    const result = await getUncategorizedReceiptLineCounts(db, []);
    expect(result.size).toBe(0);
    expect(queried).toBe(false);
  });

  it("maps each client's real uncategorized filed-receipt-line count, never a hardcoded zero", async () => {
    const db = fakeDb({
      "GROUP BY r.client_id": [
        { client_id: "cli_a", count: "3" },
        { client_id: "cli_b", count: "0" },
      ],
    });
    const result = await getUncategorizedReceiptLineCounts(db, ["cli_a", "cli_b", "cli_c"]);
    expect(result.get("cli_a")).toBe(3);
    expect(result.get("cli_b")).toBe(0);
    expect(result.get("cli_c")).toBeUndefined();
  });
});
