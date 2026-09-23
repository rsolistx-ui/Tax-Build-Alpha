/**
 * True only when this device has a built-in fingerprint, face or PIN unlock that can hold a passkey
 * (Windows Hello, Touch ID, Face ID, Android biometrics). The fingerprint option is never shown otherwise.
 */
export async function deviceSupportsFingerprint(): Promise<boolean> {
  try {
    if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}
