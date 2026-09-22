-- Durable, per-firm execution ledger for the deterministic supervisor pass.
-- A unique time slot makes duplicate Cloudflare cron delivery harmless.
CREATE TABLE IF NOT EXISTS supervisor_heartbeat_runs (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  run_slot TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  clients_scanned INTEGER NOT NULL DEFAULT 0,
  recommendations_created INTEGER NOT NULL DEFAULT 0,
  llm_calls INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  UNIQUE (firm_id, run_slot)
);

CREATE INDEX IF NOT EXISTS idx_supervisor_heartbeat_runs_firm_slot
  ON supervisor_heartbeat_runs (firm_id, run_slot DESC);
