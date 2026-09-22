-- Milestone: Time tracking tied to invoicing
-- A practitioner starts/stops a timer (or logs time manually) against a client
-- and, optionally, an engagement and a billing rate. Unbilled entries can be
-- converted into invoice lines in one action instead of retyping hours into
-- a separate invoicing tool. Replay-safe.

CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  engagement_id TEXT REFERENCES engagements(id) ON DELETE SET NULL,
  billing_rate_id TEXT REFERENCES billing_rates(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_minutes NUMERIC(10,2),
  is_billable BOOLEAN NOT NULL DEFAULT TRUE,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  created_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX IF NOT EXISTS idx_time_entries_firm ON time_entries(firm_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_client ON time_entries(client_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_engagement ON time_entries(engagement_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_invoice ON time_entries(invoice_id);
-- One running timer per client at a time (ended_at IS NULL marks "running").
CREATE UNIQUE INDEX IF NOT EXISTS uq_time_entries_running_per_client
  ON time_entries(client_id) WHERE ended_at IS NULL;

CREATE OR REPLACE FUNCTION update_time_entries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_time_entries_updated_at ON time_entries;
CREATE TRIGGER trigger_time_entries_updated_at
  BEFORE UPDATE ON time_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_time_entries_updated_at();
