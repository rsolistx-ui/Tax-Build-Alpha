-- Milestone 3: QuickBooks Integration
-- OAuth tokens, sync cursors, account mappings, conflict resolution. Replay-safe.

-- OAuth token storage (one per firm)
CREATE TABLE IF NOT EXISTS quickbooks_tokens (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  realm_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  token_type TEXT NOT NULL DEFAULT 'bearer',
  x_refresh_token_expires_in INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id)
);
CREATE INDEX IF NOT EXISTS idx_qb_tokens_firm ON quickbooks_tokens(firm_id);

-- Sync cursors for incremental webhook-driven sync
CREATE TABLE IF NOT EXISTS quickbooks_sync_cursors (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  last_sync TIMESTAMPTZ NOT NULL,
  last_change_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, entity_type)
);
CREATE INDEX IF NOT EXISTS idx_qb_cursors_firm ON quickbooks_sync_cursors(firm_id);

-- Account mappings (Folio account -> QBO account)
CREATE TABLE IF NOT EXISTS quickbooks_account_mappings (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  folio_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  qbo_account_id TEXT NOT NULL,
  mapping_type TEXT NOT NULL DEFAULT 'direct' CHECK (mapping_type IN ('direct', 'category', 'default')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, folio_account_id)
);
CREATE INDEX IF NOT EXISTS idx_qb_acct_mappings_firm ON quickbooks_account_mappings(firm_id);

-- Sync conflict resolution
CREATE TABLE IF NOT EXISTS quickbooks_sync_conflicts (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  qbo_entity_id TEXT NOT NULL,
  folio_entity_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  conflict_type TEXT NOT NULL CHECK (conflict_type IN ('update_update', 'delete_update', 'update_delete', 'create_create')),
  qbo_version TEXT NOT NULL,
  folio_data JSONB NOT NULL,
  qbo_data JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved_folio_wins', 'resolved_qbo_wins', 'merged')),
  resolved_at TIMESTAMPTZ,
  resolved_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qb_conflicts_firm_status ON quickbooks_sync_conflicts(firm_id, status);
CREATE INDEX IF NOT EXISTS idx_qb_conflicts_entity ON quickbooks_sync_conflicts(entity_type, qbo_entity_id);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_quickbooks_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_quickbooks_tokens_updated_at
  BEFORE UPDATE ON quickbooks_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_quickbooks_tokens_updated_at();

CREATE OR REPLACE FUNCTION update_quickbooks_sync_cursors_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_quickbooks_sync_cursors_updated_at
  BEFORE UPDATE ON quickbooks_sync_cursors
  FOR EACH ROW
  EXECUTE FUNCTION update_quickbooks_sync_cursors_updated_at();

CREATE OR REPLACE FUNCTION update_quickbooks_account_mappings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_quickbooks_account_mappings_updated_at
  BEFORE UPDATE ON quickbooks_account_mappings
  FOR EACH ROW
  EXECUTE FUNCTION update_quickbooks_account_mappings_updated_at();

CREATE OR REPLACE FUNCTION update_quickbooks_sync_conflicts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_quickbooks_sync_conflicts_updated_at
  BEFORE UPDATE ON quickbooks_sync_conflicts
  FOR EACH ROW
  EXECUTE FUNCTION update_quickbooks_sync_conflicts_updated_at();