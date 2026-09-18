CREATE TABLE IF NOT EXISTS docu_sign_oauth_state (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_docu_sign_oauth_state_firm ON docu_sign_oauth_state(firm_id);
