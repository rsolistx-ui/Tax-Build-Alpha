-- Durable delivery intent for client and operator notifications. A request is
-- recorded before the external provider is called, and a unique idempotency key
-- makes retries safe across Worker restarts and repeated cron ticks.
CREATE TABLE IF NOT EXISTS operation_outbox (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL,
  operation_kind TEXT NOT NULL CHECK (operation_kind IN ('support_client_confirmation', 'support_admin_alert', 'rule_client_confirmation', 'rule_admin_alert', 'rule_activation_confirmation')),
  payload JSONB NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  provider_message_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_operation_outbox_due
  ON operation_outbox (status, next_attempt_at, created_at);
