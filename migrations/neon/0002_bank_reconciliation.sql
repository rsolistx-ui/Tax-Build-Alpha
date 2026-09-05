-- Paid-alpha bank CSV reconciliation fields.
-- Keep bank transactions in Neon with deterministic duplicate protection and explicit receipt decisions.

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS import_fingerprint TEXT;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS suggested_receipt_id TEXT REFERENCES receipts(id) ON DELETE SET NULL;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS suggested_score NUMERIC(6,5);

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS suggested_reason TEXT;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS matched_receipt_id TEXT REFERENCES receipts(id) ON DELETE SET NULL;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_client_fingerprint
  ON bank_transactions(client_id, import_fingerprint)
  WHERE import_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bank_client_triage
  ON bank_transactions(client_id, triage, txn_date DESC);

CREATE INDEX IF NOT EXISTS idx_bank_suggested_receipt
  ON bank_transactions(suggested_receipt_id)
  WHERE suggested_receipt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bank_matched_receipt
  ON bank_transactions(matched_receipt_id)
  WHERE matched_receipt_id IS NOT NULL;
