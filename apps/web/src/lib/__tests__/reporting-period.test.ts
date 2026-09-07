import { describe, expect, it, vi, afterEach } from "vitest";
import { presetRange } from "../reporting-period";

describe("presetRange", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("current_month spans the first to last day of the current calendar month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15));
    expect(presetRange("current_month", null)).toEqual({ startDate: "2026-03-01", endDate: "2026-03-31" });
  });

  it("previous_month spans the prior calendar month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15));
    expect(presetRange("previous_month", null)).toEqual({ startDate: "2026-02-01", endDate: "2026-02-28" });
  });

  it("tax_year uses the client's configured tax year when set", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15));
    expect(presetRange("tax_year", 2025)).toEqual({ startDate: "2025-01-01", endDate: "2025-12-31" });
  });

  it("ytd spans January 1st through today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15));
    expect(presetRange("ytd", null)).toEqual({ startDate: "2026-01-01", endDate: "2026-03-15" });
  });
});
