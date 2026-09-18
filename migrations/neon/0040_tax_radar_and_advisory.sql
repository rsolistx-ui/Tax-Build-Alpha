-- Milestone: 1099 Radar, Duplicate Detection, and Advisory Optimizer
-- Replay-safe schema additions for tax-season intelligence.

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS is_potential_duplicate BOOLEAN DEFAULT FALSE;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS duplicate_of_receipt_id TEXT REFERENCES receipts(id) ON DELETE SET NULL;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS card_last4 TEXT;

CREATE TABLE IF NOT EXISTS contractor_w9_records (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contractor_name TEXT NOT NULL,
  ein_ssn_last4 TEXT,
  email TEXT,
  has_w9 BOOLEAN NOT NULL DEFAULT FALSE,
  w9_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, contractor_name)
);

CREATE INDEX IF NOT EXISTS idx_contractor_w9_client ON contractor_w9_records(client_id);
CREATE INDEX IF NOT EXISTS idx_contractor_w9_has_w9 ON contractor_w9_records(has_w9);
