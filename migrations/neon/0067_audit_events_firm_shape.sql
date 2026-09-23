-- audit_events was created (0001) with client_id/action/after_json, but later code writes
-- firm_id/event/metadata and records firm-level events with no client. Those inserts failed in
-- production. Accept both shapes and mirror each into the other so every reader sees every row.

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS firm_id TEXT REFERENCES firms(id) ON DELETE CASCADE;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS event TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE audit_events ALTER COLUMN client_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_firm ON audit_events(firm_id, created_at DESC);

CREATE OR REPLACE FUNCTION mirror_audit_event_shapes()
RETURNS TRIGGER AS $$
BEGIN
  NEW.action := COALESCE(NEW.action, NEW.event);
  NEW.event := COALESCE(NEW.event, NEW.action);
  NEW.after_json := COALESCE(NEW.after_json, NEW.metadata);
  NEW.metadata := COALESCE(NEW.metadata, NEW.after_json);
  IF NEW.firm_id IS NULL AND NEW.client_id IS NOT NULL THEN
    SELECT firm_id INTO NEW.firm_id FROM clients WHERE id = NEW.client_id;
  END IF;
  IF NEW.client_id IS NULL AND NEW.firm_id IS NULL THEN
    RAISE EXCEPTION 'audit event needs a client or a firm';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_mirror_shapes ON audit_events;
CREATE TRIGGER audit_events_mirror_shapes
  BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION mirror_audit_event_shapes();
