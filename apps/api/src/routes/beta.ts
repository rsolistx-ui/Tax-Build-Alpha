import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import { createAuth } from "../auth";
import { requireSession, type AuthedVars } from "../middleware/session";
import { requireOwner, isOwnerEmail } from "../middleware/beta";
import { insertBetaAccessEvent } from "../services/beta-db";
import { newId } from "../lib/id";
import {
  generateInviteToken,
  hashToken,
  validateInvitationRedemption,
  computeAccessDecision,
  addDays,
  DEFAULT_BETA_DAYS,
  type InvitationRow,
  type EntitlementRow,
} from "../services/beta";

export const betaRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

const redeemSchema = z.object({
  token: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(200),
});

/**
 * Public, but only ever succeeds against a valid, unredeemed, unexpired,
 * unrevoked invitation whose email matches case-insensitively. This is the
 * only path that can create a usable Folio account: Better Auth's own
 * sign-up route is blocked below.
 */
betaRoutes.post("/redeem", async (c) => {
  const body = redeemSchema.parse(await c.req.json());
  const db = createDb(c.env);
  const tokenHash = await hashToken(body.token);

  const [invitationRaw] = await db.query<{
    id: string;
    email: string;
    status: string;
    expires_at: string;
    redeemed_at: string | null;
    beta_days: number;
  }>(
    `SELECT id, email, status, expires_at, redeemed_at, beta_days FROM beta_invitations WHERE token_hash = $1`,
    [tokenHash],
  );
  const invitation: InvitationRow | null = invitationRaw
    ? {
        id: invitationRaw.id,
        email: invitationRaw.email,
        status: invitationRaw.status as InvitationRow["status"],
        expiresAt: invitationRaw.expires_at,
        redeemedAt: invitationRaw.redeemed_at,
      }
    : null;

  const validation = validateInvitationRedemption(invitation, body.email, new Date());
  if (!validation.ok) {
    return c.json({ error: "This invitation cannot be redeemed.", code: validation.reason }, 409);
  }

  const auth = createAuth(c.env);
  const signUpResponse = await auth.api.signUpEmail({
    body: { name: body.name, email: body.email, password: body.password },
    asResponse: true,
  });
  if (!signUpResponse.ok) {
    const detail = await signUpResponse.text().catch(() => "");
    return c.json({ error: "Account creation failed.", detail: detail.slice(0, 300) }, signUpResponse.status as 400);
  }
  const created = (await signUpResponse.clone().json()) as { user?: { id?: string } };
  const newUserId = created.user?.id;
  if (!newUserId) {
    return c.json({ error: "Account creation did not return a user id." }, 500);
  }

  const now = new Date();
  const betaDays = invitationRaw!.beta_days || DEFAULT_BETA_DAYS;
  const expiresAt = addDays(now, betaDays);

  await db.transaction([
    {
      query: `UPDATE beta_invitations SET status = 'redeemed', redeemed_at = NOW(), redeemed_by_user_id = $1, updated_at = NOW() WHERE id = $2`,
      params: [newUserId, invitationRaw!.id],
    },
    {
      query: `INSERT INTO beta_entitlements (user_id, status, starts_at, expires_at)
              VALUES ($1, 'active', $2, $3)
              ON CONFLICT (user_id) DO UPDATE SET status = 'active', starts_at = $2, expires_at = $3, revoked_at = NULL, revoked_by_user_id = NULL, revocation_reason = NULL, updated_at = NOW()`,
      params: [newUserId, now.toISOString(), expiresAt.toISOString()],
    },
  ]);

  await insertBetaAccessEvent(db, {
    action: "beta_invite_redeemed",
    actorUserId: newUserId,
    affectedUserId: newUserId,
    affectedEmail: body.email,
    beforeJson: { invitationId: invitationRaw!.id, status: "pending" },
    afterJson: { invitationId: invitationRaw!.id, status: "redeemed" },
  });
  await insertBetaAccessEvent(db, {
    action: "beta_access_activated",
    actorUserId: newUserId,
    affectedUserId: newUserId,
    affectedEmail: body.email,
    afterJson: { status: "active", startsAt: now.toISOString(), expiresAt: expiresAt.toISOString() },
  });

  return new Response(signUpResponse.body, {
    status: signUpResponse.status,
    headers: signUpResponse.headers,
  });
});

betaRoutes.get("/status", requireSession, async (c) => {
  const db = createDb(c.env);
  const owner = isOwnerEmail(c.env, c.get("userEmail"));
  if (owner) {
    return c.json({ isOwner: true, allowed: true, entitlement: null });
  }
  const [row] = await db.query<{ status: string; starts_at: string; expires_at: string }>(
    `SELECT status, starts_at, expires_at FROM beta_entitlements WHERE user_id = $1`,
    [c.get("userId")],
  );
  const entitlement: EntitlementRow | null = row
    ? { status: row.status as EntitlementRow["status"], expiresAt: row.expires_at }
    : null;
  const decision = computeAccessDecision(entitlement, new Date());
  return c.json({
    isOwner: false,
    allowed: decision.allowed,
    reason: decision.allowed ? null : decision.reason,
    entitlement: row ? { status: row.status, startsAt: row.starts_at, expiresAt: row.expires_at } : null,
  });
});

const createInviteSchema = z.object({
  email: z.string().email(),
  betaDays: z.number().int().min(1).max(365).optional(),
});

betaRoutes.post("/invitations", requireSession, requireOwner, async (c) => {
  const body = createInviteSchema.parse(await c.req.json());
  const db = createDb(c.env);
  const token = generateInviteToken();
  const tokenHash = await hashToken(token);
  const id = newId("biv");
  const betaDays = body.betaDays ?? DEFAULT_BETA_DAYS;
  const expiresAt = addDays(new Date(), 14);

  await db.query(
    `INSERT INTO beta_invitations (id, email, token_hash, status, issued_by_user_id, expires_at, beta_days)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6)`,
    [id, body.email, tokenHash, c.get("userId"), expiresAt.toISOString(), betaDays],
  );
  await insertBetaAccessEvent(db, {
    action: "beta_invite_created",
    actorUserId: c.get("userId"),
    affectedUserId: null,
    affectedEmail: body.email,
    afterJson: { invitationId: id, betaDays, invitationExpiresAt: expiresAt.toISOString() },
  });

  return c.json({ invitation: { id, email: body.email, betaDays, expiresAt: expiresAt.toISOString(), token } }, 201);
});

betaRoutes.get("/invitations", requireSession, requireOwner, async (c) => {
  const db = createDb(c.env);
  const invitations = await db.query(
    `SELECT id, email, status, issued_at, expires_at, redeemed_at, redeemed_by_user_id, beta_days
     FROM beta_invitations ORDER BY issued_at DESC LIMIT 200`,
  );
  return c.json({ invitations });
});

betaRoutes.get("/entitlements", requireSession, requireOwner, async (c) => {
  const db = createDb(c.env);
  const entitlements = await db.query<Record<string, unknown>>(
    `SELECT be.user_id, be.status, be.starts_at, be.expires_at, be.revoked_at, be.revocation_reason, u.email, u.name
     FROM beta_entitlements be
     LEFT JOIN "user" u ON u.id = be.user_id
     ORDER BY be.updated_at DESC LIMIT 200`,
  );
  return c.json({ entitlements });
});

const revokeSchema = z.object({ reason: z.string().max(500).optional() });

betaRoutes.post("/entitlements/:userId/revoke", requireSession, requireOwner, async (c) => {
  const targetUserId = c.req.param("userId");
  const body = revokeSchema.parse(await c.req.json().catch(() => ({})));
  const db = createDb(c.env);
  const [before] = await db.query<Record<string, unknown>>(
    `SELECT * FROM beta_entitlements WHERE user_id = $1`,
    [targetUserId],
  );
  if (!before) return c.json({ error: "No entitlement found for this user" }, 404);

  const [after] = await db.query<Record<string, unknown>>(
    `UPDATE beta_entitlements SET status = 'revoked', revoked_at = NOW(), revoked_by_user_id = $1, revocation_reason = $2, updated_at = NOW()
     WHERE user_id = $3 RETURNING *`,
    [c.get("userId"), body.reason ?? null, targetUserId],
  );
  await insertBetaAccessEvent(db, {
    action: "beta_access_revoked",
    actorUserId: c.get("userId"),
    affectedUserId: targetUserId,
    affectedEmail: null,
    beforeJson: before,
    afterJson: after,
    reason: body.reason ?? null,
  });
  return c.json({ entitlement: after });
});

const reactivateSchema = z.object({ betaDays: z.number().int().min(1).max(365).optional() });

betaRoutes.post("/entitlements/:userId/reactivate", requireSession, requireOwner, async (c) => {
  const targetUserId = c.req.param("userId");
  const body = reactivateSchema.parse(await c.req.json().catch(() => ({})));
  const db = createDb(c.env);
  const [before] = await db.query<Record<string, unknown>>(
    `SELECT * FROM beta_entitlements WHERE user_id = $1`,
    [targetUserId],
  );
  if (!before) return c.json({ error: "No entitlement found for this user" }, 404);

  const betaDays = body.betaDays ?? DEFAULT_BETA_DAYS;
  const now = new Date();
  const expiresAt = addDays(now, betaDays);
  const [after] = await db.query<Record<string, unknown>>(
    `UPDATE beta_entitlements SET status = 'active', starts_at = $1, expires_at = $2,
       revoked_at = NULL, revoked_by_user_id = NULL, revocation_reason = NULL, updated_at = NOW()
     WHERE user_id = $3 RETURNING *`,
    [now.toISOString(), expiresAt.toISOString(), targetUserId],
  );
  await insertBetaAccessEvent(db, {
    action: "beta_access_reactivated",
    actorUserId: c.get("userId"),
    affectedUserId: targetUserId,
    affectedEmail: null,
    beforeJson: before,
    afterJson: after,
  });
  return c.json({ entitlement: after });
});

const extendSchema = z.object({ additionalDays: z.number().int().min(1).max(365) });

betaRoutes.post("/entitlements/:userId/extend", requireSession, requireOwner, async (c) => {
  const targetUserId = c.req.param("userId");
  const body = extendSchema.parse(await c.req.json());
  const db = createDb(c.env);
  const [before] = await db.query<Record<string, unknown>>(
    `SELECT * FROM beta_entitlements WHERE user_id = $1`,
    [targetUserId],
  );
  if (!before) return c.json({ error: "No entitlement found for this user" }, 404);

  const baseline = new Date(String(before.expires_at)).getTime() > Date.now() ? new Date(String(before.expires_at)) : new Date();
  const expiresAt = addDays(baseline, body.additionalDays);
  const [after] = await db.query<Record<string, unknown>>(
    `UPDATE beta_entitlements SET status = 'active', expires_at = $1,
       revoked_at = NULL, revoked_by_user_id = NULL, revocation_reason = NULL, updated_at = NOW()
     WHERE user_id = $2 RETURNING *`,
    [expiresAt.toISOString(), targetUserId],
  );
  await insertBetaAccessEvent(db, {
    action: "beta_access_extended",
    actorUserId: c.get("userId"),
    affectedUserId: targetUserId,
    affectedEmail: null,
    beforeJson: before,
    afterJson: after,
  });
  return c.json({ entitlement: after });
});

betaRoutes.get("/audit", requireSession, requireOwner, async (c) => {
  const db = createDb(c.env);
  const events = await db.query(
    `SELECT id, action, actor_user_id, affected_user_id, affected_email, before_json, after_json, reason, created_at
     FROM beta_access_events ORDER BY created_at DESC LIMIT 500`,
  );
  return c.json({ events });
});
