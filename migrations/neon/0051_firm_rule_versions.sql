-- Rules are operating policy. Preserve an immutable pre-change snapshot so a
-- practitioner can review and restore a prior scoped rule without editing
-- production markdown by hand.
CREATE TABLE IF NOT EXISTS firm_rule_versions (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL REFERENCES firm_rules(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('created','updated','rollback')),
  snapshot JSONB NOT NULL,
  actor_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS firm_rule_versions_rule_created_idx ON firm_rule_versions(rule_id, created_at DESC);
