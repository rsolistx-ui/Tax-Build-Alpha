-- Client assignment. A staff member sees only the clients the firm owner
-- assigns them, unless the owner turns on sees_all_clients for that person.
-- Owners always see every client. New staff start with no clients (least
-- privilege, 16 CFR 314.4(c)(1)); only the owner existed when this shipped,
-- so no one loses access. Replay-safe.
ALTER TABLE firm_members ADD COLUMN IF NOT EXISTS sees_all_clients BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS client_assignments (
  client_id TEXT NOT NULL,
  firm_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  assigned_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, user_id),
  -- The client must belong to the same firm, and assignments go with it.
  CONSTRAINT fk_client_assignments_client_same_firm
    FOREIGN KEY (client_id, firm_id) REFERENCES clients(id, firm_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_client_assignments_user ON client_assignments(user_id);
