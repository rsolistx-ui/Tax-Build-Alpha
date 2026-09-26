-- Reusable, provider-idempotent email operation for scheduled reminders and
-- other messages whose business record is committed before delivery.
ALTER TABLE operation_outbox DROP CONSTRAINT IF EXISTS operation_outbox_operation_kind_check;
ALTER TABLE operation_outbox ADD CONSTRAINT operation_outbox_operation_kind_check CHECK (
  operation_kind IN (
    'support_client_confirmation', 'support_admin_alert', 'support_admin_telegram',
    'rule_client_confirmation', 'rule_admin_alert', 'rule_admin_telegram',
    'rule_activation_confirmation', 'prepared_email'
  )
);
