-- Folio married-spine schema for Neon Postgres.
-- Business data only. Better Auth/session state remains in Cloudflare D1 for this milestone.

CREATE TABLE IF NOT EXISTS firms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS firm_members (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_firm_members_user ON firm_members(user_id);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  legal_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clients_firm ON clients(firm_id);

CREATE TABLE IF NOT EXISTS client_profiles (
  client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  entity_type TEXT,
  industry TEXT,
  state TEXT,
  tax_year INTEGER,
  accounting_basis TEXT CHECK (accounting_basis IS NULL OR accounting_basis IN ('cash', 'accrual')),
  default_currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_categories_client ON categories(client_id);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT,
  size_bytes BIGINT,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'extracting', 'review', 'filed', 'failed')),
  extracted_date DATE,
  extracted_merchant TEXT,
  extracted_subtotal NUMERIC(14,2),
  extracted_tax NUMERIC(14,2),
  extracted_tip NUMERIC(14,2),
  extracted_total NUMERIC(14,2),
  extracted_currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  extracted_category TEXT,
  confidence NUMERIC(6,5),
  provider TEXT,
  model TEXT,
  validation_status TEXT NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending', 'pass', 'warning', 'fail')),
  validation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_at TIMESTAMPTZ,
  reviewed_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_receipts_client ON receipts(client_id);
CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(client_id, status);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(client_id, extracted_date);

CREATE TABLE IF NOT EXISTS receipt_line_items (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  quantity NUMERIC(12,3),
  unit_price NUMERIC(14,2),
  amount NUMERIC(14,2),
  category TEXT,
  confidence NUMERIC(6,5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (receipt_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_line_items_receipt ON receipt_line_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_line_items_category ON receipt_line_items(category);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued',
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

CREATE TABLE IF NOT EXISTS correction_rules (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL,
  match_key TEXT NOT NULL,
  output_json JSONB NOT NULL,
  seen_count INTEGER NOT NULL DEFAULT 1,
  last_applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, rule_type, match_key)
);
CREATE INDEX IF NOT EXISTS idx_correction_rules_client ON correction_rules(client_id, rule_type);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  receipt_id TEXT REFERENCES receipts(id) ON DELETE SET NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  before_json JSONB,
  after_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_client ON audit_events(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_receipt ON audit_events(receipt_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  txn_date DATE,
  description TEXT,
  amount NUMERIC(14,2),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  triage TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bank_client ON bank_transactions(client_id, txn_date);
