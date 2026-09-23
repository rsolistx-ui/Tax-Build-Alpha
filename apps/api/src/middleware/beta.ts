import { createMiddleware } from "hono/factory";
import type { Env } from "../env";
import type { AuthedVars } from "./session";
import { createDb } from "../db";
import { computeAccessDecision, type EntitlementRow } from "../services/beta";
import { insertBetaAccessEvent } from "../services/beta-db";
import { getCookie } from "hono/cookie";
import { ADMIN_UNLOCK_COOKIE, isValidAdminUnlock, turnstileConfigured } from "../services/admin-unlock";

export function isOwnerEmail(env: Env, email: string): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  const owner = env.OWNER_EMAIL?.trim().toLowerCase();
  const power = env.POWER_USER_EMAIL?.trim().toLowerCase();
  return (Boolean(owner) && normalized === owner) || (Boolean(power) && normalized === power);
}

/** Validates 64-character hex master token with constant-time comparison against timing attacks. */
export function isValidAdminMasterToken(env: Env, tokenHeader?: string | null): boolean {
  if (!env.ADMIN_MASTER_TOKEN) return false;
  if (!tokenHeader) return false;
  const expected = env.ADMIN_MASTER_TOKEN.trim().toLowerCase();
  const provided = tokenHeader.trim().toLowerCase();
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Every protected business API route must pass through this. The owner and power users
 * are never gated by an entitlement (they possess lifetime platform access).
 * Everyone else needs an active entitlement evaluated strictly against Neon server time.
 */
export const requireActiveBeta = createMiddleware<{ Bindings: Env; Variables: AuthedVars }>(async (c, next) => {
  if (isOwnerEmail(c.env, c.get("userEmail"))) {
    await next();
    return;
  }

  const db = createDb(c.env);
  const userId = c.get("userId");
  const [row] = await db.query<{ status: string; expires_at: string }>(
    `SELECT status, expires_at FROM beta_entitlements WHERE user_id = $1`,
    [userId],
  );
  const entitlement: EntitlementRow | null = row
    ? { status: row.status as EntitlementRow["status"], expiresAt: row.expires_at }
    : null;
  const decision = computeAccessDecision(entitlement, new Date());

  if (!decision.allowed) {
    if (row && row.status === "active" && decision.reason === "BETA_EXPIRED") {
      await db.query(
        `UPDATE beta_entitlements SET status = 'expired', updated_at = NOW() WHERE user_id = $1 AND status = 'active'`,
        [userId],
      );
      await insertBetaAccessEvent(db, {
        action: "beta_access_expired",
        actorUserId: null,
        affectedUserId: userId,
        affectedEmail: c.get("userEmail"),
        beforeJson: { status: "active", expiresAt: row.expires_at },
        afterJson: { status: "expired" },
        reason: "Entitlement expiry reached at request time.",
      });
    }
    return c.json({ error: "Beta access required", code: decision.reason }, 403);
  }

  await next();
});

export const requireOwner = createMiddleware<{ Bindings: Env; Variables: AuthedVars }>(async (c, next) => {
  const tokenHeader = c.req.header("x-admin-token");
  const hasValidToken = isValidAdminMasterToken(c.env, tokenHeader);

  // A token is an additional factor, never an identity or an elevation path.
  // The caller must first hold a real session for the configured owner/power
  // user email. This makes a stolen token insufficient on its own.
  if (!isOwnerEmail(c.env, c.get("userEmail"))) {
    return c.json({ error: "Owner access required", code: "OWNER_REQUIRED" }, 403);
  }

  if (c.env.ADMIN_MASTER_TOKEN && !hasValidToken) {
    return c.json({
      error: "Admin master security token required",
      code: "MASTER_TOKEN_REQUIRED",
    }, 403);
  }

  // With Turnstile configured, the admin panel also needs the pass issued by POST /api/admin-unlock.
  if (turnstileConfigured(c.env) && !(await isValidAdminUnlock(c.env, c.get("userId"), getCookie(c, ADMIN_UNLOCK_COOKIE)))) {
    return c.json({ error: "Complete the admin security check to continue.", code: "ADMIN_UNLOCK_REQUIRED" }, 403);
  }

  await next();
});
