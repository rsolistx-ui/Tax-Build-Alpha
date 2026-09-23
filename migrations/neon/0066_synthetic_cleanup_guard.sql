-- Lets the production smoke-test cleanup remove its synthetic tenant. Append-only records
-- (consents, 8879 evidence, identity-check attempts, agreement acceptances) still refuse
-- updates and deletes, except inside a transaction that set truepost.synthetic_cleanup,
-- which only the internal cleanup route does, and only for firms whose name matches the
-- smoke-test naming convention.

CREATE OR REPLACE FUNCTION prevent_efile_evidence_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('truepost.synthetic_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'IRS e-file signature evidence is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_firm_agreement_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('truepost.synthetic_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'agreement acceptances are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_taxpayer_consent_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('truepost.synthetic_cleanup', true) = 'on' THEN
      RETURN OLD;
    END IF;
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
