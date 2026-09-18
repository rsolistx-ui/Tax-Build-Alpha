-- Migration 0041: Rule Dictation Scoping, Retroactive Dates, and Feature Request Feedback Backlog
-- Enables practitioners to speak or dictate custom AI bucketing rules with retroactive date scoping,
-- and submit platform feature requests directly from the app.

ALTER TABLE firm_rules
  ADD COLUMN IF NOT EXISTS effective_from DATE,
  ADD COLUMN IF NOT EXISTS dictated_prompt TEXT,
  ADD COLUMN IF NOT EXISTS created_by_user_id TEXT;

CREATE TABLE IF NOT EXISTS feature_requests (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  submitted_by_user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT 'general' CHECK (area IN ('receipt_scanning', 'categorization', 'tax_radar', 'reports', 'bank_feed', 'ui_ux', 'general')),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'under_review', 'in_progress', 'completed', 'declined')),
  source TEXT NOT NULL DEFAULT 'text' CHECK (source IN ('text', 'voice')),
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feature_requests_firm ON feature_requests(firm_id);
CREATE INDEX IF NOT EXISTS idx_feature_requests_status ON feature_requests(status);
CREATE INDEX IF NOT EXISTS idx_feature_requests_created ON feature_requests(created_at DESC);
