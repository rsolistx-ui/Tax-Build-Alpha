import { describe, expect, it } from "vitest";
import { computeHomeOffice } from "./home-office";

describe("home office (Rev. Proc. 2013-13, IRC § 280A)", () => {
  const base = { officeSqFt: 200, homeSqFt: 2000, regularAndExclusiveUse: true, principalPlaceOrClientMeetings: true };
  it("allows $5 per square foot up to 300 square feet", () => {
    expect(computeHomeOffice(base).simplifiedDeduction).toBe(1000);
    expect(computeHomeOffice({ ...base, officeSqFt: 400 }).simplifiedDeduction).toBe(1500);
  });
  it("limits to gross income from business use less other expenses", () => {
    expect(computeHomeOffice({ ...base, grossIncomeFromBusinessUse: 3000, otherBusinessExpenses: 2400 }).simplifiedDeduction).toBe(600);
  });
  it("computes the business-use percentage for Form 8829", () => {
    expect(computeHomeOffice(base).businessUsePercent).toBe(10);
  });
  it("disallows employees and non-exclusive use", () => {
    expect(computeHomeOffice({ ...base, isEmployee: true }).simplifiedDeduction).toBe(0);
    expect(computeHomeOffice({ ...base, regularAndExclusiveUse: false }).qualifies).toBe(false);
  });
});
