import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import type { Env } from "./env";
import { sendEmail } from "./services/signature-reminders";

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
    // Multi-factor sign-in (FTC Safeguards Rule, 16 CFR 314.4(c)(5)).
    // The second step is a 6-digit code emailed at sign-in, so no authenticator app is needed.
    plugins: [twoFactor({ issuer: "Truepost", otpOptions: { sendOTP: async ({ user, otp }) => { await sendSignInCode(env, user.email, otp); }, period: 10, storeOTP: "hashed", allowedAttempts: 5 } })],
    advanced: {
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: production,
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Emails the sign-in code. Addresses at the reserved example.com domain cannot receive mail, so nothing is sent to them. */
export async function sendSignInCode(env: Env, email: string, code: string, deps: { fetch?: typeof fetch } = {}): Promise<boolean> {
  if (/@example\.com$/i.test(email)) return false;
  return sendEmail(env, {
    to: email,
    fromName: "Truepost",
    subject: `Your Truepost sign-in code: ${code}`,
    text: `Your Truepost sign-in code is ${code}. It expires in 10 minutes. If you did not try to sign in, change your password.`,
    html: `<p>Your Truepost sign-in code is</p><p style="font-size:28px;font-weight:600;letter-spacing:4px">${code}</p><p>It expires in 10 minutes. If you did not try to sign in, change your password.</p>`,
  }, deps);
}
