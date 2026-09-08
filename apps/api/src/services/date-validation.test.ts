import { describe, expect, it } from "vitest";
import { calendarDateSchema, isoTimestampSchema, taxYearSchema } from "./date-validation";

describe("isoTimestampSchema", () => {
  it("accepts a valid ISO timestamp", () => {
    expect(isoTimestampSchema.safeParse("2026-04-15T00:00:00Z").success).toBe(true);
  });
  it("accepts a valid date-only string (parseable by Date.parse)", () => {
    expect(isoTimestampSchema.safeParse("2026-04-15").success).toBe(true);
  });
  it("rejects an arbitrary non-date string", () => {
    expect(isoTimestampSchema.safeParse("not-a-date").success).toBe(false);
  });
  it("rejects an empty string", () => {
    expect(isoTimestampSchema.safeParse("").success).toBe(false);
  });
  it("rejects an impossible calendar date instead of letting Date.parse roll it forward (Feb 30)", () => {
    expect(isoTimestampSchema.safeParse("2026-02-30").success).toBe(false);
  });
  it("rejects an impossible calendar date with a time portion attached", () => {
    expect(isoTimestampSchema.safeParse("2026-02-30T00:00:00Z").success).toBe(false);
  });
});

describe("calendarDateSchema", () => {
  it("accepts a valid calendar date", () => {
    expect(calendarDateSchema.safeParse("2026-04-15").success).toBe(true);
  });
  it("rejects an impossible calendar date (Feb 30)", () => {
    expect(calendarDateSchema.safeParse("2026-02-30").success).toBe(false);
  });
  it("rejects a malformed date string", () => {
    expect(calendarDateSchema.safeParse("04/15/2026").success).toBe(false);
  });
  it("rejects a non-date string entirely", () => {
    expect(calendarDateSchema.safeParse("tomorrow").success).toBe(false);
  });
});

describe("taxYearSchema", () => {
  it("accepts a year within the valid range", () => {
    expect(taxYearSchema.safeParse(2025).success).toBe(true);
  });
  it("rejects a year below the valid range", () => {
    expect(taxYearSchema.safeParse(1999).success).toBe(false);
  });
  it("rejects a year above the valid range", () => {
    expect(taxYearSchema.safeParse(2101).success).toBe(false);
  });
  it("rejects a non-integer", () => {
    expect(taxYearSchema.safeParse(2025.5).success).toBe(false);
  });
});
