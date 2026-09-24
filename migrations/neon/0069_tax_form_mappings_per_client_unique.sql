-- 0021 made tax form mappings per client (client_id + a per-client unique index)
-- but left the original firm-wide UNIQUE (firm_id, tax_form, tax_year, form_line_code)
-- from 0018 in place, so only ONE client per firm could have e.g. Schedule C line 1
-- for a year; seeding a second client failed. Uniqueness is now per client only
-- (idx_tax_mapping_unique, unchanged). Replay-safe.
ALTER TABLE tax_form_mappings DROP CONSTRAINT IF EXISTS tax_form_mappings_firm_id_tax_form_tax_year_form_line_code_key;
