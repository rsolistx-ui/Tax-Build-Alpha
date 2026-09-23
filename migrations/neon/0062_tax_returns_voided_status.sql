-- voidReturn() sets status='voided', but migration 0024's CHECK constraint
-- omitted it, so every void failed in production with a constraint error.
ALTER TABLE tax_returns DROP CONSTRAINT IF EXISTS tax_returns_status_check;
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_status_check
  CHECK (status IN ('draft', 'transmitted', 'accepted', 'rejected', 'voided'));
