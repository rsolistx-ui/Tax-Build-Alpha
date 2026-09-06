-- Milestone: Phyllis beta access, Windows distribution, and security gate.
-- Invitation-only registration and server-authoritative beta entitlements.
-- Replay-safe.

CREATE TABLE IF NOT EXISTS beta_invitations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  issued_by_user_id TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  redeemed_by_user_id TEXT,
  beta_days INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE beta_invitations
    ADD CONSTRAINT chk_beta_invitation_status CHECK (status IN ('pending', 'redeemed', 'revoked', 'expired'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_beta_invitations_token_hash ON beta_invitations (token_hash);
CREATE INDEX IF NOT EXISTS idx_beta_invitations_email ON beta_invitations (LOWER(email));

CREATE TABLE IF NOT EXISTS beta_entitlements (
  user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id TEXT,
  revocation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE beta_entitlements
    ADD CONSTRAINT chk_beta_entitlement_status CHECK (status IN ('active', 'expired', 'revoked'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS beta_access_events (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  actor_user_id TEXT,
  affected_user_id TEXT,
  affected_email TEXT,
  before_json JSONB,
  after_json JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_beta_access_events_affected ON beta_access_events (affected_user_id, created_at DESC);
