import { betterAuth } from "better-auth";
import { captcha, twoFactor } from "better-auth/plugins";
import type { Env } from "./env";

/**
 * Better Auth stays on D1 while accounting data moves to Neon. Keeping auth
 * isolated avoids a risky session migration during the paid-alpha build.
 */
export function createAuth(env: Env) {
  const production = env.BETTER_AUTH_URL?.startsWith("https://") ?? false;
  const trustedOrigins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
  ];
  if (env.APP_ORIGIN) trustedOrigins.push(env.APP_ORIGIN);
  const turnstileSecret = turnstileConfigured(env) ? env.CF_TURNSTILE_SECRET_KEY!.trim() : null;

  return betterAuth({
    database: env.AUTH_DB,
    secret: env.BETTER_AUTH_SECRET || "dev-only-change-me-32chars-minimum!!",
    baseURL: env.BETTER_AUTH_URL || "http://localhost:8787",
    basePath: "/api/auth",
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
    },
    trustedOrigins,
    // Multi-factor sign-in (FTC Safeguards Rule, 16 CFR 314.4(c)(5)).
    // Turnstile is checked by the server on sign-in and password reset, not only in the browser.
    plugins: [
      twoFactor({ issuer: "Truepost" }),
      ...(turnstileSecret ? [captcha({ provider: "cloudflare-turnstile", secretKey: turnstileSecret })] : []),
    ],
    advanced: {
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: production,
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Both keys are required: enforcing without a site key would leave no way to pass the check. */
export function turnstileConfigured(env: Env): boolean {
  return Boolean(env.CF_TURNSTILE_SITE_KEY?.trim() && env.CF_TURNSTILE_SECRET_KEY?.trim());
}
