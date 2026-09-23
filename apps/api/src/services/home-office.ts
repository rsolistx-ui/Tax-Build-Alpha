/**
 * Home office worksheet. Simplified method: $5 per square foot, up to 300 square feet,
 * limited to gross income from business use of the home less other business expenses,
 * no depreciation, and no carryover of the excess (Rev. Proc. 2013-13; irs.gov
 * "Simplified option for home office deduction", checked 2026-09-23). The space must be
 * used regularly and exclusively for business (IRC § 280A(c)(1)); employees cannot
 * deduct a home office after 2017. The regular method uses Form 8829 with the
 * business-use percentage computed here.
 */
export type HomeOfficeInput = {
  officeSqFt: number;
  homeSqFt?: number | null;
  regularAndExclusiveUse: boolean;
  principalPlaceOrClientMeetings: boolean;
  isEmployee?: boolean;
  grossIncomeFromBusinessUse?: number | null;
  otherBusinessExpenses?: number | null;
};

export function computeHomeOffice(input: HomeOfficeInput) {
  const problems: string[] = [];
  if (input.isEmployee) problems.push("Employees cannot deduct a home office for tax years after 2017.");
  if (!input.regularAndExclusiveUse) problems.push("The space must be used regularly and exclusively for the business (IRC § 280A(c)(1)).");
  if (!input.principalPlaceOrClientMeetings) problems.push("The space must be the principal place of business or a place to meet clients or customers in the normal course of business.");
  if (!(input.officeSqFt > 0)) problems.push("Enter the office square footage.");
  const qualifies = problems.length === 0;

  const sqft = Math.max(0, input.officeSqFt || 0);
  const tentative = Math.min(sqft, 300) * 5;
  const limit = input.grossIncomeFromBusinessUse != null ? Math.max(0, input.grossIncomeFromBusinessUse - (input.otherBusinessExpenses ?? 0)) : null;
  const simplified = qualifies ? (limit == null ? tentative : Math.min(tentative, limit)) : 0;
  const businessUsePercent = input.homeSqFt && input.homeSqFt > 0 ? Math.round((sqft / input.homeSqFt) * 10000) / 100 : null;

  const notes: string[] = [];
  if (sqft > 300) notes.push("The simplified method counts at most 300 square feet.");
  if (limit != null && tentative > limit) notes.push("Limited to gross income from business use less other business expenses; the excess cannot be carried over under the simplified method.");
  if (limit == null) notes.push("Enter gross income from business use of the home to apply the income limit.");
  notes.push("The simplified method allows no depreciation. The regular method (Form 8829) uses actual expenses times the business-use percentage and can carry over disallowed amounts.");

  return { qualifies, problems, simplifiedDeduction: simplified, tentativeSimplified: tentative, incomeLimit: limit, businessUsePercent, notes };
}
