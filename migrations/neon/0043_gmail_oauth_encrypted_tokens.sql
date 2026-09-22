-- Gmail credentials belong to the individual firm connection, never to a
-- browser form. Refresh tokens are encrypted in the Worker before storage.
-- Some early deployments predate the optional Gmail migration. Keep this
-- prerequisite local to the feature rather than assuming unrelated legacy
-- DocuSign tables were applied.
CREATE TABLE IF NOT EXISTS gmail_config (
  firm_id TEXT PRIMARY KEY REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL DEFAULT '',
  client_secret TEXT NOT NULL DEFAULT '',
  refresh_token TEXT NOT NULL DEFAULT '',
  access_token TEXT,
  access_token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE gmail_config
  ADD COLUMN IF NOT EXISTS refresh_token_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token_iv TEXT,
  ADD COLUMN IF NOT EXISTS granted_scope TEXT,
  ADD COLUMN IF NOT EXISTS connected_email TEXT,
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS gmail_oauth_states (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  state TEXT NOT NULL UNIQUE,
  redirect_uri TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gmail_oauth_states_expiry ON gmail_oauth_states(expires_at);
