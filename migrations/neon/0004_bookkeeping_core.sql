-- Milestone: Phyllis operational bookkeeping core.
-- Adds an explicit, professional-confirmed accounting disposition to bank
-- transactions. Disposition is a separate decision from receipt-matching
-- triage: a transaction can be matched to evidence without deciding its
-- accounting treatment, and vice versa. Replay-safe.

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS disposition TEXT NOT NULL DEFAULT 'unclassified';

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS suggested_disposition TEXT;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS disposition_note TEXT;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS disposition_reviewed_at TIMESTAMPTZ;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS disposition_reviewed_by_user_id TEXT;

DO $$ BEGIN
  ALTER TABLE bank_transactions
    ADD CONSTRAINT chk_bank_disposition CHECK (disposition IN (
      'business_expense',
      'business_income',
      'personal',
      'transfer',
      'owner_contribution',
      'owner_draw',
      'loan',
      'other_excluded',
      'unclassified'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE bank_transactions
    ADD CONSTRAINT chk_bank_suggested_disposition CHECK (suggested_disposition IS NULL OR suggested_disposition IN (
      'business_expense',
      'business_income',
      'personal',
      'transfer',
      'owner_contribution',
      'owner_draw',
      'loan',
      'other_excluded',
      'unclassified'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_bank_client_disposition ON bank_transactions(client_id, disposition);
CREATE INDEX IF NOT EXISTS idx_bank_client_date_disposition ON bank_transactions(client_id, txn_date, disposition);
