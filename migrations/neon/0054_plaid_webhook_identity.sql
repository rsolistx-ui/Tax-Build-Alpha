-- Plaid emits Item-based webhooks, while access tokens stay encrypted. Keep
-- the non-secret Item identifier separately for replay-safe routing.
ALTER TABLE bank_connections
  ADD COLUMN IF NOT EXISTS provider_item_id TEXT;

CREATE INDEX IF NOT EXISTS idx_bank_connections_plaid_item
  ON bank_connections(provider, provider_item_id)
  WHERE provider_item_id IS NOT NULL;
