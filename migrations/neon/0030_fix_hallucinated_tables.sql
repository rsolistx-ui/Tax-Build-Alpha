CREATE TABLE IF NOT EXISTS docu_sign_config (
  firm_id TEXT PRIMARY KEY REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  integrator_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  base_url TEXT NOT NULL,
  account_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  access_token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS docu_sign_envelopes (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  envelope_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  document_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_docu_sign_envelopes_firm ON docu_sign_envelopes(firm_id);
CREATE INDEX IF NOT EXISTS idx_docu_sign_envelopes_client ON docu_sign_envelopes(client_id);

CREATE TABLE IF NOT EXISTS gmail_config (
  firm_id TEXT PRIMARY KEY REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  access_token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
