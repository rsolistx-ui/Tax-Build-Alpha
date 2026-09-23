import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { Env } from "../env";
import { requireSession, type AuthedVars } from "../middleware/session";
import { isOwnerEmail, isValidAdminMasterToken } from "../middleware/beta";
import { ADMIN_UNLOCK_COOKIE, ADMIN_UNLOCK_TTL_SECONDS, issueAdminUnlock, turnstileConfigured, verifyTurnstile } from "../services/admin-unlock";

export const adminUnlockRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

/** Exchanges master token + a passed Turnstile check for an 8-hour admin panel pass. */
adminUnlockRoutes.post("/", requireSession, async (c) => {
  if (!isOwnerEmail(c.env, c.get("userEmail"))) return c.json({ error: "Owner access required", code: "OWNER_REQUIRED" }, 403);
  if (c.env.ADMIN_MASTER_TOKEN && !isValidAdminMasterToken(c.env, c.req.header("x-admin-token"))) {
    return c.json({ error: "Admin master security token required", code: "MASTER_TOKEN_REQUIRED" }, 403);
  }
  if (!turnstileConfigured(c.env)) return c.json({ unlocked: true, turnstile: false });

  const body = z.object({ turnstileToken: z.string().min(1) }).safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "Complete the Cloudflare security check.", code: "TURNSTILE_REQUIRED" }, 400);
  const passed = await verifyTurnstile(c.env, body.data.turnstileToken, c.req.header("cf-connecting-ip") ?? null).catch(() => false);
  if (!passed) return c.json({ error: "The security check did not pass. Try it again.", code: "TURNSTILE_FAILED" }, 403);

  setCookie(c, ADMIN_UNLOCK_COOKIE, await issueAdminUnlock(c.env, c.get("userId")), {
    httpOnly: true,
    secure: c.env.BETTER_AUTH_URL?.startsWith("https://") ?? false,
    sameSite: "Strict",
    path: "/api",
    maxAge: ADMIN_UNLOCK_TTL_SECONDS,
  });
  return c.json({ unlocked: true, turnstile: true });
});

/** Lock Console: drops the pass so the next unlock needs a fresh check. */
adminUnlockRoutes.delete("/", (c) => {
  deleteCookie(c, ADMIN_UNLOCK_COOKIE, { path: "/api" });
  return c.json({ locked: true });
});
