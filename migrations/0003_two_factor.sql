-- Multi-factor authentication (FTC Safeguards Rule, 16 CFR 314.4(c)(5); tax
-- preparers are covered financial institutions under 16 CFR 314.2).
-- Schema for the Better Auth two-factor plugin (TOTP authenticator apps plus
-- one-time backup codes).

ALTER TABLE user ADD COLUMN twoFactorEnabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS twoFactor (
  id TEXT PRIMARY KEY NOT NULL,
  secret TEXT NOT NULL,
  backupCodes TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  verified INTEGER NOT NULL DEFAULT 1,
  failedVerificationCount INTEGER NOT NULL DEFAULT 0,
  lockedUntil TEXT
);

CREATE INDEX IF NOT EXISTS idx_two_factor_user ON twoFactor(userId);
CREATE INDEX IF NOT EXISTS idx_two_factor_secret ON twoFactor(secret);
