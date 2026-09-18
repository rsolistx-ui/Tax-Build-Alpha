-- Milestone: Admin Markdown Knowledge & Bucketing Rules
-- Dynamic rulebooks for AI categorization, tax bucketing, and personal vs business disambiguation. Replay-safe.

CREATE TABLE IF NOT EXISTS firm_rules (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE, -- NULL indicates firm-wide global rule
  title TEXT NOT NULL,
  rule_type TEXT NOT NULL DEFAULT 'categorization' CHECK (rule_type IN ('categorization', 'personal_vs_business', 'tax_deduction', 'general')),
  markdown_content TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_firm_rules_firm ON firm_rules(firm_id);
CREATE INDEX IF NOT EXISTS idx_firm_rules_client ON firm_rules(client_id);
CREATE INDEX IF NOT EXISTS idx_firm_rules_active ON firm_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_firm_rules_type ON firm_rules(rule_type);
