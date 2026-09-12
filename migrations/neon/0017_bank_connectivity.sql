-- Milestone 4: Bank Connectivity
-- Bank connections, accounts, transactions, sync cursors. Replay-safe.

-- Bank connections (one per firm/client per provider)
CREATE TABLE IF NOT EXISTS bank_connections (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('plaid', 'finicity', 'mx', 'akoya', 'teller')),
  provider_connection_id TEXT NOT NULL,  -- Plaid's access_token/item_id, Teller's access_token, etc.
  institution_id TEXT NOT NULL,
  institution_name TEXT NOT NULL,
  institution_logo TEXT,
  institution_primary_color TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_reauth', 'error', 'disconnected')),
  last_sync_at TIMESTAMPTZ,
  last_successful_sync_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, client_id, provider, provider_connection_id)
);
CREATE INDEX IF NOT EXISTS idx_bank_connections_firm ON bank_connections(firm_id);
CREATE INDEX IF NOT EXISTS idx_bank_connections_client ON bank_connections(client_id);
CREATE INDEX IF NOT EXISTS idx_bank_connections_status ON bank_connections(status);

-- Bank accounts (per connection)
CREATE TABLE IF NOT EXISTS bank_accounts (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
  provider_account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  official_name TEXT,
  type TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'credit', 'investment', 'loan', 'other')),
  subtype TEXT,
  mask TEXT,
  current_balance NUMERIC(14,2),
  available_balance NUMERIC(14,2),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'closed')),
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, provider_account_id)
);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_connection ON bank_accounts(connection_id);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_provider_account ON bank_accounts(provider_account_id);

-- External bank transactions (from provider, before matching/reconciliation)
CREATE TABLE IF NOT EXISTS bank_transactions_external (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  provider_transaction_id TEXT NOT NULL,
  date DATE NOT NULL,
  authorized_date DATE,
  description TEXT NOT NULL,
  merchant_name TEXT,
  amount NUMERIC(14,2) NOT NULL,  -- positive = debit/outflow, negative = credit/inflow
  currency TEXT NOT NULL DEFAULT 'USD',
  category TEXT[],
  category_id TEXT,
  pending BOOLEAN NOT NULL DEFAULT FALSE,
  raw_category TEXT,
  location JSONB,
  provider_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, provider_transaction_id)
);
CREATE INDEX IF NOT EXISTS idx_bank_txn_external_connection ON bank_transactions_external(connection_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_txn_external_account ON bank_transactions_external(account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_txn_external_pending ON bank_transactions_external(connection_id, pending) WHERE pending = TRUE;

-- Sync cursors for incremental sync
CREATE TABLE IF NOT EXISTS bank_sync_cursors (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  cursor TEXT NOT NULL,  -- provider-specific cursor (Plaid's cursor, Finicity's lastTransactionId, etc.)
  last_sync_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_successful_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_bank_sync_cursors_connection ON bank_sync_cursors(connection_id);

-- Encryption key versioning for access tokens
CREATE TABLE IF NOT EXISTS encryption_key_versions (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE,
  key_data TEXT NOT NULL,  -- base64 encoded 32-byte key
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_encryption_keys_active ON encryption_key_versions(is_active) WHERE is_active = TRUE;

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_bank_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_bank_connections_updated_at
  BEFORE UPDATE ON bank_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_bank_connections_updated_at();

CREATE OR REPLACE FUNCTION update_bank_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_bank_accounts_updated_at
  BEFORE UPDATE ON bank_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_bank_accounts_updated_at();

CREATE OR REPLACE FUNCTION update_bank_transactions_external_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_bank_transactions_external_updated_at
  BEFORE UPDATE ON bank_transactions_external
  FOR EACH ROW
  EXECUTE FUNCTION update_bank_transactions_external_updated_at();

CREATE OR REPLACE FUNCTION update_bank_sync_cursors_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_bank_sync_cursors_updated_at
  BEFORE UPDATE ON bank_sync_cursors
  FOR EACH ROW
  EXECUTE FUNCTION update_bank_sync_cursors_updated_at();