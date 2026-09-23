-- The 8879 request route (docu-sign.ts) and readiness updates (tax-workbench.ts) record which
-- entity an audit event is about. audit_events never had these columns, so those writes failed.
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS entity_id TEXT;
