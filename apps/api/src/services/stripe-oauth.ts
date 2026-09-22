import type { Db } from "../db";
import { newId } from "../lib/id";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Builds the hosted Stripe consent URL for an already-existing Standard account. */
export function buildStripeOAuthUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: "read_write",
    state: input.state,
  });
  return `https://connect.stripe.com/oauth/authorize?${params}`;
}

/** State ties the hosted consent response to one firm and can only be used once. */
export async function createStripeOAuthState(db: Db, firmId: string, redirectUri: string): Promise<string> {
  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  await db.query(
    `INSERT INTO stripe_connect_oauth_states (id, firm_id, state, redirect_uri, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '10 minutes')`,
    [newId("sco"), firmId, state, redirectUri],
  );
  return state;
}

export async function exchangeStripeOAuthCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
}): Promise<{ stripeAccountId: string }> {
  const response = await fetch("https://connect.stripe.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) throw new Error(`Stripe OAuth token exchange failed (${response.status})`);
  const data = await response.json() as { stripe_user_id?: string };
  if (!data.stripe_user_id) throw new Error("Stripe did not return the connected account ID.");
  return { stripeAccountId: data.stripe_user_id };
}
