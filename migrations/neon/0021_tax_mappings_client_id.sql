ALTER TABLE tax_form_mappings ADD COLUMN IF NOT EXISTS client_id TEXT REFERENCES clients(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_tax_mapping_client ON tax_form_mappings(client_id);
DROP INDEX IF EXISTS idx_tax_mapping_firm_form_year;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_mapping_unique ON tax_form_mappings(firm_id, client_id, tax_form, tax_year, form_line_code) WHERE client_id IS NOT NULL;
