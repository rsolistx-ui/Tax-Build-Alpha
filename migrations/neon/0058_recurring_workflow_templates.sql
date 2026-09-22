-- Milestone: Recurring workflow templates
-- service_templates (from 0012) already stores an ordered step list per
-- service_type but nothing ever read or wrote it. This adds firm ownership
-- so templates are actually usable per-firm, plus a subscription table that
-- ties a template to a client on a recurrence so the existing cron
-- (apps/api/src/index.ts `scheduled()`) can auto-instantiate work_items each
-- cycle instead of the practitioner recreating the same checklist by hand.
-- Replay-safe.

ALTER TABLE service_templates
  ADD COLUMN IF NOT EXISTS firm_id TEXT REFERENCES firms(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_service_templates_firm ON service_templates(firm_id);

CREATE TABLE IF NOT EXISTS client_service_subscriptions (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES service_templates(id) ON DELETE CASCADE,
  recurrence TEXT NOT NULL CHECK (recurrence IN ('once', 'monthly', 'quarterly', 'annually')),
  next_run_date DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_service_subscriptions_due
  ON client_service_subscriptions(next_run_date) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_client_service_subscriptions_client ON client_service_subscriptions(client_id);

CREATE OR REPLACE FUNCTION update_client_service_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_client_service_subscriptions_updated_at ON client_service_subscriptions;
CREATE TRIGGER trigger_client_service_subscriptions_updated_at
  BEFORE UPDATE ON client_service_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_client_service_subscriptions_updated_at();
