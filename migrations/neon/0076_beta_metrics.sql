-- Beta metrics (services/beta-metrics.ts, the /control dashboard).
-- api_daily_stats: requests and 5xx responses the app itself returned, per UTC day,
-- counted by a middleware. Platform errors that stop a request before the app runs
-- (Workers CPU limit 503s) never reach it and are not in these counts.
-- support_tickets.first_response_at: when the owner first replied from /control; the
-- instant automatic reply does not count as a response. Replay-safe.
CREATE TABLE IF NOT EXISTS api_daily_stats (
  day DATE PRIMARY KEY,
  requests INTEGER NOT NULL DEFAULT 0,
  server_errors INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE IF EXISTS support_tickets ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;
