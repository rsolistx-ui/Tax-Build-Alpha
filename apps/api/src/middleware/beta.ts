import { createMiddleware } from "hono/factory";
import type { Env } from "../env";
import type { AuthedVars } from "./session";
import { createDb } from "../db";
import { computeAccessDecision, type EntitlementRow } from "../services/beta";
import { insertBetaAccessEvent } from "../services/beta-db";

export function isOwnerEmail(env: Env, email: string): boolean {
  return Boolean(env.OWNER_EMAIL) && email.trim().toLowerCase() === env.OWNER_EMAIL!.trim().toLowerCase();
}

/**
 * Every protected business API route must pass through this. The owner is
 * never gated by an entitlement (they administer beta access, they don't
 * consume it). Everyone else needs an entitlement row whose computed status
 * is active right now - never trusting a client flag, the local clock, or a
 * cached value. An entitlement that has just crossed its expiry is
 * lazily transitioned to "expired" here so it never silently keeps working.
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
  if (!isOwnerEmail(c.env, c.get("userEmail"))) {
    return c.json({ error: "Owner access required", code: "OWNER_REQUIRED" }, 403);
  }
  await next();
});
