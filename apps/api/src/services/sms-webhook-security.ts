/**
 * Narrow, provider-specific guardrails for an inbound Twilio MMS webhook.
 *
 * SMS is intentionally fail-closed: a public endpoint must never accept a
 * caller supplied media URL or phone number unless Twilio has signed the
 * complete request. Keeping this logic pure also makes its security contract
 * independently testable.
 */
const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function isPermittedTwilioMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "api.twilio.com" || url.hostname.endsWith(".twilio.com"));
  } catch {
    return false;
  }
}

export async function twilioSignatureFor(
  authToken: string,
  requestUrl: string,
  form: Record<string, string>,
): Promise<string> {
  const payload = requestUrl + Object.keys(form).sort().map((key) => `${key}${form[key]}`).join("");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  return toBase64(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}

/** Constant-time comparison for the base64 HMAC values. */
export function constantTimeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a[index % (a.length || 1)] ?? 0) ^ (b[index % (b.length || 1)] ?? 0);
  }
  return mismatch === 0;
}

export async function hasValidTwilioSignature(input: {
  authToken: string | undefined;
  requestUrl: string;
  signature: string | undefined;
  form: Record<string, string>;
}): Promise<boolean> {
  if (!input.authToken || !input.signature) return false;
  return constantTimeEqual(await twilioSignatureFor(input.authToken, input.requestUrl, input.form), input.signature);
}
