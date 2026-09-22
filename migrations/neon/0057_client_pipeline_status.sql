-- Milestone: Practitioner-side pipeline view (prospect -> engaged -> active)
-- Existing clients default to 'active' so today's workspace never silently
-- reclassifies an ongoing relationship as a prospect. Replay-safe.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS pipeline_status TEXT NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_client_pipeline_status'
  ) THEN
    ALTER TABLE clients
      ADD CONSTRAINT chk_client_pipeline_status
      CHECK (pipeline_status IN ('prospect', 'engaged', 'active', 'inactive'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clients_pipeline_status ON clients(firm_id, pipeline_status);
