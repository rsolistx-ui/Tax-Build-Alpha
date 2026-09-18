async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Signs a short-lived download token for one document (docId + expiry), HMAC'd with the app secret. */
export async function signDocumentToken(secret: string, docId: string, expiresAt: number): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${docId}.${expiresAt}`));
  return `${expiresAt}.${Buffer.from(sig).toString("base64url")}`;
}

export async function verifyDocumentToken(secret: string, docId: string, token: string): Promise<boolean> {
  const dotIndex = token.indexOf(".");
  if (dotIndex < 0) return false;
  const expiresAt = Number(token.slice(0, dotIndex));
  if (!expiresAt || Date.now() > expiresAt) return false;
  const key = await hmacKey(secret);
  const sigBytes = Buffer.from(token.slice(dotIndex + 1), "base64url");
  return crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(`${docId}.${expiresAt}`));
}
