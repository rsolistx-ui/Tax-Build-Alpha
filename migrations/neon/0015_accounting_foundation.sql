-- Milestone 2: Accounting Foundation
-- Canonical chart of accounts, double-entry ledger, journals, trial balance,
-- balance sheet, period close, reconciliation. Replay-safe.

-- Chart of Accounts
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  subtype TEXT,
  parent_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  normal_balance TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, code)
);
CREATE INDEX IF NOT EXISTS idx_accounts_firm_type ON accounts(firm_id, type);
CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(parent_id);

-- Journals (header)
CREATE TABLE IF NOT EXISTS journals (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT,
  engagement_id TEXT,
  source_type TEXT NOT NULL,
  source_id TEXT,
  memo TEXT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  posted_at TIMESTAMPTZ,
  posted_by_user_id TEXT,
  reversed_journal_id TEXT REFERENCES journals(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_journals_firm_period ON journals(firm_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_journals_client ON journals(client_id);
CREATE INDEX IF NOT EXISTS idx_journals_source ON journals(source_type, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journals_status ON journals(firm_id, status);

-- Journal Lines (double-entry)
CREATE TABLE IF NOT EXISTS journal_lines (
  id TEXT PRIMARY KEY,
  journal_id TEXT NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  description TEXT,
  debit NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  exchange_rate NUMERIC(10,6) NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (debit >= 0 AND credit >= 0),
  CHECK (debit = 0 OR credit = 0)
);
CREATE INDEX IF NOT EXISTS idx_journal_lines_journal ON journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id);

-- Period Close (locking)
CREATE TABLE IF NOT EXISTS period_closes (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT,
  period_end DATE NOT NULL,
  closed_at TIMESTAMPTZ NOT NULL,
  closed_by_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'closed' CHECK (status IN ('closed', 'reopened')),
  UNIQUE (firm_id, client_id, period_end)
);
CREATE INDEX IF NOT EXISTS idx_period_closes_firm ON period_closes(firm_id, period_end);

-- Reconciliation (bank vs ledger)
CREATE TABLE IF NOT EXISTS reconciliations (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  period_end DATE NOT NULL,
  bank_balance NUMERIC(14,2) NOT NULL,
  ledger_balance NUMERIC(14,2) NOT NULL,
  difference NUMERIC(14,2) GENERATED ALWAYS AS (bank_balance - ledger_balance) STORED,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reconciled', 'investigating')),
  reconciled_at TIMESTAMPTZ,
  reconciled_by_user_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, client_id, account_id, period_end)
);
CREATE INDEX IF NOT EXISTS idx_reconciliations_client_period ON reconciliations(client_id, period_end);

-- System Account Constants (seeded per firm)
CREATE TABLE IF NOT EXISTS system_accounts (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  UNIQUE (firm_id, key)
);

-- Account Balances (materialized view refreshed on post)
CREATE TABLE IF NOT EXISTS account_balances (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  period_end DATE NOT NULL,
  debit_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_balance NUMERIC(14,2) GENERATED ALWAYS AS (debit_balance - credit_balance) STORED,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, client_id, account_id, period_end)
);
CREATE INDEX IF NOT EXISTS idx_account_balances_client_period ON account_balances(client_id, period_end);

-- Constraints (ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS is not standard; use IF NOT EXISTS via DO block alternative)
-- Instead, add check constraints directly in CREATE TABLE where possible, or use separate ALTER statements
-- The Neon HTTP API supports plain ALTER TABLE ADD CONSTRAINT

-- Account type constraint
ALTER TABLE accounts
  ADD CONSTRAINT chk_account_type CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense'));

-- Account normal balance constraint
ALTER TABLE accounts
  ADD CONSTRAINT chk_account_normal_balance CHECK (normal_balance IN ('debit', 'credit'));

-- Journal posting race-safe index
CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_posted_source
  ON journals(firm_id, source_type, source_id)
  WHERE source_id IS NOT NULL AND status = 'posted';

-- Triggers (PostgreSQL functions must be created via standard syntax)
CREATE OR REPLACE FUNCTION update_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_accounts_updated_at();

CREATE OR REPLACE FUNCTION update_account_balances_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_account_balances_updated_at
  BEFORE UPDATE ON account_balances
  FOR EACH ROW
  EXECUTE FUNCTION update_account_balances_updated_at();