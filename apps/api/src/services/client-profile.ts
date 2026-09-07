/**
 * Professional client intake fields, stored in the existing
 * client_profiles.profile JSONB column so shared context (contact info,
 * bookkeeping cadence, tax-prep requirements) is entered once and reused
 * everywhere else in Folio rather than re-collected per workflow.
 */
export const ALLOWED_PROFILE_FIELDS = [
  "dba",
  "primaryContactName",
  "contactEmail",
  "contactPhone",
  "einLast4",
  "bookkeepingStartDate",
  "bookkeepingFrequency",
  "taxPrepRequired",
  "priorYearReturnAvailable",
  "notes",
  "knownAccountSources",
] as const;

export type AllowedProfileField = (typeof ALLOWED_PROFILE_FIELDS)[number];
export type ClientProfileInput = Partial<Record<AllowedProfileField, unknown>>;

/**
 * Folio does not need, and must never accept, full SSNs, bank credentials,
 * or passwords. This check runs over every submitted key - including keys
 * outside the allow-list - so a client cannot smuggle sensitive data in
 * under an unexpected field name.
 */
const FORBIDDEN_FIELD_PATTERN = /ssn|social.?security|bank.?password|bank.?credential|routing.?number|full.?account.?number|full.?ein/i;

export type ProfileValidationResult =
  | { ok: true; sanitized: ClientProfileInput }
  | { ok: false; error: string };

export function validateProfileInput(input: Record<string, unknown>): ProfileValidationResult {
  const sanitized: ClientProfileInput = {};
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN_FIELD_PATTERN.test(key)) {
      return { ok: false, error: `Field "${key}" is not permitted in the client profile` };
    }
    if (!(ALLOWED_PROFILE_FIELDS as readonly string[]).includes(key)) continue;
    if (key === "einLast4" && value != null && !(typeof value === "string" && /^\d{0,4}$/.test(value))) {
      return { ok: false, error: "einLast4 must be at most 4 digits" };
    }
    if (key === "contactEmail" && value != null && !(typeof value === "string" && (value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))) {
      return { ok: false, error: "contactEmail must be a valid email address" };
    }
    sanitized[key as AllowedProfileField] = value;
  }
  return { ok: true, sanitized };
}

export function mergeProfile(existing: Record<string, unknown>, incoming: ClientProfileInput): Record<string, unknown> {
  return { ...existing, ...incoming };
}
