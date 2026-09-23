-- Taxpayer consents under IRC § 7216, Treas. Reg. § 301.7216-3 and Rev. Proc. 2013-14.
-- Each row is one signed consent document (a disclosure consent and a use consent are
-- separate documents, Rev. Proc. 2013-14 § 5.01/§ 5.05). The exact text the taxpayer saw
-- is stored with its SHA-256 so the record can be reproduced and verified.

CREATE TABLE IF NOT EXISTS taxpayer_consents (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  consent_kind TEXT NOT NULL CHECK (consent_kind IN ('disclosure_document_reading', 'use_bookkeeping')),
  text_version TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  text_sha256 CHAR(64) NOT NULL,
  -- Recipients named in a disclosure consent (e.g. ["truepost","cloudflare-workers-ai","groq"]).
  recipients JSONB NOT NULL DEFAULT '[]',
  preparer_name TEXT NOT NULL,
  taxpayer_name TEXT NOT NULL,
  signature_method TEXT NOT NULL CHECK (signature_method IN ('typed_name', 'paper')),
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_on DATE NOT NULL,
  signer_ip TEXT,
  signer_user_agent TEXT,
  paper_r2_key TEXT,
  consent_request_id TEXT,
  recorded_by_user_id TEXT,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  revocation_note TEXT,
  CHECK (signature_method <> 'paper' OR paper_r2_key IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_taxpayer_consents_client
  ON taxpayer_consents(client_id, consent_kind, signed_at DESC);

-- A signing link can produce at most one consent of each kind.
CREATE UNIQUE INDEX IF NOT EXISTS idx_taxpayer_consents_request_kind
  ON taxpayer_consents(consent_request_id, consent_kind) WHERE consent_request_id IS NOT NULL;

-- Signed consents are never deleted or edited; the only permitted change is a one-time revocation.
CREATE OR REPLACE FUNCTION guard_taxpayer_consent_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'taxpayer consents cannot be deleted';
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'a revoked taxpayer consent cannot be modified';
  END IF;
  IF NEW.revoked_at IS NULL
     OR (to_jsonb(NEW) - 'revoked_at' - 'revoked_by' - 'revocation_note')
        IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_at' - 'revoked_by' - 'revocation_note') THEN
    RAISE EXCEPTION 'a signed taxpayer consent can only be revoked';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS taxpayer_consents_guard_update ON taxpayer_consents;
CREATE TRIGGER taxpayer_consents_guard_update
  BEFORE UPDATE ON taxpayer_consents
  FOR EACH ROW EXECUTE FUNCTION guard_taxpayer_consent_mutation();

DROP TRIGGER IF EXISTS taxpayer_consents_guard_delete ON taxpayer_consents;
CREATE TRIGGER taxpayer_consents_guard_delete
  BEFORE DELETE ON taxpayer_consents
  FOR EACH ROW EXECUTE FUNCTION guard_taxpayer_consent_mutation();

-- Single-use links the taxpayer opens to read and sign.
CREATE TABLE IF NOT EXISTS consent_requests (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consent_requests_client ON consent_requests(client_id, created_at DESC);
