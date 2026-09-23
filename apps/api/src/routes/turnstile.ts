import { Hono } from "hono";
import type { Env } from "../env";
import { turnstileConfigured } from "../auth";

export const turnstileRoutes = new Hono<{ Bindings: Env }>();

/**
 * Returns public Turnstile site key configuration to the frontend. The token itself is
 * verified by Better Auth's captcha plugin on the sign-in request (see auth.ts).
 */
turnstileRoutes.get("/config", (c) => {
  const enabled = turnstileConfigured(c.env);
  return c.json({
    enabled,
    siteKey: enabled ? c.env.CF_TURNSTILE_SITE_KEY!.trim() : null,
  });
});
