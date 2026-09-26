import { describe, expect, it } from "vitest";
import { buildMigrationProof } from "./migration-proof";

describe("migration proof", () => {
  it("recognizes the standard QuickBooks invoice export labels", () => {
    const proof = buildMigrationProof("invoices", "Transaction Number,Customer,Transaction Date,Amount\nINV-12,Northwind,01/20/2026,125.00\n");
    expect(proof.readyForMappedImport).toBe(true);
  });

  it("requires the three reference fields in a prior-year tax export", () => {
    const proof = buildMigrationProof("prior_year_tax_summary", "Tax Year,AGI,Total Tax\n2025,90000,12000\n");
    expect(proof.readyForMappedImport).toBe(true);
  });
});
