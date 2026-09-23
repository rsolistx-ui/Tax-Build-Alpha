-- apps/api/src/services/receipt-intake.ts has inserted into
-- document_classifications on every successful extraction since it was
-- written, but no migration ever created the table -- meaning every receipt
-- upload in production has been failing at the final step and landing in
-- the review queue as EXTRACTION_FAILED, regardless of whether the AI
-- extraction itself succeeded. This closes that gap. Replay-safe.

CREATE TABLE IF NOT EXISTS document_classifications (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('W-2', '1099', 'return', 'statement', 'generic_receipt')),
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
  classified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_document_classifications_client ON document_classifications(client_id);
CREATE INDEX IF NOT EXISTS idx_document_classifications_receipt ON document_classifications(receipt_id);
