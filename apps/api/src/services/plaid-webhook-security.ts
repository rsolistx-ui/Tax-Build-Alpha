import { constantTimeEqual } from "./sms-webhook-security";
import type { PlaidBankFeedProvider } from "./plaid-provider";

type VerificationPayload = { iat?: number; request_body_sha256?: string };
type VerificationHeader = { alg?: string; kid?: string; typ?: string };

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodePart<T>(token: string, index: number): T | null {
  const part = token.split(".")[index];
  if (!part) return null;
  try { return JSON.parse(new TextDecoder().decode(fromBase64Url(part))) as T; } catch { return null; }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Validates Plaid's ES256 signature, a five-minute replay window, and the
 * exact raw-body digest before a webhook can change any bank-feed state.
 */
export async function isVerifiedPlaidWebhook(input: {
  body: string;
  verificationHeader?: string | null;
  provider: PlaidBankFeedProvider;
  now?: number;
}): Promise<boolean> {
  const token = input.verificationHeader;
  if (!token || token.split(".").length !== 3) return false;
  const header = decodePart<VerificationHeader>(token, 0);
  const payload = decodePart<VerificationPayload>(token, 1);
  if (header?.alg !== "ES256" || !header.kid || typeof payload?.iat !== "number" || !payload.request_body_sha256) return false;
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  if (payload.iat > nowSeconds + 30 || nowSeconds - payload.iat > 300) return false;
  const key = await input.provider.getWebhookVerificationKey(header.kid);
  if (key.alg !== "ES256" || key.kty !== "EC" || key.crv !== "P-256" || key.use !== "sig" || key.kid !== header.kid) return false;
  const signature = fromBase64Url(token.split(".")[2]!);
  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    await crypto.subtle.importKey("jwk", key, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]),
    signature,
    new TextEncoder().encode(token.split(".").slice(0, 2).join(".")),
  );
  return verified && constantTimeEqual(await sha256Hex(input.body), payload.request_body_sha256);
}
