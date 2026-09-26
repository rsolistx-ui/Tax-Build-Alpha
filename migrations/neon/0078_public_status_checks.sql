-- Durable evidence for the public status page.  Each row is written only by
-- the scheduled health check; the public endpoint never invents availability.
CREATE TABLE IF NOT EXISTS public_status_checks (
  id TEXT PRIMARY KEY,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  postgres_ok BOOLEAN NOT NULL,
  auth_ok BOOLEAN NOT NULL,
  overall_healthy BOOLEAN NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_public_status_checks_checked_at
  ON public_status_checks (checked_at DESC);
