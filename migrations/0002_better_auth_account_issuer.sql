-- Better Auth 1.7 requires account.issuer and a unique identity key
-- across issuer + accountId. Existing Folio auth schema predates this field.

ALTER TABLE account
ADD COLUMN issuer TEXT NOT NULL DEFAULT 'local:credential';

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_issuer_account_id
ON account(issuer, accountId);
