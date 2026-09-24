async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * "all": the minter may read signed records. "unsigned": minted for a role
 * that may not, so redemption re-checks the document is still not a signed
 * record (a signature request can be attached after the link was issued).
 */
export type DocumentTokenScope = "all" | "unsigned";

function tokenPayload(docId: string, expiresAt: number, scope: DocumentTokenScope): string {
  return scope === "unsigned" ? `${docId}.${expiresAt}.unsigned` : `${docId}.${expiresAt}`;
}

/** Signs a short-lived download token for one document (docId + expiry + scope), HMAC'd with the app secret. */
export async function signDocumentToken(secret: string, docId: string, expiresAt: number, scope: DocumentTokenScope = "all"): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(tokenPayload(docId, expiresAt, scope)));
  const encoded = Buffer.from(sig).toString("base64url");
  return scope === "unsigned" ? `${expiresAt}.u.${encoded}` : `${expiresAt}.${encoded}`;
}

/** Returns the token's scope when it is valid for this document and unexpired, otherwise null. */
export async function verifyDocumentToken(secret: string, docId: string, token: string): Promise<DocumentTokenScope | null> {
  const parts = token.split(".");
  const scope: DocumentTokenScope | null = parts.length === 2 ? "all" : parts.length === 3 && parts[1] === "u" ? "unsigned" : null;
  if (!scope) return null;
  const expiresAt = Number(parts[0]);
  if (!expiresAt || Date.now() > expiresAt) return null;
  const key = await hmacKey(secret);
  const sigBytes = Buffer.from(parts[parts.length - 1], "base64url");
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(tokenPayload(docId, expiresAt, scope)));
  return ok ? scope : null;
}
