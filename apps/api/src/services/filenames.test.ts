import { describe, expect, it } from "vitest";
import { sanitizeFilenameSegment, buildWorkbookFilename, buildBankCsvFilename } from "./filenames";

describe("sanitizeFilenameSegment", () => {
  it.each(['a\b', "a/b", "a:b", "a*b", 'a?b', 'a"b', "a<b", "a>b", "a|b"])(
    "replaces the Windows-invalid character in %s",
    (value) => {
      const sanitized = sanitizeFilenameSegment(value);
      expect(sanitized).not.toMatch(/[\/:*?"<>|]/);
    },
  );

  it("trims trailing dots and spaces, which Windows also forbids", () => {
    expect(sanitizeFilenameSegment("Client Name. ")).toBe("Client Name");
  });

  it("never produces an empty filename", () => {
    expect(sanitizeFilenameSegment("///")).toBe("Untitled");
  });
});

describe("buildWorkbookFilename", () => {
  it("produces a deterministic, human-readable filename", () => {
    const filename = buildWorkbookFilename({
      clientName: "Phyllis Client",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      isDraft: false,
    });
    expect(filename).toBe("Phyllis Client - Folio - 2026-01-01 to 2026-12-31.xlsx");
  });

  it("appends DRAFT when the report is incomplete", () => {
    const filename = buildWorkbookFilename({
      clientName: "Phyllis Client",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      isDraft: true,
    });
    expect(filename).toContain("DRAFT");
  });

  it("never uses an opaque UUID as the filename", () => {
    const filename = buildWorkbookFilename({
      clientName: "Bob's Auto / Repair",
      startDate: null,
      endDate: null,
      isDraft: false,
    });
    expect(filename).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(filename).toContain("Bob's Auto");
  });
});

describe("buildBankCsvFilename", () => {
  it("includes the currency and sanitized client name", () => {
    const filename = buildBankCsvFilename({
      clientName: "Phyllis Client",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      currency: "USD",
    });
    expect(filename).toBe("Phyllis Client - Bank Transactions - 2026-01-01 to 2026-01-31 - USD.csv");
  });
});
