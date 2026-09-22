import { Hono } from "hono";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { requireSession } from "../middleware/session";
import { createDb } from "../db";
import { ensureFirm } from "../services/firm";
import { buildGmailOAuthUrl, createGmailOAuthState, encryptGmailRefreshToken, exchangeGmailCode } from "../services/gmail-oauth";

export const gmailOAuthRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

function callbackUrl(env: Env): string {
  const origin = env.APP_ORIGIN?.replace(/\/$/, "");
  if (!origin) throw new Error("APP_ORIGIN is not configured");
  return `${origin}/api/gmail/oauth/callback`;
}

gmailOAuthRoutes.get("/start", requireSession, requireActiveBeta, async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET || !c.env.GMAIL_TOKEN_ENCRYPTION_KEY) {
    return c.json({ error: "Gmail OAuth is not configured by the account owner yet." }, 503);
  }
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const redirectUri = callbackUrl(c.env);
  const state = await createGmailOAuthState(db, firm.id, redirectUri);
  return c.json({ authorizationUrl: buildGmailOAuthUrl({ clientId: c.env.GOOGLE_CLIENT_ID, redirectUri, state }) });
});

// Google calls this route after the user authorizes access. State is a
// one-time, short-lived binding to a firm; no session or token is accepted.
gmailOAuthRoutes.get("/callback", async (c) => {
  const safeReturn = `${c.env.APP_ORIGIN?.replace(/\/$/, "") ?? ""}/connections`;
  const error = c.req.query("error");
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (error || !code || !state || !c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET || !c.env.GMAIL_TOKEN_ENCRYPTION_KEY) {
    return c.redirect(`${safeReturn}?gmail=not_connected`);
  }
  const db = createDb(c.env);
  const [pending] = await db.query<{ firm_id: string; redirect_uri: string }>(
    `DELETE FROM gmail_oauth_states WHERE state = $1 AND expires_at > NOW() RETURNING firm_id, redirect_uri`,
    [state],
  );
  if (!pending) return c.redirect(`${safeReturn}?gmail=expired`);
  try {
    const token = await exchangeGmailCode({ clientId: c.env.GOOGLE_CLIENT_ID, clientSecret: c.env.GOOGLE_CLIENT_SECRET, code, redirectUri: pending.redirect_uri });
    const encrypted = await encryptGmailRefreshToken(token.refreshToken, c.env.GMAIL_TOKEN_ENCRYPTION_KEY);
    await db.query(
      `INSERT INTO gmail_config (firm_id, client_id, client_secret, refresh_token, refresh_token_ciphertext, refresh_token_iv, granted_scope, connected_at)
       VALUES ($1, '', '', '', $2, $3, $4, NOW())
       ON CONFLICT (firm_id) DO UPDATE SET refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
         refresh_token_iv = EXCLUDED.refresh_token_iv, granted_scope = EXCLUDED.granted_scope,
         connected_at = NOW(), client_secret = '', refresh_token = '', access_token = NULL, access_token_expires_at = NULL, updated_at = NOW()`,
      [pending.firm_id, encrypted.ciphertext, encrypted.iv, token.scope],
    );
    return c.redirect(`${safeReturn}?gmail=connected`);
  } catch {
    return c.redirect(`${safeReturn}?gmail=not_connected`);
  }
});
