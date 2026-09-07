/**
 * Deterministic, human-readable filenames for professional downloads.
 * Windows forbids \ / : * ? " < > | in filenames and trailing dots/spaces;
 * this never produces an opaque UUID filename for a user-facing download.
 */
const WINDOWS_INVALID_CHARS = /[\/:*?"<>|]/g;
const RESERVED_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

export function sanitizeFilenameSegment(value: string): string {
  const cleaned = value
    .replace(WINDOWS_INVALID_CHARS, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  if (cleaned.length === 0 || cleaned.replace(/-/g, "").trim().length === 0) return "Untitled";
  if (RESERVED_NAMES.has(cleaned.toUpperCase())) return `${cleaned}_`;
  return cleaned;
}

export function buildWorkbookFilename(input: {
  clientName: string;
  startDate: string | null;
  endDate: string | null;
  isDraft: boolean;
}): string {
  const period =
    input.startDate && input.endDate
      ? `${input.startDate} to ${input.endDate}`
      : input.startDate
        ? `from ${input.startDate}`
        : input.endDate
          ? `through ${input.endDate}`
          : "All Dates";
  const draftSuffix = input.isDraft ? " DRAFT" : "";
  return `${sanitizeFilenameSegment(input.clientName)} - Folio - ${sanitizeFilenameSegment(period)}${draftSuffix}.xlsx`;
}

export function buildWaveCsvFilename(input: {
  clientName: string;
  startDate: string | null;
  endDate: string | null;
  currency: string;
}): string {
  const period =
    input.startDate && input.endDate
      ? `${input.startDate} to ${input.endDate}`
      : input.startDate
        ? `from ${input.startDate}`
        : input.endDate
          ? `through ${input.endDate}`
          : "All Dates";
  return `${sanitizeFilenameSegment(input.clientName)} - Wave Statement - ${sanitizeFilenameSegment(period)} - ${sanitizeFilenameSegment(input.currency)}.csv`;
}
