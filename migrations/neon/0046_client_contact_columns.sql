-- The Wave customer migration and client communications both require durable
-- contact fields. Earlier deployments may have skipped migration 0032, so
-- retain this idempotent compatibility migration in the release train.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone TEXT;

CREATE INDEX IF NOT EXISTS idx_clients_firm_lower_name ON clients(firm_id, LOWER(name));
