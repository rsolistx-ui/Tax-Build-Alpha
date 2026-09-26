-- Fences a recovered worker claim so an older Worker cannot complete or retry
-- an operation claimed by a newer worker. Telegram is its own durable operation
-- instead of an untracked side effect of an email delivery.
ALTER TABLE operation_outbox ADD COLUMN IF NOT EXISTS claim_token TEXT;
ALTER TABLE operation_outbox DROP CONSTRAINT IF EXISTS operation_outbox_operation_kind_check;
ALTER TABLE operation_outbox ADD CONSTRAINT operation_outbox_operation_kind_check CHECK (
  operation_kind IN (
    'support_client_confirmation', 'support_admin_alert', 'support_admin_telegram',
    'rule_client_confirmation', 'rule_admin_alert', 'rule_admin_telegram',
    'rule_activation_confirmation'
  )
);
