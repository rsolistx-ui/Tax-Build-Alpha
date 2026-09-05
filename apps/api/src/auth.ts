import { betterAuth } from "better-auth";
import type { Env } from "./env";

/**
 * Better Auth on D1 — email/password (no outbound email needed for alpha).
 * Magic link can be added later when a free email path exists.
 */
export function createAuth(env: Env) {
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET || "dev-only-change-me-32chars-minimum!!",
    baseURL: env.BETTER_AUTH_URL || "http://localhost:8787",
    basePath: "/api/auth",
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
    },
    trustedOrigins: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:3000",
    ],
    advanced: {
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: false, // set true in production HTTPS
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
