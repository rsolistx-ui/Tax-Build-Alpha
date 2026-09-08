import { createMiddleware } from "hono/factory";
import type { Env } from "../env";
import { createDb } from "../db";
import { resolvePortalToken } from "../services/portal";

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
