-- A tax-software CSV can provide only prior-year reference figures. These stay
-- separate from current-year books and are used to prefill the safe-harbor
-- worksheet; they never compute or file a return.
CREATE TABLE IF NOT EXISTS prior_year_tax_summaries (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  tax_year INTEGER NOT NULL CHECK (tax_year BETWEEN 2000 AND 2100),
  adjusted_gross_income NUMERIC(14,2) NOT NULL,
  total_tax NUMERIC(14,2) NOT NULL,
  source_filename TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_prior_year_tax_summaries_client_same_firm
    FOREIGN KEY (client_id, firm_id) REFERENCES clients(id, firm_id) ON DELETE CASCADE,
  UNIQUE (client_id, tax_year)
);
