import { Hono } from "hono";
import Stripe from "stripe";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { requireSession } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { buildStripeOAuthUrl, createStripeOAuthState, exchangeStripeOAuthCode } from "../services/stripe-oauth";
import { newId } from "../lib/id";

export const stripeOAuthRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

function callbackUrl(env: Env): string {
  const origin = env.APP_ORIGIN?.replace(/\/$/, "");
  if (!origin) throw new Error("APP_ORIGIN is not configured");
  return `${origin}/api/stripe/oauth/callback`;
}

function safeReturnUrl(env: Env, outcome: "connected" | "not_connected" | "expired"): string {
  const origin = env.APP_ORIGIN?.replace(/\/$/, "");
  return `${origin ?? ""}/connections?stripe=${outcome}`;
}

// A signed-in owner starts the flow; Stripe then handles its own login and consent.
stripeOAuthRoutes.post("/start", requireSession, requireActiveBeta, async (c) => {
  if (!c.env.STRIPE_SECRET_KEY || !c.env.STRIPE_CONNECT_CLIENT_ID) {
    return c.json({ error: "Stripe connection is not configured by the account owner yet." }, 503);
  }
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const redirectUri = callbackUrl(c.env);
  const state = await createStripeOAuthState(db, firm.id, redirectUri);
  return c.json({ authorizationUrl: buildStripeOAuthUrl({ clientId: c.env.STRIPE_CONNECT_CLIENT_ID, redirectUri, state }) });
});

// Stripe calls this route after consent. The one-time state is the only firm binding.
stripeOAuthRoutes.get("/callback", async (c) => {
  const error = c.req.query("error");
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (error || !code || !state || !c.env.STRIPE_SECRET_KEY || !c.env.STRIPE_CONNECT_CLIENT_ID) {
    return c.redirect(safeReturnUrl(c.env, "not_connected"));
  }

  const db = createDb(c.env);
  const [pending] = await db.query<{ firm_id: string; redirect_uri: string }>(
    `DELETE FROM stripe_connect_oauth_states
     WHERE state = $1 AND expires_at > NOW() AND consumed_at IS NULL
     RETURNING firm_id, redirect_uri`,
    [state],
  );
  if (!pending || pending.redirect_uri !== callbackUrl(c.env)) {
    return c.redirect(safeReturnUrl(c.env, "expired"));
  }

  try {
    const result = await exchangeStripeOAuthCode({
      clientId: c.env.STRIPE_CONNECT_CLIENT_ID,
      clientSecret: c.env.STRIPE_SECRET_KEY,
      code,
    });
    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, { apiVersion: "2026-08-26.dahlia" });
    const account = await stripe.accounts.retrieve(result.stripeAccountId);
    await db.query(
      `INSERT INTO stripe_connect_accounts
        (id, firm_id, stripe_account_id, account_type, charges_enabled, payouts_enabled, details_submitted, requirements, capabilities, business_type, business_profile)
       VALUES ($1,$2,$3,'standard',$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (firm_id) DO UPDATE SET
         stripe_account_id = EXCLUDED.stripe_account_id,
         account_type = 'standard',
         charges_enabled = EXCLUDED.charges_enabled,
         payouts_enabled = EXCLUDED.payouts_enabled,
         details_submitted = EXCLUDED.details_submitted,
         requirements = EXCLUDED.requirements,
         capabilities = EXCLUDED.capabilities,
         business_type = EXCLUDED.business_type,
         business_profile = EXCLUDED.business_profile,
         updated_at = NOW()`,
      [
        newId("strca"), pending.firm_id, account.id, account.charges_enabled, account.payouts_enabled,
        account.details_submitted, JSON.stringify(account.requirements), JSON.stringify(account.capabilities),
        account.business_type ?? null, JSON.stringify(account.business_profile ?? {}),
      ],
    );
    return c.redirect(safeReturnUrl(c.env, "connected"));
  } catch (error) {
    console.error("Stripe OAuth connection failed", error);
    return c.redirect(safeReturnUrl(c.env, "not_connected"));
  }
});
