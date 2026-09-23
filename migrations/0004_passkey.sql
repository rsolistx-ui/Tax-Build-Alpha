-- Fingerprint / face / device-PIN sign-in (WebAuthn passkeys) for the Better Auth passkey plugin.
-- Only the public key is stored; the fingerprint never leaves the user's device.

CREATE TABLE IF NOT EXISTS passkey (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  publicKey TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  credentialID TEXT NOT NULL,
  counter INTEGER NOT NULL,
  deviceType TEXT NOT NULL,
  backedUp INTEGER NOT NULL,
  transports TEXT,
  createdAt DATE,
  aaguid TEXT
);

CREATE INDEX IF NOT EXISTS idx_passkey_user ON passkey(userId);
CREATE INDEX IF NOT EXISTS idx_passkey_credential ON passkey(credentialID);
