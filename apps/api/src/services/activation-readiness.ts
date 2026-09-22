import type { Env } from "../env";

export type ActivationCapability = {
  capability: string;
  state: "ready" | "setup_required" | "partner_required";
  detail: string;
};

const configured = (...values: Array<string | undefined>) => values.every((value) => Boolean(value?.trim()));

/**
 * Non-secret deployment readiness. This is intentionally a capability report,
 * not a configuration dump: it exposes neither key names nor values beyond
 * what an authorized operator needs to finish activation.
 */
export function getActivationReadiness(env: Env): ActivationCapability[] {
  return [
    {
      capability: "Application database and sign-in",
      state: configured(env.DATABASE_URL, env.BETTER_AUTH_SECRET) ? "ready" : "setup_required",
      detail: "The Neon database and Better Auth session secret are required for every workspace.",
    },
    {
      capability: "Turnstile bot protection",
      state: configured(env.CF_TURNSTILE_SITE_KEY, env.CF_TURNSTILE_SECRET_KEY) ? "ready" : "setup_required",
      detail: "Add the Cloudflare Turnstile site and secret keys, then complete a live login verification.",
    },
    {
      capability: "Telegram operations alerts",
      state: configured(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID) ? "ready" : "setup_required",
      detail: "Add a BotFather token and destination chat ID. Until then, notifications are explicitly skipped.",
    },
    {
      capability: "Carrier-authenticated SMS receipt intake",
      state: configured(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN) ? "ready" : "setup_required",
      detail: "Add Twilio credentials and configure the signed inbound webhook. SMS evidence always enters professional review.",
    },
    {
      capability: "Outbound client email",
      state: configured(env.RESEND_API_KEY, env.SENDER_EMAIL) ? "ready" : "setup_required",
      detail: "Add a Resend key and verified sender address before any email delivery claim is made.",
    },
    {
      capability: "Live bank feeds",
      state: configured(env.PLAID_CLIENT_ID, env.PLAID_CLIENT_SECRET) || configured(env.TELLER_CLIENT_ID, env.TELLER_CLIENT_SECRET) ? "ready" : "setup_required",
      detail: "Connect either Plaid or Teller, complete their webhook verification, and test a real institution before enabling live feeds.",
    },
    {
      capability: "Return e-file submission",
      state: "partner_required",
      detail: "Truepost produces a reviewable preparer packet; tax-return transmission requires the practitioner's EFIN and an approved tax-software or e-file-provider relationship.",
    },
  ];
}
