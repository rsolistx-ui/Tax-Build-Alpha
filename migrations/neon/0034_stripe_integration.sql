-- Milestone: Stripe Payment Integration
-- Customers, payment methods, invoices, schedules, webhooks. Replay-safe.

-- Stripe customer mapping (one per Folio client)
CREATE TABLE IF NOT EXISTS stripe_customers (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  email TEXT,
  name TEXT,
  phone TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, client_id),
  UNIQUE (stripe_customer_id)
);
CREATE INDEX IF NOT EXISTS idx_stripe_customers_firm ON stripe_customers(firm_id);
CREATE INDEX IF NOT EXISTS idx_stripe_customers_stripe_id ON stripe_customers(stripe_customer_id);

-- Stripe payment methods attached to customers
CREATE TABLE IF NOT EXISTS stripe_payment_methods (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  stripe_payment_method_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('card', 'us_bank_account', 'acss_debit', 'link')),
  card_brand TEXT,
  card_last4 TEXT,
  card_exp_month INTEGER,
  card_exp_year INTEGER,
  bank_name TEXT,
  bank_last4 TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  billing_details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stripe_payment_method_id)
);
CREATE INDEX IF NOT EXISTS idx_stripe_pm_client ON stripe_payment_methods(client_id);
CREATE INDEX IF NOT EXISTS idx_stripe_pm_stripe_id ON stripe_payment_methods(stripe_payment_method_id);

-- Stripe webhook event log (idempotency + audit)
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  stripe_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  processing_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE (stripe_event_id)
);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_firm ON stripe_webhook_events(firm_id);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_unprocessed ON stripe_webhook_events(processed) WHERE processed = FALSE;

-- Recurring invoice schedules
CREATE TABLE IF NOT EXISTS invoice_schedules (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  engagement_id TEXT REFERENCES engagements(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  interval_count INTEGER NOT NULL DEFAULT 1,
  start_date DATE NOT NULL,
  end_date DATE,
  next_run_date DATE NOT NULL,
  last_run_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  template JSONB NOT NULL, -- invoice template: lines, notes, memo, due_days, etc.
  auto_send BOOLEAN NOT NULL DEFAULT FALSE, -- if true, sends immediately on generation; else creates draft
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_schedules_firm ON invoice_schedules(firm_id);
CREATE INDEX IF NOT EXISTS idx_invoice_schedules_next_run ON invoice_schedules(next_run_date) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_invoice_schedules_client ON invoice_schedules(client_id);

-- Payment reminder schedule per invoice
CREATE TABLE IF NOT EXISTS payment_reminders (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('due_soon', 'due_today', 'overdue_1', 'overdue_7', 'overdue_30', 'custom')),
  days_offset INTEGER NOT NULL, -- negative = before due, positive = after due
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invoice_id, reminder_type)
);
CREATE INDEX IF NOT EXISTS idx_payment_reminders_invoice ON payment_reminders(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_reminders_status ON payment_reminders(status) WHERE status = 'pending';

-- Stripe Connect account for the firm (if they want to receive payments directly)
CREATE TABLE IF NOT EXISTS stripe_connect_accounts (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  stripe_account_id TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('standard', 'express', 'custom')),
  charges_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  details_submitted BOOLEAN NOT NULL DEFAULT FALSE,
  requirements JSONB DEFAULT '{}',
  capabilities JSONB DEFAULT '{}',
  business_type TEXT,
  business_profile JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id),
  UNIQUE (stripe_account_id)
);
CREATE INDEX IF NOT EXISTS idx_stripe_connect_firm ON stripe_connect_accounts(firm_id);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_stripe_customers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_stripe_customers_updated_at
  BEFORE UPDATE ON stripe_customers
  FOR EACH ROW
  EXECUTE FUNCTION update_stripe_customers_updated_at();

CREATE OR REPLACE FUNCTION update_stripe_payment_methods_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_stripe_payment_methods_updated_at
  BEFORE UPDATE ON stripe_payment_methods
  FOR EACH ROW
  EXECUTE FUNCTION update_stripe_payment_methods_updated_at();

CREATE OR REPLACE FUNCTION update_invoice_schedules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_invoice_schedules_updated_at
  BEFORE UPDATE ON invoice_schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_invoice_schedules_updated_at();

CREATE OR REPLACE FUNCTION update_payment_reminders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_payment_reminders_updated_at
  BEFORE UPDATE ON payment_reminders
  FOR EACH ROW
  EXECUTE FUNCTION update_payment_reminders_updated_at();

CREATE OR REPLACE FUNCTION update_stripe_connect_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_stripe_connect_accounts_updated_at
  BEFORE UPDATE ON stripe_connect_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_stripe_connect_accounts_updated_at();