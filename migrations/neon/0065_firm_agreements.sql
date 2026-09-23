-- Acceptance of the Truepost service agreement by each firm user. The service agreement
-- is the written contract 16 CFR 314.4(f)(2) requires between a firm and its service
-- provider. Rows are append-only; a new agreement version requires a new acceptance.

CREATE TABLE IF NOT EXISTS firm_agreements (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL,
  agreement_version TEXT NOT NULL,
  text_sha256 CHAR(64) NOT NULL,
  accepted_name TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip TEXT,
  user_agent TEXT,
  UNIQUE (user_id, agreement_version)
);

CREATE OR REPLACE FUNCTION prevent_firm_agreement_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'agreement acceptances are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS firm_agreements_no_update ON firm_agreements;
CREATE TRIGGER firm_agreements_no_update BEFORE UPDATE ON firm_agreements
  FOR EACH ROW EXECUTE FUNCTION prevent_firm_agreement_mutation();

DROP TRIGGER IF EXISTS firm_agreements_no_delete ON firm_agreements;
CREATE TRIGGER firm_agreements_no_delete BEFORE DELETE ON firm_agreements
  FOR EACH ROW EXECUTE FUNCTION prevent_firm_agreement_mutation();
