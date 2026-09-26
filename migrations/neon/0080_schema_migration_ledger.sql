CREATE TABLE IF NOT EXISTS truepost_schema_migrations (
  filename TEXT PRIMARY KEY,
  checksum_sha256 CHAR(64) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_by TEXT NOT NULL,
  deployment_sha TEXT,
  execution_kind TEXT NOT NULL CHECK (execution_kind IN ('applied', 'baseline'))
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT,
  user_email TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL, category TEXT,
  status TEXT NOT NULL DEFAULT 'auto_responded', ai_response TEXT, auto_responded_at TIMESTAMPTZ DEFAULT NOW(),
  first_response_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_firm_created ON support_tickets (firm_id, created_at DESC);

CREATE TABLE IF NOT EXISTS client_rule_requests (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, client_id TEXT, client_name TEXT,
  requested_by TEXT NOT NULL, user_email TEXT NOT NULL, directive_text TEXT NOT NULL,
  rule_type TEXT NOT NULL DEFAULT 'categorization', status TEXT NOT NULL DEFAULT 'pending_review',
  ai_notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_client_rule_requests_firm_status ON client_rule_requests (firm_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS intercompany_affiliates (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, client_id_a TEXT NOT NULL, client_id_b TEXT NOT NULL,
  relationship_label TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (firm_id, client_id_a, client_id_b)
);
CREATE TABLE IF NOT EXISTS intercompany_reconciliations (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, client_id_a TEXT NOT NULL, txn_id_a TEXT NOT NULL,
  client_id_b TEXT NOT NULL, txn_id_b TEXT NOT NULL, amount NUMERIC NOT NULL, matched_reason TEXT NOT NULL,
  reconciled_by TEXT NOT NULL, reconciled_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_intercompany_reconciliations_firm_created ON intercompany_reconciliations (firm_id, reconciled_at DESC);
