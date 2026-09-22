import { describe, expect, it } from "vitest";
import { isIrsEfileAuthorization } from "./tax-signature-policy";

describe("IRS e-file signature policy", () => {
  it("recognizes Forms 8878 and 8879 without catching ordinary documents", () => {
    expect(isIrsEfileAuthorization("8879")).toBe(true);
    expect(isIrsEfileAuthorization("Form 8878")).toBe(false);
    expect(isIrsEfileAuthorization("8878 - extension")).toBe(true);
    expect(isIrsEfileAuthorization("engagement_letter")).toBe(false);
    expect(isIrsEfileAuthorization(undefined)).toBe(false);
  });
});
