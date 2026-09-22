-- Projects provider-synced transactions into the same human review queue as
-- CSV imports. This link is deliberately one-way and replay-safe: sync never
-- posts a journal entry or approves an accounting disposition.

CREATE TABLE IF NOT EXISTS bank_transaction_provider_links (
  external_transaction_id TEXT PRIMARY KEY
    REFERENCES bank_transactions_external(id) ON DELETE CASCADE,
  bank_transaction_id TEXT NOT NULL UNIQUE
    REFERENCES bank_transactions(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL
    REFERENCES bank_connections(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_provider_links_connection
  ON bank_transaction_provider_links(connection_id);
