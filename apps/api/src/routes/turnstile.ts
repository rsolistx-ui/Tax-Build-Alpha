import { Hono } from "hono";
import type { Env } from "../env";
import { turnstileConfigured } from "../services/admin-unlock";

export const turnstileRoutes = new Hono<{ Bindings: Env }>();

/**
 * Returns public Turnstile site key configuration to the admin panel. The token itself is
 * verified by POST /api/admin-unlock (see routes/admin-unlock.ts).
 */
turnstileRoutes.get("/config", (c) => {
  const enabled = turnstileConfigured(c.env);
  return c.json({
    enabled,
    siteKey: enabled ? c.env.CF_TURNSTILE_SITE_KEY!.trim() : null,
  });
});
