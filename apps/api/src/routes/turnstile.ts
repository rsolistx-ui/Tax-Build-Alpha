import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";

export const turnstileRoutes = new Hono<{ Bindings: Env }>();

/**
 * Returns public Turnstile site key configuration to the frontend.
 */
turnstileRoutes.get("/config", (c) => {
  const siteKey = c.env.CF_TURNSTILE_SITE_KEY?.trim();
  return c.json({
    enabled: Boolean(siteKey),
    siteKey: siteKey || null,
  });
});

/**
 * Verifies Turnstile challenge token server-side with Cloudflare.
 */
turnstileRoutes.post("/verify", async (c) => {
  const secretKey = c.env.CF_TURNSTILE_SECRET_KEY?.trim();

  // If Turnstile is unconfigured in development/desktop mode, allow seamless bypass
  if (!secretKey) {
    return c.json({
      success: true,
      simulated: true,
      message: "Turnstile verification bypassed (unconfigured development environment).",
    });
  }

  const body = z.object({
    token: z.string().min(1, "Turnstile token is required"),
  }).safeParse(await c.req.json().catch(() => ({})));

  if (!body.success) {
    return c.json({
      success: false,
      error: "Invalid request payload: Turnstile token is required",
    }, 400);
  }

  try {
    const formData = new URLSearchParams();
    formData.append("secret", secretKey);
    formData.append("response", body.data.token);

    const clientIp =
      c.req.header("cf-connecting-ip") ||
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (clientIp) {
      formData.append("remoteip", clientIp);
    }

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      "error-codes"?: string[];
    };

    if (data.success) {
      return c.json({ success: true, simulated: false });
    }

    return c.json({
      success: false,
      error: "Security verification failed. Please complete the security check again.",
      codes: data["error-codes"] || [],
    }, 403);
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Unknown error";
    console.error("[Turnstile] Cloudflare siteverify exception:", errorMsg);
    return c.json({
      success: false,
      error: "Unable to contact verification service.",
    }, 502);
  }
});
