import type { Db } from "../db";
import { newId } from "../lib/id";
import { getGmailAccessToken } from "./gmail";

const GMAIL_SCOPE = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
].join(" ");

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const bytes = fromBase64Url(secret);
  if (bytes.byteLength !== 32) throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY must be a 32-byte base64url secret");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptGmailRefreshToken(token: string, secret: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(secret), new TextEncoder().encode(token));
  return { ciphertext: base64Url(new Uint8Array(encrypted)), iv: base64Url(iv) };
}

export async function decryptGmailRefreshToken(ciphertext: string, iv: string, secret: string): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(iv) },
    await encryptionKey(secret),
    fromBase64Url(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

export function buildGmailOAuthUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: input.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function createGmailOAuthState(db: Db, firmId: string, redirectUri: string): Promise<string> {
  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  await db.query(
    `INSERT INTO gmail_oauth_states (id, firm_id, state, redirect_uri, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '10 minutes')`,
    [newId("gmo"), firmId, state, redirectUri],
  );
  return state;
}

export async function exchangeGmailCode(input: { clientId: string; clientSecret: string; code: string; redirectUri: string }): Promise<{ refreshToken: string; scope: string }> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) throw new Error(`Google OAuth token exchange failed (${response.status})`);
  const data = await response.json() as { refresh_token?: string; scope?: string };
  if (!data.refresh_token) throw new Error("Google did not provide a refresh token. Reconnect and approve access.");
  return { refreshToken: data.refresh_token, scope: data.scope ?? GMAIL_SCOPE };
}

/** Resolves a short-lived Gmail access token from the encrypted refresh token. */
export async function resolveGmailAccessToken(input: {
  clientId?: string;
  clientSecret?: string;
  encryptionKey?: string;
  refreshTokenCiphertext?: string | null;
  refreshTokenIv?: string | null;
}): Promise<string> {
  if (!input.clientId || !input.clientSecret || !input.encryptionKey || !input.refreshTokenCiphertext || !input.refreshTokenIv) {
    throw new Error("Gmail is not connected through OAuth.");
  }
  const refreshToken = await decryptGmailRefreshToken(input.refreshTokenCiphertext, input.refreshTokenIv, input.encryptionKey);
  const result = await getGmailAccessToken({ clientId: input.clientId, clientSecret: input.clientSecret, refreshToken });
  return result.accessToken;
}
