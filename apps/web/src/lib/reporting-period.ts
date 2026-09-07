/**
 * The single definition of reporting-period semantics used everywhere in
 * Folio's UI (the P&L tab and the Export Center). Never redefine "this
 * month", "last month", "year to date", or "tax year" a second way.
 */
export type ReportingPeriodPreset = "current_month" | "previous_month" | "ytd" | "tax_year" | "custom";

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function presetRange(preset: ReportingPeriodPreset, taxYear: number | null): { startDate: string; endDate: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  if (preset === "current_month") {
    return { startDate: isoDate(new Date(year, month, 1)), endDate: isoDate(new Date(year, month + 1, 0)) };
  }
  if (preset === "previous_month") {
    return { startDate: isoDate(new Date(year, month - 1, 1)), endDate: isoDate(new Date(year, month, 0)) };
  }
  if (preset === "tax_year") {
    const ty = taxYear || year;
    return { startDate: `${ty}-01-01`, endDate: `${ty}-12-31` };
  }
  // year to date
  return { startDate: `${year}-01-01`, endDate: isoDate(now) };
}

export const REPORTING_PERIOD_OPTIONS: Array<[ReportingPeriodPreset, string]> = [
  ["current_month", "This month"],
  ["previous_month", "Last month"],
  ["ytd", "Year to date"],
  ["tax_year", "Tax year"],
  ["custom", "Custom range"],
];
