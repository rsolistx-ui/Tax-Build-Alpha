-- A one-time, expiring state record binds Stripe's hosted OAuth response to a firm.
-- No Stripe OAuth access token is persisted by Truepost.
CREATE TABLE IF NOT EXISTS stripe_connect_oauth_states (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  state TEXT NOT NULL UNIQUE,
  redirect_uri TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stripe_connect_oauth_states_active
  ON stripe_connect_oauth_states(state, expires_at)
  WHERE consumed_at IS NULL;
