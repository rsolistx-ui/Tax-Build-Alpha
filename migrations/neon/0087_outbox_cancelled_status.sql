-- A human-issued signing link supersedes any pending automatic reminder for
-- the same recipient. Keep that explicit operational state rather than
-- recording a message as delivered when it was intentionally not sent.
ALTER TABLE operation_outbox DROP CONSTRAINT IF EXISTS operation_outbox_status_check;
ALTER TABLE operation_outbox ADD CONSTRAINT operation_outbox_status_check CHECK (
  status IN ('pending', 'processing', 'delivered', 'dead_letter', 'cancelled')
);
