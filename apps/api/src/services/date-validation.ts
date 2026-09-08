import { z } from "zod";

/**
 * Shared date/timestamp validation so work-queue, client-request, and
 * engagement routes reject a garbage string (not just an empty one) with a
 * clean 400 instead of letting it reach Postgres as a malformed
 * TIMESTAMPTZ/DATE literal. Nullable/optional at the call site controls
 * whether the field itself is required; these only validate a non-null
 * value that is actually present.
 */

function isValidTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export const isoTimestampSchema = z.string().refine(isValidTimestamp, { message: "must be a valid timestamp" });

export const calendarDateSchema = z.string().refine(isValidCalendarDate, { message: "must be a valid calendar date (YYYY-MM-DD)" });

// Reuses the existing valid-year standard from services/documents.ts rather than redefining it.
export const taxYearSchema = z.number().int().min(2000).max(2100);
