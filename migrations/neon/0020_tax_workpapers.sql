CREATE TABLE IF NOT EXISTS tax_workpapers (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tax_year INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT 'Workpaper',
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, client_id, tax_year)
);
CREATE INDEX IF NOT EXISTS idx_tax_workpapers_client_year ON tax_workpapers(client_id, tax_year);

CREATE OR REPLACE FUNCTION update_tax_workpapers_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trigger_tax_workpapers_updated_at ON tax_workpapers;
CREATE TRIGGER trigger_tax_workpapers_updated_at BEFORE UPDATE ON tax_workpapers FOR EACH ROW EXECUTE FUNCTION update_tax_workpapers_updated_at();
