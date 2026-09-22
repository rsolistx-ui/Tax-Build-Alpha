-- A signing link is a credential, not a URL parameter stored in plaintext.
-- The browser receives the token once; Neon stores only its SHA-256 digest.
CREATE TABLE IF NOT EXISTS signature_access_links (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  signature_request_id TEXT NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  issued_by_user_id TEXT NOT NULL,
  claimed_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS signature_access_links_active_idx
  ON signature_access_links(signature_request_id, recipient_email)
  WHERE revoked_at IS NULL AND consumed_at IS NULL;
