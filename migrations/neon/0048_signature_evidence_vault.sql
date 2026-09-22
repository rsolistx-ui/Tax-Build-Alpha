-- Dedicated append-only evidence ledger for native ordinary-document signing.
-- IRS 8878/8879 authorization remains outside this native flow.
CREATE TABLE IF NOT EXISTS signature_evidence_events (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  signature_request_id TEXT NOT NULL REFERENCES signature_requests(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('native_document_signed')),
  document_id TEXT NOT NULL,
  certificate_id TEXT NOT NULL,
  original_hash TEXT NOT NULL,
  final_hash TEXT NOT NULL,
  signed_r2_key TEXT NOT NULL,
  signer_email TEXT NOT NULL,
  signer_name TEXT NOT NULL,
  signer_ip TEXT,
  signer_user_agent TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (signature_request_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_signature_evidence_request
  ON signature_evidence_events(signature_request_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_signature_evidence_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'signature evidence is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS signature_evidence_no_update ON signature_evidence_events;
CREATE TRIGGER signature_evidence_no_update
  BEFORE UPDATE ON signature_evidence_events
  FOR EACH ROW EXECUTE FUNCTION prevent_signature_evidence_mutation();

DROP TRIGGER IF EXISTS signature_evidence_no_delete ON signature_evidence_events;
CREATE TRIGGER signature_evidence_no_delete
  BEFORE DELETE ON signature_evidence_events
  FOR EACH ROW EXECUTE FUNCTION prevent_signature_evidence_mutation();
