-- Staff seats. A firm owner can invite staff; the invitation carries the firm
-- and role, and redeeming it adds the new user to that firm (firm_members)
-- instead of creating a firm of their own. Staff access follows the firm
-- owner's entitlement. A user belongs to exactly one firm, which ensureFirm's
-- membership lookup relies on. Replay-safe.
ALTER TABLE beta_invitations ADD COLUMN IF NOT EXISTS firm_id TEXT REFERENCES firms(id) ON DELETE CASCADE;
ALTER TABLE beta_invitations ADD COLUMN IF NOT EXISTS firm_role TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_firm_members_one_firm_per_user ON firm_members(user_id);

-- Audit follow-up for 0070: category_tax_lines.firm_id must match its client's
-- firm, enforced by the database like every other client-owned table (0012).
DO $$ BEGIN
  ALTER TABLE category_tax_lines
    ADD CONSTRAINT fk_category_tax_lines_client_same_firm
    FOREIGN KEY (client_id, firm_id) REFERENCES clients(id, firm_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
