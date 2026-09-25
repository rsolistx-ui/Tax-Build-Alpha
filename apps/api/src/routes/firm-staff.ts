import { Hono } from "hono";
import { z } from "zod";
import { createDb, type Db } from "../db";
import type { Env } from "../env";
import { requireSession, type AuthedVars } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { newId } from "../lib/id";
import { ensureFirm, getFirmMembership } from "../services/firm";
import { addDays, DEFAULT_BETA_DAYS, generateInviteToken, hashToken } from "../services/beta";
import { insertWorkAuditEvent, workAuditEventStatement } from "../services/work-audit";
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
  const { db, firm, myRole, isOwner } = await ownerContext(c);
  const [members, invitations, assignments] = await Promise.all([
    db.query<{ user_id: string; role: string; sees_all_clients: boolean; created_at: string }>(
      `SELECT user_id, role, sees_all_clients, created_at FROM firm_members WHERE firm_id = $1 ORDER BY created_at`,
      [firm.id],
    ),
    db.query<{ id: string; email: string; firm_role: string | null; expires_at: string; created_at: string }>(
      `SELECT id, email, firm_role, expires_at, created_at FROM beta_invitations
        WHERE firm_id = $1 AND status = 'pending' AND expires_at > NOW() ORDER BY created_at DESC`,
      [firm.id],
    ),
    // Who sees which client is the owner's to manage, so only the owner gets it.
    isOwner
      ? db.query<{ user_id: string; client_id: string }>(`SELECT user_id, client_id FROM client_assignments WHERE firm_id = $1`, [firm.id])
      : Promise.resolve([] as { user_id: string; client_id: string }[]),
  ]);
  const clientIdsByUser = new Map<string, string[]>();
  for (const a of assignments) clientIdsByUser.set(a.user_id, [...(clientIdsByUser.get(a.user_id) ?? []), a.client_id]);
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
      seesAllClients: toFirmRole(m.role) === "owner" || m.sees_all_clients,
      ...(isOwner ? { clientIds: clientIdsByUser.get(m.user_id) ?? [] } : {}),
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

  // An email with an account joins by signing in and accepting (firmJoinRoutes below); a new email redeems and signs up.
  const existing = await c.env.AUTH_DB.prepare(`SELECT id FROM user WHERE lower(email) = ?1`).bind(email).first<{ id: string }>();
  if (existing) {
    const [member] = await db.query<{ id: string }>(`SELECT id FROM firm_members WHERE firm_id = $1 AND user_id = $2`, [firm.id, existing.id]);
    if (member) return c.json({ error: "That person is already on your team.", code: "ALREADY_MEMBER" }, 409);
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
  return c.json({ invitation: { id, email, role, expiresAt: expiresAt.toISOString(), token, existingAccount: Boolean(existing) } }, 201);
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

/**
 * Which clients a staff member can reach: every client (seesAllClients) or
 * only the listed ones. Replaces the member's whole assignment list.
 */
firmStaffRoutes.put("/staff/:userId/clients", async (c) => {
  const { db, firm, isOwner } = await ownerContext(c);
  if (!isOwner) return c.json({ error: "Only the firm owner can assign clients.", code: "FIRM_OWNER_REQUIRED" }, 403);
  const body = z
    .object({ seesAllClients: z.boolean(), clientIds: z.array(z.string().min(1)).max(5000) })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Send seesAllClients and a list of client ids." }, 400);
  const targetUserId = c.req.param("userId");
  const [member] = await db.query<{ id: string }>(
    `SELECT id FROM firm_members WHERE firm_id = $1 AND user_id = $2 AND role <> 'owner'`,
    [firm.id, targetUserId],
  );
  if (!member) return c.json({ error: "No staff member with that id in this firm." }, 404);
  const clientIds = [...new Set(body.data.clientIds)];
  if (clientIds.length > 0) {
    const found = await db.query<{ id: string }>(`SELECT id FROM clients WHERE firm_id = $1 AND id IN (SELECT jsonb_array_elements_text($2::jsonb))`, [firm.id, clientIds]);
    if (found.length !== clientIds.length) return c.json({ error: "One or more clients are not in this firm." }, 400);
  }
  await db.transaction([
    { query: `UPDATE firm_members SET sees_all_clients = $3 WHERE firm_id = $1 AND user_id = $2`, params: [firm.id, targetUserId, body.data.seesAllClients] },
    { query: `DELETE FROM client_assignments WHERE firm_id = $1 AND user_id = $2`, params: [firm.id, targetUserId] },
    ...(clientIds.length > 0
      ? [{
          query: `INSERT INTO client_assignments (client_id, firm_id, user_id, assigned_by_user_id)
                  SELECT jsonb_array_elements_text($1::jsonb), $2, $3, $4`,
          params: [clientIds, firm.id, targetUserId, c.get("userId")],
        }]
      : []),
  ]);
  await insertWorkAuditEvent(db, {
    firmId: firm.id,
    entityType: "firm_staff",
    entityId: targetUserId,
    action: "staff_clients_assigned",
    actorUserId: c.get("userId"),
    afterJson: { seesAllClients: body.data.seesAllClients, clientIds },
  });
  return c.json({ ok: true, seesAllClients: body.data.seesAllClients, clientIds });
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
  await db.query(`DELETE FROM client_assignments WHERE firm_id = $1 AND user_id = $2`, [firm.id, targetUserId]);
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

/**
 * Joining a firm with an account that already exists: the invited person signs
 * in and accepts the owner's link. Session only, because a removed staff member
 * has no active access until they join again. The signed-in email must match the
 * invitation. Someone who owns a firm can join only while that firm has no
 * clients and no staff; the old firm is left in place (its signed records are
 * kept) and its pending invitations are revoked. Staff of another firm must be
 * removed there first, since a user belongs to one firm.
 */
export const firmJoinRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
firmJoinRoutes.use("*", requireSession);

const joinBody = z.object({ token: z.string().min(16).max(200) });

type JoinInvitation = { id: string; email: string; firm_id: string; firm_role: string | null; firm_name: string };

async function loadJoinInvitation(db: Db, token: string) {
  const [row] = await db.query<JoinInvitation>(
    `SELECT i.id, i.email, i.firm_id, i.firm_role, f.name AS firm_name
       FROM beta_invitations i JOIN firms f ON f.id = i.firm_id
      WHERE i.token_hash = $1 AND i.status = 'pending' AND i.expires_at > NOW()`,
    [await hashToken(token)],
  );
  return row ?? null;
}

async function joinInvitationFor(c: any): Promise<{ error: Response } | { error: null; db: Db; inv: JoinInvitation }> {
  const body = joinBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return { error: c.json({ error: "Missing invitation token." }, 400) };
  const db = createDb(c.env);
  const inv = await loadJoinInvitation(db, body.data.token);
  if (!inv) return { error: c.json({ error: "This invitation is not valid. It may have expired or been revoked.", code: "INVITE_INVALID" }, 404) };
  // The firm's name is shown only to the person it was sent to.
  if (inv.email.toLowerCase() !== String(c.get("userEmail")).toLowerCase()) {
    return { error: c.json({ error: "This invitation was sent to a different email. Sign in with that email to accept it.", code: "EMAIL_MISMATCH" }, 403) };
  }
  return { error: null, db, inv };
}

firmJoinRoutes.post("/preview", async (c) => {
  const found = await joinInvitationFor(c);
  if (found.error) return found.error;
  const { inv } = found;
  return c.json({ firmName: inv.firm_name, role: toFirmRole(inv.firm_role), email: inv.email });
});

firmJoinRoutes.post("/accept", async (c) => {
  const found = await joinInvitationFor(c);
  if (found.error) return found.error;
  const { db, inv } = found;
  const userId = c.get("userId");

  const membership = await getFirmMembership(db, userId);
  let leavingFirmId: string | null = null;
  if (membership) {
    if (membership.firmId === inv.firm_id) return c.json({ error: "You are already on this firm's team.", code: "ALREADY_MEMBER" }, 409);
    if (membership.role !== "owner") {
      return c.json({ error: "You are on another firm's team. Ask that firm's owner to remove you, then open this link again.", code: "IN_ANOTHER_FIRM" }, 409);
    }
    const [usage] = await db.query<{ clients: string; staff: string }>(
      `SELECT (SELECT COUNT(*) FROM clients WHERE firm_id = $1) AS clients,
              (SELECT COUNT(*) FROM firm_members WHERE firm_id = $1 AND user_id <> $2) AS staff`,
      [membership.firmId, userId],
    );
    if (Number(usage?.clients ?? 0) > 0 || Number(usage?.staff ?? 0) > 0) {
      return c.json({ error: "Your own firm already has clients or staff, so you cannot join another firm with this account.", code: "OWN_FIRM_IN_USE" }, 409);
    }
    leavingFirmId = membership.firmId;
  }

  // Claim the invitation first so it cannot be used twice.
  const [claimed] = await db.query<{ id: string }>(
    `UPDATE beta_invitations SET status = 'redeemed', redeemed_at = NOW(), redeemed_by_user_id = $2, updated_at = NOW()
      WHERE id = $1 AND status = 'pending' RETURNING id`,
    [inv.id, userId],
  );
  if (!claimed) return c.json({ error: "This invitation is not valid. It may have expired or been revoked.", code: "INVITE_INVALID" }, 404);

  const invitedRole = toFirmRole(inv.firm_role);
  const role = ASSIGNABLE_ROLES.includes(invitedRole) ? invitedRole : "read_only";
  try {
    await db.transaction([
      ...(leavingFirmId
        ? [
            // Re-checks "no clients, no other staff" atomically: if either appeared, nothing is deleted and
            // the insert below fails on the one-firm-per-user index, rolling the whole join back.
            {
              query: `DELETE FROM firm_members WHERE firm_id = $1 AND user_id = $2
                        AND NOT EXISTS (SELECT 1 FROM clients WHERE firm_id = $1)
                        AND NOT EXISTS (SELECT 1 FROM firm_members o WHERE o.firm_id = $1 AND o.user_id <> $2)`,
              params: [leavingFirmId, userId],
            },
            { query: `UPDATE beta_invitations SET status = 'revoked', updated_at = NOW() WHERE firm_id = $1 AND status = 'pending'`, params: [leavingFirmId] },
            workAuditEventStatement({ firmId: leavingFirmId, entityType: "firm_staff", entityId: userId, action: "owner_joined_another_firm", actorUserId: userId, afterJson: { joinedFirmId: inv.firm_id } }),
          ]
        : []),
      { query: `INSERT INTO firm_members (id, firm_id, user_id, role) VALUES ($1, $2, $3, $4)`, params: [newId("fm"), inv.firm_id, userId, role] },
      workAuditEventStatement({ firmId: inv.firm_id, entityType: "firm_staff", entityId: userId, action: "staff_joined_existing_account", actorUserId: userId, afterJson: { invitationId: inv.id, role } }),
    ]);
  } catch (error) {
    console.error(`[firm.join] joining failed for invitation ${inv.id}, user ${userId}; releasing the invitation:`, error);
    await db.query(
      `UPDATE beta_invitations SET status = 'pending', redeemed_at = NULL, redeemed_by_user_id = NULL, updated_at = NOW() WHERE id = $1`,
      [inv.id],
    );
    return c.json({ error: "Could not join the firm. Try again.", code: "JOIN_FAILED" }, 500);
  }
  return c.json({ ok: true, firmName: inv.firm_name, role });
});
