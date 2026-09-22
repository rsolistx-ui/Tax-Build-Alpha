import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../db";
import { WaveSafeImportService } from "./wave-safe-import";

const databaseUrl = process.env.WAVE_IMPORT_INTEGRATION_URL;
const suite = databaseUrl ? describe : describe.skip;
const firmId = `verify_wave_${crypto.randomUUID().replaceAll("-", "")}`;
const db = databaseUrl ? createDb({ DATABASE_URL: databaseUrl }) : null;

suite("WaveSafeImportService against an isolated Neon branch", () => {
  afterAll(async () => {
    if (db) await db.query(`DELETE FROM firms WHERE id=$1`, [firmId]);
  });

  it("imports Wave contacts, accounts, invoices, vendors, and bills as durable draft records", async () => {
    if (!db) throw new Error("Integration database is not configured");
    await db.query(`INSERT INTO firms (id, name, owner_user_id) VALUES ($1,$2,$3)`, [firmId, "Truepost isolated migration verification", "verify_owner"]);
    const importer = new WaveSafeImportService(db);

    const customerImport = await importer.importCsv({ firmId, sourceType: "customers", filename: "Customers.csv", csv: "Name,Email,Phone\nSample Client,sample@example.com,555-0100\n" });
    expect(customerImport.failedRows).toEqual([]);
    expect(customerImport.createdCount).toBe(1);
    expect((await importer.importCsv({ firmId, sourceType: "vendors", filename: "Vendors.csv", csv: "Name,Email,Phone\nSample Vendor,vendor@example.com,555-0101\n" })).createdCount).toBe(1);
    expect((await importer.importCsv({ firmId, sourceType: "chart_of_accounts", filename: "Chart.csv", csv: "Account Number,Account Name,Account Type\n6100,Software subscriptions,Expense\n" })).createdCount).toBe(1);
    const invoiceImport = await importer.importCsv({ firmId, sourceType: "invoices", filename: "Invoices.csv", csv: "Invoice Number,Customer Name,Invoice Date,Due Date,Total\nWAVE-VERIFY-001,Sample Client,09/21/2026,10/21/2026,125.00\n" });
    expect(invoiceImport.failedRows).toEqual([]);
    expect(invoiceImport.createdCount).toBe(1);
    expect((await importer.importCsv({ firmId, sourceType: "bills", filename: "Bills.csv", csv: "Bill Number,Vendor Name,Bill Date,Due Date,Total\nWAVE-BILL-001,Sample Vendor,09/21/2026,10/21/2026,45.00\n" })).createdCount).toBe(1);

    expect((await db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM clients WHERE firm_id=$1`, [firmId]))[0]?.count).toBe(1);
    expect((await db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM vendors WHERE firm_id=$1`, [firmId]))[0]?.count).toBe(1);
    expect((await db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM accounts WHERE firm_id=$1`, [firmId]))[0]?.count).toBe(1);
    expect((await db.query<{ status: string }>(`SELECT status FROM invoices WHERE firm_id=$1`, [firmId]))[0]?.status).toBe("draft");
    expect((await db.query<{ status: string }>(`SELECT status FROM bills WHERE firm_id=$1`, [firmId]))[0]?.status).toBe("draft");

    const replay = await importer.importCsv({ firmId, sourceType: "customers", filename: "Customers.csv", csv: "Name,Email,Phone\nSample Client,sample@example.com,555-0100\n" });
    expect(replay).toMatchObject({ createdCount: 0, skippedCount: 1, failedRows: [] });
  });
});
