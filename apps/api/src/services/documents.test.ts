import { describe, expect, it } from "vitest";
import {
  generateChecklist,
  suggestDocumentType,
  isDuplicateCandidate,
  isValidDocumentType,
  isValidChecklistStatus,
  sha256Hex,
} from "./documents";

describe("generateChecklist", () => {
  it("produces no checklist when tax preparation is not required", () => {
    expect(generateChecklist({ entityType: "llc", taxPrepRequired: false, hasBankActivity: true, priorYearReturnAvailable: true })).toEqual([]);
  });

  it("includes prior-year return unless explicitly marked unavailable", () => {
    const items = generateChecklist({ entityType: "sole_proprietor", taxPrepRequired: true, hasBankActivity: false, priorYearReturnAvailable: null });
    expect(items.some((i) => i.docType === "prior_year_return")).toBe(true);
  });

  it("omits prior-year return when explicitly marked unavailable", () => {
    const items = generateChecklist({ entityType: "sole_proprietor", taxPrepRequired: true, hasBankActivity: false, priorYearReturnAvailable: false });
    expect(items.some((i) => i.docType === "prior_year_return")).toBe(false);
  });

  it("adds K-1 only for pass-through/corporate entity types", () => {
    const sCorp = generateChecklist({ entityType: "s_corp", taxPrepRequired: true, hasBankActivity: true, priorYearReturnAvailable: true });
    expect(sCorp.some((i) => i.docType === "k1")).toBe(true);
    const soleProp = generateChecklist({ entityType: "sole_proprietor", taxPrepRequired: true, hasBankActivity: true, priorYearReturnAvailable: true });
    expect(soleProp.some((i) => i.docType === "k1")).toBe(false);
  });

  it("adds bank statements only when there is bank activity", () => {
    const withActivity = generateChecklist({ entityType: "llc", taxPrepRequired: true, hasBankActivity: true, priorYearReturnAvailable: true });
    expect(withActivity.some((i) => i.docType === "bank_statements")).toBe(true);
    const without = generateChecklist({ entityType: "llc", taxPrepRequired: true, hasBankActivity: false, priorYearReturnAvailable: true });
    expect(without.some((i) => i.docType === "bank_statements")).toBe(false);
  });

  it("is deterministic - the same input always produces the same checklist", () => {
    const input = { entityType: "llc", taxPrepRequired: true, hasBankActivity: true, priorYearReturnAvailable: true };
    expect(generateChecklist(input)).toEqual(generateChecklist(input));
  });
});

describe("suggestDocumentType", () => {
  it.each([
    ["2025-w2-employer.pdf", "tax_document"],
    ["1099-nec-2025.pdf", "tax_document"],
    ["bank-statement-january.pdf", "bank_statement"],
    ["2024-tax-return.pdf", "prior_year_return"],
    ["payroll-summary-q1.pdf", "payroll_document"],
    ["mortgage-loan-statement.pdf", "loan_document"],
    ["articles-of-organization.pdf", "formation_document"],
    ["office-depot-receipt.jpg", "receipt"],
    ["random-file.pdf", "other"],
  ] as const)("suggests %s -> %s", (filename, expected) => {
    expect(suggestDocumentType(filename)).toBe(expected);
  });
});

describe("isDuplicateCandidate", () => {
  it("flags a hash that already exists among a client's documents", () => {
    expect(isDuplicateCandidate("abc123", ["def456", "abc123"])).toBe(true);
  });

  it("does not flag a hash with no existing match", () => {
    expect(isDuplicateCandidate("abc123", ["def456"])).toBe(false);
  });
});

describe("isValidDocumentType / isValidChecklistStatus", () => {
  it("rejects unknown document types and checklist statuses", () => {
    expect(isValidDocumentType("ssn_scan")).toBe(false);
    expect(isValidChecklistStatus("approved")).toBe(false);
  });

  it("accepts every documented checklist status", () => {
    for (const status of ["expected", "requested", "received", "reviewed", "not_applicable"]) {
      expect(isValidChecklistStatus(status)).toBe(true);
    }
  });
});

describe("sha256Hex", () => {
  it("produces a stable, deterministic hash for the same bytes", async () => {
    const bytes = new TextEncoder().encode("folio-document-fixture").buffer as ArrayBuffer;
    const first = await sha256Hex(bytes);
    const second = await sha256Hex(bytes);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different hashes for different content", async () => {
    const a = await sha256Hex(new TextEncoder().encode("a").buffer as ArrayBuffer);
    const b = await sha256Hex(new TextEncoder().encode("b").buffer as ArrayBuffer);
    expect(a).not.toBe(b);
  });
});
