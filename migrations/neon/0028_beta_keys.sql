CREATE TABLE IF NOT EXISTS beta_access_tokens (
  token TEXT PRIMARY KEY,
  firm_id TEXT REFERENCES firms(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  redeemed_by TEXT,
  redeemed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_beta_token_firm ON beta_access_tokens(firm_id, created_at DESC);