-- Milestone 5: Tax Engine - Adjustment Layer
-- Tax adjustments, tax-only accounts, M-1/M-3, mapping, workpapers. Replay-safe.

-- Tax adjustment journals (separate from book journals)
CREATE TABLE IF NOT EXISTS tax_adjustment_journals (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  engagement_id TEXT REFERENCES engagements(id) ON DELETE SET NULL,
  tax_year INTEGER NOT NULL,
  period_end DATE NOT NULL,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN (
    'book_to_tax',      -- Book to tax difference
    'permanent_diff',   -- Permanent difference (non-deductible, tax-exempt income)
    'temporary_diff',   -- Timing difference (depreciation, accruals, reserves)
    'reclassification', -- Reclassification between tax lines
    'carryforward',     -- NOL, capital loss, credit carryforward
    'rate_change',      -- Tax rate change adjustment
    'state_mod',        -- State-specific modification
    'other'             -- Other
  )),
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN (
    'manual', 'import', 'auto_depreciation', 'auto_accrual', 'auto_reserve', 'carryforward_calc'
  )),
  source_id TEXT,  -- reference to source (depreciation schedule, accrual, etc.)
  memo TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed')),
  posted_at TIMESTAMPTZ,
  posted_by_user_id TEXT,
  reversed_journal_id TEXT REFERENCES tax_adjustment_journals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tax_adj_journals_client_year ON tax_adjustment_journals(client_id, tax_year);
CREATE INDEX IF NOT EXISTS idx_tax_adj_journals_status ON tax_adjustment_journals(firm_id, status);
CREATE INDEX IF NOT EXISTS idx_tax_adj_journals_type ON tax_adjustment_journals(adjustment_type);

-- Tax adjustment journal lines (double-entry, can hit tax-only accounts)
CREATE TABLE IF NOT EXISTS tax_adjustment_journal_lines (
  id TEXT PRIMARY KEY,
  journal_id TEXT NOT NULL REFERENCES tax_adjustment_journals(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  tax_line_id TEXT,  -- maps to tax form line (1040 line 12, 1120 line 26, etc.)
  description TEXT,
  debit NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  exchange_rate NUMERIC(10,6) NOT NULL DEFAULT 1,
  is_tax_only BOOLEAN NOT NULL DEFAULT FALSE,  -- true = tax-only account (no book impact)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (debit >= 0 AND credit >= 0),
  CHECK (debit = 0 OR credit = 0)
);
CREATE INDEX IF NOT EXISTS idx_tax_adj_lines_journal ON tax_adjustment_journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_tax_adj_lines_account ON tax_adjustment_journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_tax_adj_lines_tax_line ON tax_adjustment_journal_lines(tax_line_id);

-- Tax form line mappings (COA account -> tax form line)
CREATE TABLE IF NOT EXISTS tax_form_mappings (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  tax_form TEXT NOT NULL,  -- '1040', '1120', '1120S', '1065', '1120-F', 'state_CA', 'state_NY', etc.
  tax_year INTEGER NOT NULL,
  form_line_code TEXT NOT NULL,  -- e.g., '1040_12', '1120_26', 'SchC_1', 'M1_1', 'M3_1'
  form_line_label TEXT NOT NULL,  -- human readable: "Business income (Sch C line 1)"
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  mapping_type TEXT NOT NULL DEFAULT 'direct' CHECK (mapping_type IN (
    'direct',           -- account maps directly to this line
    'aggregation',      -- multiple accounts aggregate to this line
    'calculation',      -- calculated from other lines
    'manual_entry'      -- manual entry on return
  )),
  calculation_formula TEXT,  -- HyperFormula expression for calculation mappings
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, tax_form, tax_year, form_line_code)
);
CREATE INDEX IF NOT EXISTS idx_tax_mapping_firm_form_year ON tax_form_mappings(firm_id, tax_form, tax_year);
CREATE INDEX IF NOT EXISTS idx_tax_mapping_account ON tax_form_mappings(account_id);

-- Tax-only accounts (system accounts used only for tax adjustments)
CREATE TABLE IF NOT EXISTS tax_only_accounts (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  tax_form TEXT NOT NULL,  -- which tax form this applies to
  tax_line_code TEXT NOT NULL,  -- maps to tax_form_mappings.form_line_code
  account_type TEXT NOT NULL CHECK (account_type IN (
    'm1_adjustment',     -- M-1 adjustment account
    'm3_adjustment',     -- M-3 adjustment account
    'permanent_diff',    -- Permanent difference
    'temporary_diff',    -- Temporary difference (deferred tax)
    'state_mod',         -- State modification
    'carryforward',      -- Carryforward tracking
    'credit',            -- Tax credit
    'amt',               -- AMT adjustment
    'other'
  )),
  normal_balance TEXT NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, code)
);
CREATE INDEX IF NOT EXISTS idx_tax_only_firm_type ON tax_only_accounts(firm_id, account_type);

-- M-1 Reconciliation (Book Income to Taxable Income)
CREATE TABLE IF NOT EXISTS m1_reconciliations (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tax_year INTEGER NOT NULL,
  book_net_income NUMERIC(14,2) NOT NULL DEFAULT 0,
  taxable_income NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  finalized_at TIMESTAMPTZ,
  finalized_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, client_id, tax_year)
);
CREATE INDEX IF NOT EXISTS idx_m1_client_year ON m1_reconciliations(client_id, tax_year);

-- M-1 Line Items (each adjustment)
CREATE TABLE IF NOT EXISTS m1_reconciliation_lines (
  id TEXT PRIMARY KEY,
  reconciliation_id TEXT NOT NULL REFERENCES m1_reconciliations(id) ON DELETE CASCADE,
  line_code TEXT NOT NULL,  -- e.g., 'M1_1', 'M1_2', 'M1_3'...
  line_label TEXT NOT NULL,
  line_category TEXT NOT NULL CHECK (line_category IN (
    'book_income',           -- Net income per books
    'federal_tax',           -- Federal income tax
    'excess_capital_loss',   -- Excess of capital losses over gains
    'taxable_income_not_book', -- Income taxable not on books
    'book_expense_not_deduct', -- Book expenses not deductible
    'income_not_taxable',    -- Income on books not taxable
    'deductible_not_book',   -- Deductions on return not on books
    'other'
  )),
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  source_journal_id TEXT REFERENCES tax_adjustment_journals(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_m1_lines_recon ON m1_reconciliation_lines(reconciliation_id);

-- M-3 Reconciliation (for corps with assets >= $10M)
CREATE TABLE IF NOT EXISTS m3_reconciliations (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tax_year INTEGER NOT NULL,
  net_income_per_books NUMERIC(14,2) NOT NULL DEFAULT 0,
  taxable_income NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  finalized_at TIMESTAMPTZ,
  finalized_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, client_id, tax_year)
);
CREATE INDEX IF NOT EXISTS idx_m3_client_year ON m3_reconciliations(client_id, tax_year);

-- M-3 Part I & II Lines
CREATE TABLE IF NOT EXISTS m3_reconciliation_lines (
  id TEXT PRIMARY KEY,
  reconciliation_id TEXT NOT NULL REFERENCES m3_reconciliations(id) ON DELETE CASCADE,
  part TEXT NOT NULL CHECK (part IN ('I', 'II', 'III')),
  line_code TEXT NOT NULL,  -- e.g., 'M3_I_1', 'M3_II_5'
  line_label TEXT NOT NULL,
  line_category TEXT NOT NULL,
  per_books NUMERIC(14,2) NOT NULL DEFAULT 0,
  temporary_diff NUMERIC(14,2) NOT NULL DEFAULT 0,
  permanent_diff NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_diff NUMERIC(14,2) NOT NULL DEFAULT 0,
  per_return NUMERIC(14,2) GENERATED ALWAYS AS (
    per_books + temporary_diff + permanent_diff + other_diff
  ) STORED,
  source_journal_id TEXT REFERENCES tax_adjustment_journals(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_m3_lines_recon ON m3_reconciliation_lines(reconciliation_id);

-- State tax modifications (per state)
CREATE TABLE IF NOT EXISTS state_tax_modifications (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  state TEXT NOT NULL,  -- 'CA', 'NY', 'TX', etc.
  tax_year INTEGER NOT NULL,
  modification_type TEXT NOT NULL CHECK (modification_type IN (
    'addition',      -- Addition to federal taxable income
    'subtraction',   -- Subtraction from federal taxable income
    'apportionment', -- Apportionment factor
    'credit',        -- State tax credit
    'other'
  )),
  description TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  federal_line_code TEXT,  -- reference to federal line
  state_line_code TEXT,    -- state form line
  apportionment_factor NUMERIC(10,6),  -- for apportionment
  source_journal_id TEXT REFERENCES tax_adjustment_journals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_state_mod_client_year ON state_tax_modifications(client_id, tax_year);
CREATE INDEX IF NOT EXISTS idx_state_mod_state ON state_tax_modifications(state);

-- Carryforward tracking (NOL, capital loss, credits, AMT, etc.)
CREATE TABLE IF NOT EXISTS tax_carryforwards (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  carryforward_type TEXT NOT NULL CHECK (carryforward_type IN (
    'nol_federal',        -- Federal NOL
    'nol_state',          -- State NOL
    'capital_loss',       -- Capital loss carryforward
    'charitable',         -- Charitable contribution carryforward
    'general_business_credit', -- General business credit
    'foreign_tax_credit', -- Foreign tax credit
    'amt_credit',         -- AMT credit
    'section_179',        -- Section 179 carryover
    'section_163j',       -- 163(j) interest limitation carryforward
    'state_nol',          -- State-specific NOL
    'state_credit',       -- State-specific credit
    'amt',                -- AMT carryforward
    'other'
  )),
  state TEXT,  -- for state-specific carryforwards
  tax_year_generated INTEGER NOT NULL,
  tax_year_expires INTEGER,  -- null = no expiration
  original_amount NUMERIC(14,2) NOT NULL,
  remaining_amount NUMERIC(14,2) NOT NULL,
  used_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'fully_used', 'abandoned')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_carryforward_client_type ON tax_carryforwards(client_id, carryforward_type);
CREATE INDEX IF NOT EXISTS idx_carryforward_status ON tax_carryforwards(status);

-- Carryforward utilization (when used on a return)
CREATE TABLE IF NOT EXISTS tax_carryforward_utilization (
  id TEXT PRIMARY KEY,
  carryforward_id TEXT NOT NULL REFERENCES tax_carryforwards(id) ON DELETE CASCADE,
  tax_year_used INTEGER NOT NULL,
  amount_used NUMERIC(14,2) NOT NULL,
  return_type TEXT NOT NULL,  -- 'federal', 'state_CA', etc.
  source_journal_id TEXT REFERENCES tax_adjustment_journals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cf_util_cf ON tax_carryforward_utilization(carryforward_id);
CREATE INDEX IF NOT EXISTS idx_cf_util_year ON tax_carryforward_utilization(tax_year_used);

-- Tax form mappings seed data (minimal starter set for 1040/1120/1120S/1065)
-- These will be expanded per firm/tax_year via seed script

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_tax_adj_journals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_tax_adj_journals_updated_at
  BEFORE UPDATE ON tax_adjustment_journals
  FOR EACH ROW
  EXECUTE FUNCTION update_tax_adj_journals_updated_at();

CREATE OR REPLACE FUNCTION update_tax_form_mappings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_tax_form_mappings_updated_at
  BEFORE UPDATE ON tax_form_mappings
  FOR EACH ROW
  EXECUTE FUNCTION update_tax_form_mappings_updated_at();

CREATE OR REPLACE FUNCTION update_tax_only_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_tax_only_accounts_updated_at
  BEFORE UPDATE ON tax_only_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_tax_only_accounts_updated_at();

CREATE OR REPLACE FUNCTION update_m1_reconciliations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_m1_reconciliations_updated_at
  BEFORE UPDATE ON m1_reconciliations
  FOR EACH ROW
  EXECUTE FUNCTION update_m1_reconciliations_updated_at();

CREATE OR REPLACE FUNCTION update_m3_reconciliations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_m3_reconciliations_updated_at
  BEFORE UPDATE ON m3_reconciliations
  FOR EACH ROW
  EXECUTE FUNCTION update_m3_reconciliations_updated_at();

CREATE OR REPLACE FUNCTION update_state_tax_modifications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_state_tax_modifications_updated_at
  BEFORE UPDATE ON state_tax_modifications
  FOR EACH ROW
  EXECUTE FUNCTION update_state_tax_modifications_updated_at();

CREATE OR REPLACE FUNCTION update_tax_carryforwards_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_tax_carryforwards_updated_at
  BEFORE UPDATE ON tax_carryforwards
  FOR EACH ROW
  EXECUTE FUNCTION update_tax_carryforwards_updated_at();