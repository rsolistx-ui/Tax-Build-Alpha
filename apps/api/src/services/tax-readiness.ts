/**
 * Tax-year preparation readiness is distinct from bookkeeping readiness.
 * Folio may suggest a state deterministically from known client state, but
 * only the professional may set - or the software may suggest without ever
 * silently applying - a state that implies professional approval
 * (ready_for_preparation, preparation_started, complete).
 */
export const TAX_READINESS_STATES = [
  "not_started",
  "collecting_documents",
  "bookkeeping_incomplete",
  "professional_review",
  "ready_for_preparation",
  "preparation_started",
  "complete",
] as const;

export type TaxReadinessState = (typeof TAX_READINESS_STATES)[number];

const PROFESSIONAL_APPROVAL_STATES = new Set<TaxReadinessState>([
  "ready_for_preparation",
  "preparation_started",
  "complete",
]);

export function isValidReadinessState(value: string): value is TaxReadinessState {
  return (TAX_READINESS_STATES as readonly string[]).includes(value);
}

export function isProfessionalApprovalState(state: TaxReadinessState): boolean {
  return PROFESSIONAL_APPROVAL_STATES.has(state);
}

export type ReadinessSuggestionInput = {
  taxPrepRequired: boolean;
  bookkeepingComplete: boolean;
  totalChecklistItems: number;
  receivedOrReviewedChecklistItems: number;
};

export function suggestReadinessState(input: ReadinessSuggestionInput | readonly any[]): TaxReadinessState {
  if (Array.isArray(input)) {
    if (input.some((d: any) => d?.severity === "error")) return "professional_review";
    const hasWarning = input.some((d: any) => d?.severity === "warning");
    return hasWarning ? "collecting_documents" : "professional_review";
  }
  const r = input as ReadinessSuggestionInput;
  if (!r.taxPrepRequired) return "not_started";
  if (!r.bookkeepingComplete) return "bookkeeping_incomplete";
  if (r.totalChecklistItems === 0) return "collecting_documents";
  if (r.receivedOrReviewedChecklistItems < r.totalChecklistItems) return "collecting_documents";
  return "professional_review";
}
