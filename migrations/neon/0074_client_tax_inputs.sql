-- Return inputs the preparer would otherwise dig up by hand, per client and tax
-- year, for the handoff to the tax software (services/tax-inputs.ts): vehicles
-- (Schedule C Part IV / Form 4562 Part V), home office (Form 8829 or the
-- simplified method), assets placed in service (Form 4562), 1099s received,
-- and estimated tax payments made. Inputs only; Truepost computes no tax.
-- The shape of data is validated per kind in the service. Replay-safe.
CREATE TABLE IF NOT EXISTS client_tax_inputs (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  tax_year INTEGER NOT NULL CHECK (tax_year BETWEEN 2000 AND 2100),
  kind TEXT NOT NULL CHECK (kind IN ('vehicle', 'home_office', 'asset', 'form_1099', 'estimated_payment')),
  data JSONB NOT NULL,
  created_by_user_id TEXT NOT NULL,
  updated_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_client_tax_inputs_client_same_firm
    FOREIGN KEY (client_id, firm_id) REFERENCES clients(id, firm_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_client_tax_inputs_client_year ON client_tax_inputs(client_id, tax_year);
-- One home office worksheet per client and year.
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_tax_inputs_one_home_office
  ON client_tax_inputs(client_id, tax_year) WHERE kind = 'home_office';
