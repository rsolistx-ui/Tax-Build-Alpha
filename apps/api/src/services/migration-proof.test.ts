import { describe, expect, it } from "vitest";
import { buildMigrationProof, parseCsvRows } from "./migration-proof";

describe("migration proof", () => {
  it("parses quoted fields and identifies exact duplicate candidates without writing data", () => {
    const proof = buildMigrationProof("transactions", 'Date,Description,Amount\n01/01/2026,"Coffee, client meeting",-12.50\n01/01/2026,"Coffee, client meeting",-12.50\n');
    expect(proof.readyForMappedImport).toBe(true);
    expect(proof.sourceRowCount).toBe(2);
    expect(proof.duplicateCandidateCount).toBe(1);
  });

  it("identifies a missing required header before any import can proceed", () => {
    const proof = buildMigrationProof("transactions", "Date,Description\n01/01/2026,Office supplies\n");
    expect(proof.readyForMappedImport).toBe(false);
    expect(proof.findings).toContainEqual(expect.objectContaining({ severity: "error", message: expect.stringContaining("amount") }));
  });

  it("keeps embedded commas inside a quoted CSV field", () => {
    expect(parseCsvRows('Name,Notes\nAcme,"Main office, suite 200"\n')).toEqual([
      ["Name", "Notes"],
      ["Acme", "Main office, suite 200"],
    ]);
  });
});
