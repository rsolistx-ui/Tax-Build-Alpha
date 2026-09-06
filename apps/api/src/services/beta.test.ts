import { describe, expect, it } from "vitest";
import {
  generateInviteToken,
  hashToken,
  validateInvitationRedemption,
  computeAccessDecision,
  isInvitationExpiredButStillPending,
  canRevokeInvitation,
  addDays,
  DEFAULT_BETA_DAYS,
  type InvitationRow,
  type EntitlementRow,
} from "./beta";

describe("generateInviteToken / hashToken", () => {
  it("generates a sufficiently long, URL-safe random token", () => {
    const token = generateInviteToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates a different token every call", () => {
    expect(generateInviteToken()).not.toBe(generateInviteToken());
  });

  it("hashes the same token to the same value", async () => {
    const token = "fixed-test-token";
    expect(await hashToken(token)).toBe(await hashToken(token));
  });

  it("hashes different tokens to different values", async () => {
    expect(await hashToken("token-a")).not.toBe(await hashToken("token-b"));
  });

  it("never returns the plaintext token as its own hash", async () => {
    const token = "fixed-test-token";
    expect(await hashToken(token)).not.toBe(token);
  });
});

function invitation(overrides: Partial<InvitationRow> = {}): InvitationRow {
  return {
    id: "biv_1",
    email: "phyllis@example.com",
    status: "pending",
    expiresAt: "2099-01-01T00:00:00.000Z",
    redeemedAt: null,
    ...overrides,
  };
}

describe("validateInvitationRedemption", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");

  it("accepts a pending, unexpired invitation with a matching email", () => {
    expect(validateInvitationRedemption(invitation(), "phyllis@example.com", now)).toEqual({ ok: true });
  });

  it("accepts a matching email case-insensitively", () => {
    expect(validateInvitationRedemption(invitation(), "PHYLLIS@EXAMPLE.COM", now)).toEqual({ ok: true });
  });

  it("rejects when no invitation is found", () => {
    expect(validateInvitationRedemption(null, "phyllis@example.com", now)).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("rejects a wrong email even if the token itself is otherwise valid", () => {
    expect(validateInvitationRedemption(invitation(), "someone-else@example.com", now)).toEqual({
      ok: false,
      reason: "EMAIL_MISMATCH",
    });
  });

  it("rejects an already-redeemed invitation", () => {
    expect(validateInvitationRedemption(invitation({ status: "redeemed" }), "phyllis@example.com", now)).toEqual({
      ok: false,
      reason: "ALREADY_REDEEMED",
    });
  });

  it("rejects a revoked invitation", () => {
    expect(validateInvitationRedemption(invitation({ status: "revoked" }), "phyllis@example.com", now)).toEqual({
      ok: false,
      reason: "REVOKED",
    });
  });

  it("rejects an expired invitation by stored status", () => {
    expect(validateInvitationRedemption(invitation({ status: "expired" }), "phyllis@example.com", now)).toEqual({
      ok: false,
      reason: "EXPIRED",
    });
  });

  it("rejects an invitation whose expiry instant has passed even if status still says pending", () => {
    const expired = invitation({ expiresAt: "2020-01-01T00:00:00.000Z" });
    expect(validateInvitationRedemption(expired, "phyllis@example.com", now)).toEqual({ ok: false, reason: "EXPIRED" });
  });
});


describe("isInvitationExpiredButStillPending", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");

  it("is true for a pending invitation whose expiry instant has passed", () => {
    const inv = invitation({ status: "pending", expiresAt: "2020-01-01T00:00:00.000Z" });
    expect(isInvitationExpiredButStillPending(inv, now)).toBe(true);
  });

  it("is false for a pending invitation that has not yet expired", () => {
    const inv = invitation({ status: "pending", expiresAt: "2099-01-01T00:00:00.000Z" });
    expect(isInvitationExpiredButStillPending(inv, now)).toBe(false);
  });

  it("is false for an already-redeemed invitation even if its expiry has passed", () => {
    const inv = invitation({ status: "redeemed", expiresAt: "2020-01-01T00:00:00.000Z" });
    expect(isInvitationExpiredButStillPending(inv, now)).toBe(false);
  });

  it("is false for an already-revoked invitation", () => {
    const inv = invitation({ status: "revoked", expiresAt: "2020-01-01T00:00:00.000Z" });
    expect(isInvitationExpiredButStillPending(inv, now)).toBe(false);
  });

  it("is false for an invitation already marked expired", () => {
    const inv = invitation({ status: "expired", expiresAt: "2020-01-01T00:00:00.000Z" });
    expect(isInvitationExpiredButStillPending(inv, now)).toBe(false);
  });
});

describe("canRevokeInvitation", () => {
  it("allows revoking a pending invitation", () => {
    expect(canRevokeInvitation("pending")).toBe(true);
  });

  it("refuses to revoke a redeemed invitation", () => {
    expect(canRevokeInvitation("redeemed")).toBe(false);
  });

  it("refuses to revoke an already-revoked invitation", () => {
    expect(canRevokeInvitation("revoked")).toBe(false);
  });

  it("refuses to revoke an expired invitation", () => {
    expect(canRevokeInvitation("expired")).toBe(false);
  });
});

describe("computeAccessDecision", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");

  it("denies access with BETA_REQUIRED when there is no entitlement at all", () => {
    expect(computeAccessDecision(null, now)).toEqual({ allowed: false, reason: "BETA_REQUIRED" });
  });

  it("allows access for an active, unexpired entitlement", () => {
    const entitlement: EntitlementRow = { status: "active", expiresAt: "2099-01-01T00:00:00.000Z" };
    expect(computeAccessDecision(entitlement, now)).toEqual({ allowed: true });
  });

  it("denies access with BETA_REVOKED for a revoked entitlement regardless of its expiry date", () => {
    const entitlement: EntitlementRow = { status: "revoked", expiresAt: "2099-01-01T00:00:00.000Z" };
    expect(computeAccessDecision(entitlement, now)).toEqual({ allowed: false, reason: "BETA_REVOKED" });
  });

  it("denies access with BETA_EXPIRED for a stored expired status", () => {
    const entitlement: EntitlementRow = { status: "expired", expiresAt: "2020-01-01T00:00:00.000Z" };
    expect(computeAccessDecision(entitlement, now)).toEqual({ allowed: false, reason: "BETA_EXPIRED" });
  });

  it("denies access with BETA_EXPIRED once the expiry instant has passed even if status still says active", () => {
    const entitlement: EntitlementRow = { status: "active", expiresAt: "2020-01-01T00:00:00.000Z" };
    expect(computeAccessDecision(entitlement, now)).toEqual({ allowed: false, reason: "BETA_EXPIRED" });
  });

  it("changing the reference clock cannot extend a genuinely expired entitlement", () => {
    const entitlement: EntitlementRow = { status: "active", expiresAt: "2026-01-01T00:00:00.000Z" };
    const farFuture = new Date("2030-01-01T00:00:00.000Z");
    expect(computeAccessDecision(entitlement, farFuture)).toEqual({ allowed: false, reason: "BETA_EXPIRED" });
  });
});

describe("addDays / DEFAULT_BETA_DAYS", () => {
  it("adds the default 30 days correctly", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const result = addDays(start, DEFAULT_BETA_DAYS);
    expect(result.toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });
});
