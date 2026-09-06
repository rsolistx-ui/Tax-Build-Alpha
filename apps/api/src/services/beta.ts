/**
 * Beta access: invitation-only registration and server-authoritative
 * entitlement enforcement. Pure logic here (token hashing, status
 * computation, invitation validation) is deliberately free of database
 * access so it can be unit tested directly, mirroring the pnl.ts pattern.
 */

const TOKEN_BYTES = 32;

/** A cryptographically strong, URL-safe random invitation token. Never stored in plaintext. */
export function generateInviteToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 hash of a token, hex-encoded. Only this hash is ever persisted. */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type InvitationStatus = "pending" | "redeemed" | "revoked" | "expired";

export type InvitationRow = {
  id: string;
  email: string;
  status: InvitationStatus;
  expiresAt: string;
  redeemedAt: string | null;
};

export type InvitationValidationResult =
  | { ok: true }
  | { ok: false; reason: "NOT_FOUND" | "ALREADY_REDEEMED" | "REVOKED" | "EXPIRED" | "EMAIL_MISMATCH" };

/**
 * Every rule an invitation redemption must satisfy, decided from already-
 * fetched data (never trusts a client-supplied flag): the invitation must
 * exist, be pending (not already redeemed, revoked, or previously expired),
 * not have passed its expiry instant, and the signup email must match the
 * invited email case-insensitively.
 */
export function validateInvitationRedemption(
  invitation: InvitationRow | null,
  signupEmail: string,
  now: Date,
): InvitationValidationResult {
  if (!invitation) return { ok: false, reason: "NOT_FOUND" };
  if (invitation.status === "redeemed") return { ok: false, reason: "ALREADY_REDEEMED" };
  if (invitation.status === "revoked") return { ok: false, reason: "REVOKED" };
  if (invitation.status === "expired" || new Date(invitation.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, reason: "EXPIRED" };
  }
  if (invitation.email.trim().toLowerCase() !== signupEmail.trim().toLowerCase()) {
    return { ok: false, reason: "EMAIL_MISMATCH" };
  }
  return { ok: true };
}

export type EntitlementStatus = "active" | "expired" | "revoked";

export type EntitlementRow = {
  status: EntitlementStatus;
  expiresAt: string;
};

export type AccessDenialReason = "BETA_EXPIRED" | "BETA_REVOKED" | "BETA_REQUIRED";

export type AccessDecision = { allowed: true } | { allowed: false; reason: AccessDenialReason };

/**
 * The server is the sole authority on whether an entitlement currently
 * grants access. A row stored as "active" whose expires_at has already
 * passed is treated as expired here regardless of what the client, the
 * installer, or any local clock claims - expiry is a computed fact, not a
 * trusted flag.
 */
export function computeAccessDecision(entitlement: EntitlementRow | null, now: Date): AccessDecision {
  if (!entitlement) return { allowed: false, reason: "BETA_REQUIRED" };
  if (entitlement.status === "revoked") return { allowed: false, reason: "BETA_REVOKED" };
  if (entitlement.status === "expired") return { allowed: false, reason: "BETA_EXPIRED" };
  if (new Date(entitlement.expiresAt).getTime() <= now.getTime()) {
    return { allowed: false, reason: "BETA_EXPIRED" };
  }
  return { allowed: true };
}

export const DEFAULT_BETA_DAYS = 30;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
