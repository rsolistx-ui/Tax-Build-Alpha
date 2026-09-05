import { betterAuth } from "better-auth";
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
    advanced: {
      defaultCookieAttributes: {
        // Production serves the SPA and API from the same Worker origin, so
        // the auth cookie stays first-party instead of relying on cross-site
        // Pages-to-Workers cookie behavior.
        sameSite: "lax",
        secure: production,
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
