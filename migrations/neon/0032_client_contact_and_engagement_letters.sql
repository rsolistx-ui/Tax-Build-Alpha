-- Client email/phone were never stored anywhere in the schema. Every
-- feature that needs to contact a client (e-signature recipients, reminders,
-- portal invites, engagement letters) had to take a freeform recipient
-- object typed in by hand each time. This makes contact info a first-class,
-- reusable field on the client record.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE client_documents DROP CONSTRAINT IF EXISTS chk_document_type;
ALTER TABLE client_documents
  ADD CONSTRAINT chk_document_type CHECK (document_type IN (
    'receipt', 'bank_statement', 'tax_document', 'prior_year_return',
    'payroll_document', 'loan_document', 'formation_document',
    'engagement_letter', 'other'
  ));
