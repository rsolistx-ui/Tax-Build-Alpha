import { createMiddleware } from "hono/factory";
import type { Env } from "../env";
import { createDb } from "../db";
import { resolvePortalToken } from "../services/portal";
import { computeAccessDecision, type EntitlementRow } from "../services/beta";

export type PortalVars = {
  portalFirmId: string;
  portalClientId: string;
  portalLinkId: string;
};

/**
 * Authenticates a client-portal request from a bearer token, never from a
 * client-supplied firmId/clientId. Distinct from requireSession (Better
 * Auth staff sessions) - a client is never a Better Auth D1 user in this
 * milestone.
 */
export const requirePortalToken = createMiddleware<{ Bindings: Env; Variables: PortalVars }>(async (c, next) => {
  const header = c.req.header("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const db = createDb(c.env);
  const resolved = await resolvePortalToken(db, token);
  if (!resolved) return c.json({ error: "Unauthorized" }, 401);

  c.set("portalFirmId", resolved.firmId);
  c.set("portalClientId", resolved.clientId);
  c.set("portalLinkId", resolved.linkId);
  await next();
});

/**
 * A portal token proves which client may access the portal; it does not keep
 * a firm's subscription alive. This separate gate makes expiry apply equally
 * to staff, desktop, and client-facing magic-link workflows.
 */
export const requireActivePortalEntitlement = createMiddleware<{ Bindings: Env; Variables: PortalVars }>(async (c, next) => {
  const db = createDb(c.env);
  const [row] = await db.query<{ status: string | null; expires_at: string | null }>(
    `SELECT be.status, be.expires_at
     FROM firms f
     LEFT JOIN beta_entitlements be ON be.user_id = f.owner_user_id
     WHERE f.id = $1`,
    [c.get("portalFirmId")],
  );
  const entitlement: EntitlementRow | null = row?.status && row.expires_at
    ? { status: row.status as EntitlementRow["status"], expiresAt: row.expires_at }
    : null;
  const decision = computeAccessDecision(entitlement, new Date());
  if (!decision.allowed) {
    return c.json({ error: "Client portal access is currently unavailable", code: decision.reason }, 403);
  }
  await next();
});
