import { describe, expect, it } from "vitest";
import {
  TAX_READINESS_STATES,
  isValidReadinessState,
  isProfessionalApprovalState,
  suggestReadinessState,
} from "./tax-readiness";

describe("isValidReadinessState", () => {
  it("accepts every documented state", () => {
    for (const state of TAX_READINESS_STATES) expect(isValidReadinessState(state)).toBe(true);
  });

  it("rejects an unknown state", () => {
    expect(isValidReadinessState("approved_by_ai")).toBe(false);
  });
});

describe("isProfessionalApprovalState", () => {
  it("flags the three states that imply professional approval", () => {
    expect(isProfessionalApprovalState("ready_for_preparation")).toBe(true);
    expect(isProfessionalApprovalState("preparation_started")).toBe(true);
    expect(isProfessionalApprovalState("complete")).toBe(true);
  });

  it("does not flag earlier workflow states", () => {
    expect(isProfessionalApprovalState("not_started")).toBe(false);
    expect(isProfessionalApprovalState("bookkeeping_incomplete")).toBe(false);
    expect(isProfessionalApprovalState("professional_review")).toBe(false);
  });
});

describe("suggestReadinessState", () => {
  it("never suggests a professional-approval state - the suggestion tops out at professional_review", () => {
    const suggestion = suggestReadinessState({
      taxPrepRequired: true,
      bookkeepingComplete: true,
      totalChecklistItems: 3,
      receivedOrReviewedChecklistItems: 3,
    });
    expect(isProfessionalApprovalState(suggestion)).toBe(false);
    expect(suggestion).toBe("professional_review");
  });

  it("suggests not_started when tax preparation is not required", () => {
    expect(suggestReadinessState({ taxPrepRequired: false, bookkeepingComplete: true, totalChecklistItems: 0, receivedOrReviewedChecklistItems: 0 })).toBe("not_started");
  });

  it("suggests bookkeeping_incomplete when books are not done, even with all documents received", () => {
    expect(suggestReadinessState({ taxPrepRequired: true, bookkeepingComplete: false, totalChecklistItems: 2, receivedOrReviewedChecklistItems: 2 })).toBe("bookkeeping_incomplete");
  });

  it("suggests collecting_documents when books are complete but documents are still outstanding", () => {
    expect(suggestReadinessState({ taxPrepRequired: true, bookkeepingComplete: true, totalChecklistItems: 3, receivedOrReviewedChecklistItems: 1 })).toBe("collecting_documents");
  });

  it("bookkeeping complete does not imply tax readiness - a separate signal governs each", () => {
    const booksComplete = suggestReadinessState({ taxPrepRequired: true, bookkeepingComplete: true, totalChecklistItems: 1, receivedOrReviewedChecklistItems: 0 });
    expect(booksComplete).toBe("collecting_documents");
    expect(booksComplete).not.toBe("complete");
  });
});
