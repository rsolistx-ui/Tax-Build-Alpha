-- Append-only sync event ledger. Every mutating write on the paid alpha
-- appends one row here so other devices can poll or be push-notified.
CREATE TABLE IF NOT EXISTS sync_events (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  entity TEXT NOT NULL,          -- e.g. receipt, workpaper, return, document
  entity_id TEXT NOT NULL,       -- the affected row id (or "0" for bulk ops)
  op TEXT NOT NULL,              -- create | update | delete | merge
  payload JSONB NOT NULL DEFAULT '{}',
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sync_events_firm_ts ON sync_events(firm_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_sync_events_user_ts ON sync_events(user_id, ts DESC);