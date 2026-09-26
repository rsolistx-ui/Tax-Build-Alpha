function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

export const OUTBOX_DELIVERY_KEY_VERSION = "v1";
export const LEGACY_OUTBOX_DELIVERY_KEY_VERSION = "legacy-auth-v1";

async function key(secret: string, version: string): Promise<CryptoKey> {
  const salt = version === LEGACY_OUTBOX_DELIVERY_KEY_VERSION
    ? `truepost:outbox-signature:${secret}`
    : `truepost:outbox-signature:${version}:${secret}`;
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function associatedData(outboxId: string, version: string): Uint8Array {
  return new TextEncoder().encode(version === LEGACY_OUTBOX_DELIVERY_KEY_VERSION ? outboxId : `${version}:${outboxId}`);
}

export function outboxDeliveryKeyForVersion(env: { BETTER_AUTH_SECRET: string; OUTBOX_DELIVERY_KEY_V1?: string; OUTBOX_DELIVERY_LEGACY_AUTH_KEY?: string }, version: string): string {
  if (version === OUTBOX_DELIVERY_KEY_VERSION) {
    if (!env.OUTBOX_DELIVERY_KEY_V1) throw new Error("OUTBOX_DELIVERY_KEY_V1 is not configured");
    return env.OUTBOX_DELIVERY_KEY_V1;
  }
  // Rows created before the dedicated delivery key are recoverable until they
  // finish. New rows never use the authentication/session secret.
  if (version === LEGACY_OUTBOX_DELIVERY_KEY_VERSION) return env.OUTBOX_DELIVERY_LEGACY_AUTH_KEY || env.BETTER_AUTH_SECRET;
  throw new Error(`Unsupported outbox delivery key version: ${version}`);
}

export async function encryptOutboxDeliverySecret(value: string, secret: string, outboxId: string, version = OUTBOX_DELIVERY_KEY_VERSION): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: associatedData(outboxId, version) }, await key(secret, version), new TextEncoder().encode(value));
  return { ciphertext: base64Url(new Uint8Array(encrypted)), iv: base64Url(iv) };
}

export async function decryptOutboxDeliverySecret(ciphertext: string, iv: string, secret: string, outboxId: string, version = OUTBOX_DELIVERY_KEY_VERSION): Promise<string> {
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(iv), additionalData: associatedData(outboxId, version) }, await key(secret, version), fromBase64Url(ciphertext));
  return new TextDecoder().decode(plaintext);
}
