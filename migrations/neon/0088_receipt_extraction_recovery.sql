-- A receipt may survive a transient document-reader outage. Keep recovery
-- state on the existing jobs row (which already points to the immutable R2
-- source) so no second receipt or second queue is created. Replay-safe.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS claim_token TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_receipt_recovery_due
  ON jobs (next_attempt_at, created_at)
  WHERE type = 'receipt_extract' AND status = 'retry_pending';
