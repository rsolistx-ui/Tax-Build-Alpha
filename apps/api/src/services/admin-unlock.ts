import type { Env } from "../env";

/**
 * The admin panel (/control) is unlocked with the master token plus a Cloudflare Turnstile check.
 * Turnstile tokens are single-use, so a passed check is exchanged for a short signed pass that
 * rides in an HttpOnly cookie and is bound to the signed-in user.
 */
export const ADMIN_UNLOCK_COOKIE = "truepost_admin_unlock";
export const ADMIN_UNLOCK_TTL_SECONDS = 8 * 60 * 60;

/** Both keys are required: enforcing without a site key would leave no way to pass the check. */
export function turnstileConfigured(env: Env): boolean {
  return Boolean(env.CF_TURNSTILE_SITE_KEY?.trim() && env.CF_TURNSTILE_SECRET_KEY?.trim());
}

export async function verifyTurnstile(env: Env, token: string, remoteIp: string | null): Promise<boolean> {
  const form = new URLSearchParams({ secret: env.CF_TURNSTILE_SECRET_KEY!.trim(), response: token });
  if (remoteIp) form.append("remoteip", remoteIp);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean };
  return data.success === true;
}

async function sign(env: Env, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.BETTER_AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`admin-unlock:${payload}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function issueAdminUnlock(env: Env, userId: string, nowMs = Date.now()): Promise<string> {
  const expires = Math.floor(nowMs / 1000) + ADMIN_UNLOCK_TTL_SECONDS;
  return `${expires}.${await sign(env, `${userId}.${expires}`)}`;
}

export async function isValidAdminUnlock(env: Env, userId: string, value: string | undefined, nowMs = Date.now()): Promise<boolean> {
  if (!value || !userId) return false;
  const [expiresRaw, mac] = value.split(".");
  const expires = Number(expiresRaw);
  if (!Number.isInteger(expires) || !mac || expires * 1000 <= nowMs) return false;
  const expected = await sign(env, `${userId}.${expires}`);
  if (expected.length !== mac.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ mac.charCodeAt(i);
  return diff === 0;
}
