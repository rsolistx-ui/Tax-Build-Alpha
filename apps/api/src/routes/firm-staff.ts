import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import { requireSession, type AuthedVars } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { newId } from "../lib/id";
import { ensureFirm, getFirmMembership } from "../services/firm";
import { addDays, DEFAULT_BETA_DAYS, generateInviteToken, hashToken } from "../services/beta";
import { insertWorkAuditEvent } from "../services/work-audit";
import { ASSIGNABLE_ROLES, toFirmRole } from "../services/firm-roles";

/**
 * Staff seats for a firm, with no cap on how many. Any member can see the
 * team; only the firm owner can invite, change roles, or remove staff (the
 * role rules themselves live in services/firm-roles.ts). An invitation is a link the owner sends; redeeming
 * it (POST /api/beta/redeem) creates the account and adds it to this firm.
 */
export const firmStaffRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
firmStaffRoutes.use("*", requireSession);
firmStaffRoutes.use("*", requireActiveBeta);

const INVITE_DAYS = 14;

async function ownerContext(c: any) {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const membership = await getFirmMembership(db, c.get("userId"));
  return { db, firm, isOwner: membership?.role === "owner", myRole: membership?.role ?? "owner" };
}

firmStaffRoutes.get("/staff", async (c) => {
  const { db, firm, myRole } = await ownerContext(c);
  const [members, invitations] = await Promise.all([
    db.query<{ user_id: string; role: string; created_at: string }>(
      `SELECT user_id, role, created_at FROM firm_members WHERE firm_id = $1 ORDER BY created_at`,
      [firm.id],
    ),
    db.query<{ id: string; email: string; firm_role: string | null; expires_at: string; created_at: string }>(
      `SELECT id, email, firm_role, expires_at, created_at FROM beta_invitations
        WHERE firm_id = $1 AND status = 'pending' AND expires_at > NOW() ORDER BY created_at DESC`,
      [firm.id],
    ),
  ]);
  // Names and emails live in the auth database (D1), not Neon.
  const ids = members.map((m) => m.user_id);
  const users = new Map<string, { email: string; name: string }>();
  if (ids.length > 0) {
    const placeholders = ids.map((_, i) => `?${i + 1}`).join(", ");
    const result = await c.env.AUTH_DB.prepare(`SELECT id, email, name FROM user WHERE id IN (${placeholders})`)
      .bind(...ids)
      .all<{ id: string; email: string; name: string }>();
    for (const u of result.results ?? []) users.set(u.id, { email: u.email, name: u.name });
  }
  return c.json({
    myRole,
    assignableRoles: ASSIGNABLE_ROLES,
    members: members.map((m) => ({
      userId: m.user_id,
      role: toFirmRole(m.role),
      name: users.get(m.user_id)?.name ?? null,
      email: users.get(m.user_id)?.email ?? null,
      joinedAt: m.created_at,
      isMe: m.user_id === c.get("userId"),
    })),
    invitations: invitations.map((i) => ({ id: i.id, email: i.email, role: toFirmRole(i.firm_role), expiresAt: i.expires_at, createdAt: i.created_at })),
  });
});

firmStaffRoutes.post("/staff/invitations", async (c) => {
  const { db, firm, isOwner } = await ownerContext(c);
  if (!isOwner) return c.json({ error: "Only the firm owner can invite staff.", code: "FIRM_OWNER_REQUIRED" }, 403);
  const body = z
    .object({ email: z.string().email(), role: z.enum(ASSIGNABLE_ROLES as [string, ...string[]]).default("preparer") })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Enter a valid email address and role." }, 400);
  const role = body.data.role;
  const email = body.data.email.trim().toLowerCase();

  // Redemption creates a new account, so an email that already has one cannot be invited.
  const existing = await c.env.AUTH_DB.prepare(`SELECT id FROM user WHERE lower(email) = ?1`).bind(email).first<{ id: string }>();
  if (existing) {
    return c.json({ error: "That email already has a Truepost account. Adding existing accounts to a firm is not supported yet.", code: "EMAIL_HAS_ACCOUNT" }, 409);
  }
  const [pending] = await db.query<{ id: string }>(
    `SELECT id FROM beta_invitations WHERE firm_id = $1 AND lower(email) = $2 AND status = 'pending' AND expires_at > NOW()`,
    [firm.id, email],
  );
  if (pending) return c.json({ error: "That email already has a pending invitation. Revoke it to send a new one.", code: "INVITE_PENDING" }, 409);

  const token = generateInviteToken();
  const id = newId("biv");
  const expiresAt = addDays(new Date(), INVITE_DAYS);
  await db.query(
    `INSERT INTO beta_invitations (id, email, token_hash, status, issued_by_user_id, expires_at, beta_days, firm_id, firm_role)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8)`,
    [id, email, await hashToken(token), c.get("userId"), expiresAt.toISOString(), DEFAULT_BETA_DAYS, firm.id, role],
  );
  await insertWorkAuditEvent(db, {
    firmId: firm.id,
    entityType: "firm_staff",
    entityId: id,
    action: "staff_invited",
    actorUserId: c.get("userId"),
    afterJson: { email, role, expiresAt: expiresAt.toISOString() },
  });
  return c.json({ invitation: { id, email, role, expiresAt: expiresAt.toISOString(), token } }, 201);
});

firmStaffRoutes.post("/staff/invitations/:invitationId/revoke", async (c) => {
  const { db, firm, isOwner } = await ownerContext(c);
  if (!isOwner) return c.json({ error: "Only the firm owner can revoke invitations.", code: "FIRM_OWNER_REQUIRED" }, 403);
  const [revoked] = await db.query<{ id: string; email: string }>(
    `UPDATE beta_invitations SET status = 'revoked', updated_at = NOW()
      WHERE id = $1 AND firm_id = $2 AND status = 'pending' RETURNING id, email`,
    [c.req.param("invitationId"), firm.id],
  );
  if (!revoked) return c.json({ error: "No pending invitation to revoke." }, 404);
  await insertWorkAuditEvent(db, {
    firmId: firm.id,
    entityType: "firm_staff",
    entityId: revoked.id,
    action: "staff_invitation_revoked",
    actorUserId: c.get("userId"),
    afterJson: { email: revoked.email },
  });
  return c.json({ ok: true });
});

firmStaffRoutes.patch("/staff/:userId", async (c) => {
  const { db, firm, isOwner } = await ownerContext(c);
  if (!isOwner) return c.json({ error: "Only the firm owner can change roles.", code: "FIRM_OWNER_REQUIRED" }, 403);
  const body = z
    .object({ role: z.enum(ASSIGNABLE_ROLES as [string, ...string[]]) })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Choose a valid role." }, 400);
  const targetUserId = c.req.param("userId");
  const [changed] = await db.query<{ id: string }>(
    `UPDATE firm_members SET role = $3 WHERE firm_id = $1 AND user_id = $2 AND role <> 'owner' RETURNING id`,
    [firm.id, targetUserId, body.data.role],
  );
  if (!changed) return c.json({ error: "No staff member with that id in this firm." }, 404);
  await insertWorkAuditEvent(db, {
    firmId: firm.id,
    entityType: "firm_staff",
    entityId: targetUserId,
    action: "staff_role_changed",
    actorUserId: c.get("userId"),
    afterJson: { role: body.data.role },
  });
  return c.json({ ok: true });
});

firmStaffRoutes.delete("/staff/:userId", async (c) => {
  const { db, firm, isOwner } = await ownerContext(c);
  if (!isOwner) return c.json({ error: "Only the firm owner can remove staff.", code: "FIRM_OWNER_REQUIRED" }, 403);
  const targetUserId = c.req.param("userId");
  const [removed] = await db.query<{ id: string }>(
    `DELETE FROM firm_members WHERE firm_id = $1 AND user_id = $2 AND role <> 'owner' RETURNING id`,
    [firm.id, targetUserId],
  );
  if (!removed) return c.json({ error: "No staff member with that id in this firm." }, 404);
  // End their sessions now; with no membership and no entitlement of their own
  // they cannot pass requireActiveBeta again.
  await c.env.AUTH_DB.prepare(`DELETE FROM session WHERE userId = ?1`).bind(targetUserId).run();
  await insertWorkAuditEvent(db, {
    firmId: firm.id,
    entityType: "firm_staff",
    entityId: targetUserId,
    action: "staff_removed",
    actorUserId: c.get("userId"),
  });
  return c.json({ ok: true });
});
