import { describe, expect, it } from "vitest";
import { form1099Threshold } from "./form-1099-threshold";

describe("form1099Threshold", () => {
  it("is $600 for payments made in 2025 and earlier", () => {
    expect(form1099Threshold(2024)).toBe(600);
    expect(form1099Threshold(2025)).toBe(600);
  });
  it("is $2,000 for payments made after December 31, 2025", () => {
    expect(form1099Threshold(2026)).toBe(2000);
    expect(form1099Threshold(2027)).toBe(2000);
  });
});
