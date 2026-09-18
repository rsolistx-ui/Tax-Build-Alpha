-- Milestone: Project Profitability & Tagging
-- Projects, tags, and auto-tagging rules. Replay-safe.

-- Projects (profitability tracking per client engagement)
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  engagement_id TEXT REFERENCES engagements(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_hold', 'completed', 'cancelled')),
  start_date DATE,
  end_date DATE,
  budget_amount NUMERIC(14,2),
  budget_currency TEXT DEFAULT 'USD',
  color TEXT DEFAULT '#3B82F6',
  is_billable BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, client_id, name)
);
CREATE INDEX IF NOT EXISTS idx_projects_firm ON projects(firm_id);
CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_projects_engagement ON projects(engagement_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- Project tags (many-to-many for transactions, invoices, receipts)
CREATE TABLE IF NOT EXISTS project_tags (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6B7280',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, name)
);
CREATE INDEX IF NOT EXISTS idx_project_tags_project ON project_tags(project_id);

-- Transaction tags (link transactions to project tags)
CREATE TABLE IF NOT EXISTS transaction_tags (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('bank_transaction', 'invoice', 'estimate', 'receipt', 'payment', 'journal_entry')),
  tag_id TEXT NOT NULL REFERENCES project_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (transaction_id, transaction_type, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_transaction_tags_txn ON transaction_tags(transaction_id, transaction_type);
CREATE INDEX IF NOT EXISTS idx_transaction_tags_tag ON transaction_tags(tag_id);

-- Auto-tagging rules (merchant/category → project tag)
CREATE TABLE IF NOT EXISTS auto_tag_rules (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES project_tags(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('merchant', 'category', 'description', 'amount_range')),
  match_value TEXT NOT NULL,
  match_operator TEXT NOT NULL DEFAULT 'contains' CHECK (match_operator IN ('equals', 'contains', 'starts_with', 'ends_with', 'regex', 'between')),
  priority INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auto_tag_rules_firm ON auto_tag_rules(firm_id);
CREATE INDEX IF NOT EXISTS idx_auto_tag_rules_project ON auto_tag_rules(project_id);
CREATE INDEX IF NOT EXISTS idx_auto_tag_rules_active ON auto_tag_rules(is_active) WHERE is_active = TRUE;

-- Project budgets vs actuals (period snapshots)
CREATE TABLE IF NOT EXISTS project_budget_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  budget_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  budget_expenses NUMERIC(14,2) NOT NULL DEFAULT 0,
  actual_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  actual_expenses NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS idx_project_budget_snapshots_project ON project_budget_snapshots(project_id);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION update_projects_updated_at();

CREATE OR REPLACE FUNCTION update_auto_tag_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_auto_tag_rules_updated_at
  BEFORE UPDATE ON auto_tag_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_auto_tag_rules_updated_at();