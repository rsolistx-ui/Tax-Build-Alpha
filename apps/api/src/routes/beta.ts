import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import { createAuth } from "../auth";
import { requireSession, type AuthedVars } from "../middleware/session";
import { requireOwner, isOwnerEmail } from "../middleware/beta";
import { insertBetaAccessEvent, betaAccessEventStatement } from "../services/beta-db";
import { newId } from "../lib/id";
import { ensureFirm } from "../services/firm";
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
  type InvitationStatus,
  type EntitlementRow,
} from "../services/beta";

export const betaRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

betaRoutes.get("/redeem-check", async (c) => {
  const db = createDb(c.env);
  const token = c.req.query("token");
  if (!token) return c.json({ valid: false });
  const [row] = await db.query<any>(`SELECT * FROM beta_access_tokens WHERE token=$1`, [token]);
  if (!row) return c.json({ valid: false });
  return c.json({ valid: true, redeemed: !!row.redeemed_by, created_at: row.created_at });
});

betaRoutes.post("/generate-token", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  if (!isOwnerEmail(c.env, c.get("userEmail"))) return c.json({ error: "owner only" }, 403);
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 16); // 64 hex chars
  await db.query(`CREATE TABLE IF NOT EXISTS beta_access_tokens (token TEXT PRIMARY KEY, firm_id TEXT REFERENCES firms(id) ON DELETE CASCADE, created_by TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), redeemed_by TEXT, redeemed_at TIMESTAMPTZ)`, []);
  await db.query(`INSERT INTO beta_access_tokens (token, firm_id, created_by) VALUES ($1,$2,$3) ON CONFLICT (token) DO NOTHING`, [token, firm.id, c.get("userId")]);
  return c.json({ token, created: true });
});

const redeemSchema = z.object({
  token: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(200),
});

async function loadInvitationByTokenHash(db: ReturnType<typeof createDb>, tokenHash: string) {
  const [row] = await db.query<{
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
  return row;
}

function toInvitationRow(row: {
  id: string;
  email: string;
  status: string;
  expires_at: string;
  redeemed_at: string | null;
}): InvitationRow {
  return {
    id: row.id,
    email: row.email,
    status: row.status as InvitationStatus,
    expiresAt: row.expires_at,
    redeemedAt: row.redeemed_at,
  };
}

/**
 * Public, but only ever succeeds against a valid, unredeemed, unexpired,
 * unrevoked invitation whose email matches case-insensitively. This is the
 * only path that can create a usable Folio account: Better Auth's own
 * sign-up route is blocked below.
 *
 * True cross-database transactions between Neon and D1 are impossible, so
 * this handler claims the invitation atomically first (preventing
 * concurrent redemption of the same token), creates the D1 account second,
 * and explicitly compensates - deleting the just-created D1 account and
 * restoring the invitation to pending - if the Neon entitlement activation
 * that must follow ever fails. No usable account is ever left without an
 * entitlement.
 */
betaRoutes.post("/redeem", async (c) => {
  const body = redeemSchema.parse(await c.req.json());
  const db = createDb(c.env);
  const tokenHash = await hashToken(body.token);
  const now = new Date();

  const invitationRow = await loadInvitationByTokenHash(db, tokenHash);
  let invitation: InvitationRow | null = invitationRow ? toInvitationRow(invitationRow) : null;

  if (invitation && isInvitationExpiredButStillPending(invitation, now)) {
    const [expired] = await db.query<{ id: string }>(
      `UPDATE beta_invitations SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING id`,
      [invitation.id],
    );
    if (expired) {
      await insertBetaAccessEvent(db, {
        action: "beta_invite_expired",
        actorUserId: null,
        affectedUserId: null,
        affectedEmail: invitation.email,
        beforeJson: { invitationId: invitation.id, status: "pending" },
        afterJson: { invitationId: invitation.id, status: "expired" },
      });
    }
    invitation = { ...invitation, status: "expired" };
  }

  const validation = validateInvitationRedemption(invitation, body.email, now);
  if (!validation.ok) {
    return c.json({ error: "This invitation cannot be redeemed.", code: validation.reason }, 409);
  }

  const [claimed] = await db.query<{ id: string }>(
    `UPDATE beta_invitations SET status = 'redeemed', redeemed_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'pending' AND expires_at > NOW()
     RETURNING id`,
    [invitationRow!.id],
  );
  if (!claimed) {
    return c.json({ error: "This invitation cannot be redeemed.", code: "ALREADY_REDEEMED" }, 409);
  }

  async function restoreInvitationToPending() {
    await db.query(
      `UPDATE beta_invitations SET status = 'pending', redeemed_at = NULL, redeemed_by_user_id = NULL, updated_at = NOW() WHERE id = $1`,
      [invitationRow!.id],
    );
  }

  const auth = createAuth(c.env);
  let signUpResponse: Response;
  try {
    signUpResponse = await auth.api.signUpEmail({
      body: { name: body.name, email: body.email, password: body.password },
      asResponse: true,
    });
  } catch (error) {
    await restoreInvitationToPending();
    console.error(`[beta.redeem] account creation threw for invitation ${invitationRow!.id}:`, error);
    return c.json({ error: "Could not activate beta access. Please try again.", code: "REDEMPTION_FAILED" }, 500);
  }
  if (!signUpResponse.ok) {
    await restoreInvitationToPending();
    return c.json({ error: "Account creation failed.", code: "ACCOUNT_CREATION_FAILED" }, 400);
  }
  const created = (await signUpResponse.clone().json()) as { user?: { id?: string } };
  const newUserId = created.user?.id;
  if (!newUserId) {
    await restoreInvitationToPending();
    console.error(`[beta.redeem] signUpEmail succeeded without a user id for invitation ${invitationRow!.id}`);
    return c.json({ error: "Could not activate beta access. Please try again.", code: "REDEMPTION_FAILED" }, 500);
  }

  const betaDays = invitationRow!.beta_days || DEFAULT_BETA_DAYS;
  const expiresAt = addDays(now, betaDays);

  try {
    await db.transaction([
      {
        query: `UPDATE beta_invitations SET redeemed_by_user_id = $1, updated_at = NOW() WHERE id = $2`,
        params: [newUserId, invitationRow!.id],
      },
      {
        query: `INSERT INTO beta_entitlements (user_id, status, starts_at, expires_at)
                VALUES ($1, 'active', $2, $3)
                ON CONFLICT (user_id) DO UPDATE SET status = 'active', starts_at = $2, expires_at = $3, revoked_at = NULL, revoked_by_user_id = NULL, revocation_reason = NULL, updated_at = NOW()`,
        params: [newUserId, now.toISOString(), expiresAt.toISOString()],
      },
      betaAccessEventStatement({
        action: "beta_invite_redeemed",
        actorUserId: newUserId,
        affectedUserId: newUserId,
        affectedEmail: body.email,
        beforeJson: { invitationId: invitationRow!.id, status: "pending" },
        afterJson: { invitationId: invitationRow!.id, status: "redeemed" },
      }),
      betaAccessEventStatement({
        action: "beta_access_activated",
        actorUserId: newUserId,
        affectedUserId: newUserId,
        affectedEmail: body.email,
        afterJson: { status: "active", startsAt: now.toISOString(), expiresAt: expiresAt.toISOString() },
      }),
    ]);
  } catch (error) {
    console.error(`[beta.redeem] entitlement activation failed for invitation ${invitationRow!.id}, user ${newUserId}; compensating:`, error);
    try {
      await c.env.AUTH_DB.prepare(`DELETE FROM session WHERE userId = ?`).bind(newUserId).run();
      await c.env.AUTH_DB.prepare(`DELETE FROM account WHERE userId = ?`).bind(newUserId).run();
      await c.env.AUTH_DB.prepare(`DELETE FROM user WHERE id = ?`).bind(newUserId).run();
      await restoreInvitationToPending();
    } catch (compensationError) {
      console.error(`[beta.redeem] CRITICAL: compensation failed for invitation ${invitationRow!.id}, user ${newUserId}:`, compensationError);
    }
    return c.json({ error: "Could not activate beta access. Please try again.", code: "REDEMPTION_FAILED" }, 500);
  }

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

  // Lazily transition any pending invitation whose expiry has passed before
  // listing, so the owner never sees a misleadingly "pending" row for an
  // invitation that can no longer be redeemed. Each transition is audited
  // exactly once via the WHERE status = 'pending' guard.
  const nowExpired = await db.query<{ id: string; email: string }>(
    `UPDATE beta_invitations SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending' AND expires_at <= NOW()
     RETURNING id, email`,
  );
  for (const row of nowExpired) {
    await insertBetaAccessEvent(db, {
      action: "beta_invite_expired",
      actorUserId: null,
      affectedUserId: null,
      affectedEmail: row.email,
      beforeJson: { invitationId: row.id, status: "pending" },
      afterJson: { invitationId: row.id, status: "expired" },
    });
  }

  const invitations = await db.query(
    `SELECT id, email, status, issued_at, expires_at, redeemed_at, redeemed_by_user_id, beta_days
     FROM beta_invitations ORDER BY issued_at DESC LIMIT 200`,
  );
  return c.json({ invitations });
});

const revokeInviteSchema = z.object({ reason: z.string().max(500).optional() });

betaRoutes.post("/invitations/:invitationId/revoke", requireSession, requireOwner, async (c) => {
  const invitationId = c.req.param("invitationId");
  const body = revokeInviteSchema.parse(await c.req.json().catch(() => ({})));
  const db = createDb(c.env);

  const [before] = await db.query<{ id: string; email: string; status: string }>(
    `SELECT id, email, status FROM beta_invitations WHERE id = $1`,
    [invitationId],
  );
  if (!before) return c.json({ error: "Invitation not found" }, 404);
  if (!canRevokeInvitation(before.status as InvitationStatus)) {
    return c.json({ error: "Only a pending invitation can be revoked.", code: "NOT_PENDING" }, 409);
  }

  const [after] = await db.query<{ id: string; email: string; status: string }>(
    `UPDATE beta_invitations SET status = 'revoked', updated_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING id, email, status`,
    [invitationId],
  );
  if (!after) {
    return c.json({ error: "Invitation was no longer pending." }, 409);
  }

  await insertBetaAccessEvent(db, {
    action: "beta_invite_revoked",
    actorUserId: c.get("userId"),
    affectedUserId: null,
    affectedEmail: before.email,
    beforeJson: { invitationId, status: "pending" },
    afterJson: { invitationId, status: "revoked" },
    reason: body.reason ?? null,
  });
  return c.json({ invitation: after });
});

betaRoutes.get("/entitlements", requireSession, requireOwner, async (c) => {
  const db = createDb(c.env);
  const entitlements = await db.query<Record<string, unknown>>(
    `SELECT user_id, status, starts_at, expires_at, revoked_at, revocation_reason
     FROM beta_entitlements ORDER BY updated_at DESC LIMIT 200`,
  );
  // Better Auth's user table lives in D1, a separate database from Neon, so
  // the email/name lookup happens as a second query against the D1 binding
  // and is merged here rather than attempted as a cross-database SQL join.
  const userIds = entitlements.map((e) => String(e.user_id));
  const userById = new Map<string, { email: string | null; name: string | null }>();
  if (userIds.length > 0) {
    const placeholders = userIds.map((_, i) => `?${i + 1}`).join(", ");
    const stmt = c.env.AUTH_DB.prepare(`SELECT id, email, name FROM user WHERE id IN (${placeholders})`);
    const result = await stmt.bind(...userIds).all<{ id: string; email: string; name: string }>();
    for (const row of result.results ?? []) {
      userById.set(row.id, { email: row.email, name: row.name });
    }
  }
  const enriched = entitlements.map((e) => ({
    ...e,
    email: userById.get(String(e.user_id))?.email ?? null,
    name: userById.get(String(e.user_id))?.name ?? null,
  }));
  return c.json({ entitlements: enriched });
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

/**
 * Fast-Pass Pairing Endpoints:
 * Frictionless 6-digit workstation & mobile pairing without passwords
 */
betaRoutes.post("/fast-pass/create", requireSession, async (c) => {
  const db = createDb(c.env);
  const userId = c.get("userId");
  const email = c.get("userEmail");

  await db.query(`
    CREATE TABLE IF NOT EXISTS fast_pass_codes (
      code TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      redeemed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  const randNum = Math.floor(1000 + Math.random() * 9000);
  const randLetters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const suffix = randLetters[Math.floor(Math.random() * randLetters.length)] + randLetters[Math.floor(Math.random() * randLetters.length)];
  const code = `TP-${randNum}${suffix}`;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour validity

  await db.query(
    `INSERT INTO fast_pass_codes (code, user_id, email, expires_at) VALUES ($1, $2, $3, $4)`,
    [code, userId, email, expiresAt.toISOString()],
  );

  return c.json({ code, expiresAt: expiresAt.toISOString() });
});

betaRoutes.post("/fast-pass/claim", async (c) => {
  const body = z.object({ code: z.string().min(4) }).parse(await c.req.json());
  const db = createDb(c.env);
  const formattedCode = body.code.trim().toUpperCase();

  await db.query(`
    CREATE TABLE IF NOT EXISTS fast_pass_codes (
      code TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      redeemed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  const [row] = await db.query<{ code: string; user_id: string; email: string }>(
    `SELECT code, user_id, email FROM fast_pass_codes WHERE UPPER(code) = $1 AND expires_at > NOW() AND redeemed_at IS NULL`,
    [formattedCode],
  );

  if (!row) {
    return c.json({ error: "Invalid or expired Fast-Pass code. Please check and try again.", code: "FAST_PASS_EXPIRED" }, 400);
  }

  // Mark claimed
  await db.query(`UPDATE fast_pass_codes SET redeemed_at = NOW() WHERE code = $1`, [row.code]);

  // Create active session in D1
  const sessionToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const sessionId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  await c.env.AUTH_DB.prepare(
    `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(sessionId, expiresAt.toISOString(), sessionToken, now.toISOString(), now.toISOString(), row.user_id).run().catch(() => {});

  const user = await c.env.AUTH_DB.prepare(`SELECT id, email, name FROM user WHERE id = ?`).bind(row.user_id).first<{ id: string; email: string; name: string }>().catch(() => null);

  const isProd = c.env.BETTER_AUTH_URL?.startsWith("https://") ?? false;
  const cookieName = isProd ? "__Secure-better-auth.session_token" : "better-auth.session_token";

  c.header(
    "Set-Cookie",
    `${cookieName}=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${isProd ? "; Secure" : ""}`,
    { append: true }
  );

  c.header(
    "Set-Cookie",
    `better-auth.session_token=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${isProd ? "; Secure" : ""}`,
    { append: true }
  );

  return c.json({
    ok: true,
    user: user || { id: row.user_id, email: row.email, name: "Practitioner" },
  });
});

