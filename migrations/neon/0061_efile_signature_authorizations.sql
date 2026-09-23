-- IRS Form 8878/8879 signature authorizations (Publication 1345, Rev. 12-2025).
-- Three signing methods are modelled:
--   handwritten_upload  pen signature returned by fax/email/mail/website; not a
--                       "remote electronic signature", so no identity check applies.
--   in_person_esign     electronic signature with the ERO physically present;
--                       government photo ID inspected, or a verified multi-year relationship.
--   remote_kba_esign    remote electronic signature; requires a credit-bureau KBA
--                       provider and stays disabled until one is configured.

CREATE TABLE IF NOT EXISTS efile_authorizations (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  signature_request_id TEXT NOT NULL UNIQUE REFERENCES signature_requests(id) ON DELETE RESTRICT,
  tax_return_id TEXT REFERENCES tax_returns(id) ON DELETE RESTRICT,
  tax_year INTEGER NOT NULL,
  form_type TEXT NOT NULL CHECK (form_type IN ('8879', '8878')),
  taxpayer_role TEXT NOT NULL CHECK (taxpayer_role IN ('primary', 'spouse')),
  taxpayer_name TEXT NOT NULL,
  taxpayer_email TEXT,
  unsigned_r2_key TEXT NOT NULL,
  unsigned_hash CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_signature'
    CHECK (status IN ('awaiting_signature', 'handwritten_received', 'signed', 'voided')),
  signed_method TEXT CHECK (signed_method IN ('handwritten_upload', 'in_person_esign', 'remote_kba_esign')),
  -- A pen-signed copy uploaded through the client's link waits here until
  -- staff confirm it is actually signed and dated.
  received_r2_key TEXT,
  received_content_type TEXT,
  received_hash CHAR(64),
  received_at TIMESTAMPTZ,
  received_ip TEXT,
  received_user_agent TEXT,
  kba_failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (kba_failed_attempts BETWEEN 0 AND 3),
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_at TIMESTAMPTZ,
  void_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_efile_authorizations_client
  ON efile_authorizations(client_id, tax_year DESC);

-- One live authorization per taxpayer per return.
CREATE UNIQUE INDEX IF NOT EXISTS idx_efile_authorizations_live_return_role
  ON efile_authorizations(tax_return_id, taxpayer_role)
  WHERE status <> 'voided' AND tax_return_id IS NOT NULL;

-- Evidence captured at signing. Append-only: Publication 1345 requires signed
-- records to be tamper-proof and kept at least three years (retain_until).
CREATE TABLE IF NOT EXISTS efile_signature_evidence (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  authorization_id TEXT NOT NULL UNIQUE REFERENCES efile_authorizations(id) ON DELETE RESTRICT,
  method TEXT NOT NULL CHECK (method IN ('handwritten_upload', 'in_person_esign', 'remote_kba_esign')),
  signature_type TEXT NOT NULL CHECK (signature_type IN ('handwritten_image', 'drawn', 'typed')),
  unsigned_hash CHAR(64) NOT NULL,
  signed_hash CHAR(64) NOT NULL,
  signed_r2_key TEXT NOT NULL,
  signer_name TEXT NOT NULL,
  -- Five-digit self-selected PIN captured in the electronic flows; a
  -- handwritten 8879 carries its PIN on the paper form.
  taxpayer_pin CHAR(5) CHECK (taxpayer_pin ~ '^[0-9]{5}$' AND taxpayer_pin <> '00000'),
  signer_ip TEXT,
  signer_login TEXT,
  signer_user_agent TEXT,
  identity_check JSONB NOT NULL,
  recorded_by_user_id TEXT,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retain_until DATE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_efile_signature_evidence_client
  ON efile_signature_evidence(client_id, signed_at DESC);

-- Every identity-check attempt, including failures, for the 3-attempt rule.
CREATE TABLE IF NOT EXISTS efile_kba_attempts (
  id TEXT PRIMARY KEY,
  authorization_id TEXT NOT NULL REFERENCES efile_authorizations(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('passed', 'failed', 'error')),
  provider_reference TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_efile_kba_attempts_authorization
  ON efile_kba_attempts(authorization_id, attempted_at);

CREATE OR REPLACE FUNCTION prevent_efile_evidence_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'IRS e-file signature evidence is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS efile_signature_evidence_no_update ON efile_signature_evidence;
CREATE TRIGGER efile_signature_evidence_no_update
  BEFORE UPDATE ON efile_signature_evidence
  FOR EACH ROW EXECUTE FUNCTION prevent_efile_evidence_mutation();

DROP TRIGGER IF EXISTS efile_signature_evidence_no_delete ON efile_signature_evidence;
CREATE TRIGGER efile_signature_evidence_no_delete
  BEFORE DELETE ON efile_signature_evidence
  FOR EACH ROW EXECUTE FUNCTION prevent_efile_evidence_mutation();

DROP TRIGGER IF EXISTS efile_kba_attempts_no_update ON efile_kba_attempts;
CREATE TRIGGER efile_kba_attempts_no_update
  BEFORE UPDATE ON efile_kba_attempts
  FOR EACH ROW EXECUTE FUNCTION prevent_efile_evidence_mutation();

DROP TRIGGER IF EXISTS efile_kba_attempts_no_delete ON efile_kba_attempts;
CREATE TRIGGER efile_kba_attempts_no_delete
  BEFORE DELETE ON efile_kba_attempts
  FOR EACH ROW EXECUTE FUNCTION prevent_efile_evidence_mutation();

-- A voided authorization is final; a signed one may only move to voided.
CREATE OR REPLACE FUNCTION guard_efile_authorization_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'voided' THEN
    RAISE EXCEPTION 'a voided e-file authorization cannot be modified';
  END IF;
  IF OLD.status = 'signed' AND NEW.status <> 'voided' THEN
    RAISE EXCEPTION 'a signed e-file authorization cannot be modified';
  END IF;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS efile_authorization_transition_guard ON efile_authorizations;
CREATE TRIGGER efile_authorization_transition_guard
  BEFORE UPDATE ON efile_authorizations
  FOR EACH ROW EXECUTE FUNCTION guard_efile_authorization_transition();
