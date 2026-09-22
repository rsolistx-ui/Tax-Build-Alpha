-- The signing service updates lifecycle state and must have a server-owned
-- modification timestamp. Older document-versioning installs lacked it.
ALTER TABLE signature_requests
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION touch_signature_request_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS signature_request_touch_updated_at ON signature_requests;
CREATE TRIGGER signature_request_touch_updated_at
  BEFORE UPDATE ON signature_requests
  FOR EACH ROW EXECUTE FUNCTION touch_signature_request_updated_at();
