-- Milestone: Estimates & Proposals
-- Estimates with versioning, client acceptance, and one-click invoice conversion. Replay-safe.

-- Estimates (proposals sent to clients)
CREATE TABLE IF NOT EXISTS estimates (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  engagement_id TEXT REFERENCES engagements(id) ON DELETE SET NULL,
  number TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'converted')),
  issue_date DATE NOT NULL,
  expiry_date DATE,
  accepted_date DATE,
  converted_invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  terms TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  UNIQUE (firm_id, number)
);
CREATE INDEX IF NOT EXISTS idx_estimates_firm_status ON estimates(firm_id, status);
CREATE INDEX IF NOT EXISTS idx_estimates_client ON estimates(client_id);
CREATE INDEX IF NOT EXISTS idx_estimates_engagement ON estimates(engagement_id);
CREATE INDEX IF NOT EXISTS idx_estimates_expiry ON estimates(expiry_date) WHERE status IN ('sent', 'viewed');

-- Estimate line items
CREATE TABLE IF NOT EXISTS estimate_lines (
  id TEXT PRIMARY KEY,
  estimate_id TEXT NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_estimate_lines_estimate ON estimate_lines(estimate_id, sort_order);

-- Estimate versions (for versioning/audit trail)
CREATE TABLE IF NOT EXISTS estimate_versions (
  id TEXT PRIMARY KEY,
  estimate_id TEXT NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (estimate_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_estimate_versions_estimate ON estimate_versions(estimate_id);

-- Estimate acceptance tokens (for client acceptance via email link)
CREATE TABLE IF NOT EXISTS estimate_acceptance_tokens (
  id TEXT PRIMARY KEY,
  estimate_id TEXT NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (estimate_id)
);
CREATE INDEX IF NOT EXISTS idx_estimate_acceptance_tokens_token ON estimate_acceptance_tokens(token);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_estimates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_estimates_updated_at
  BEFORE UPDATE ON estimates
  FOR EACH ROW
  EXECUTE FUNCTION update_estimates_updated_at();

CREATE OR REPLACE FUNCTION update_estimate_lines_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_estimate_lines_updated_at
  BEFORE UPDATE ON estimate_lines
  FOR EACH ROW
  EXECUTE FUNCTION update_estimate_lines_updated_at();