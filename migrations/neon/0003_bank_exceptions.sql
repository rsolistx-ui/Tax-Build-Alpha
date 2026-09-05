-- Paid-alpha bank exception resolution fields.
-- A transaction can wait on deliberately linked receipt evidence or be explicitly resolved without a receipt.

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS pending_receipt_id TEXT REFERENCES receipts(id) ON DELETE SET NULL;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS resolution_reason TEXT;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS resolved_by_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_bank_pending_receipt
  ON bank_transactions(pending_receipt_id)
  WHERE pending_receipt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bank_client_resolution
  ON bank_transactions(client_id, triage, resolved_at DESC, txn_date DESC);
