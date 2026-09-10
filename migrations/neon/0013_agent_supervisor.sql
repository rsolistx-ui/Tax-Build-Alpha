-- Event-driven agent supervisor.  This is deliberately a durable work
-- ledger, not a timer that repeatedly calls an LLM.  Every task is created
-- from a real user event and carries the policy decision that controls it.

-- Older alpha installations can predate migration 0012's tenant-safety
-- anchor.  Establish it here as well so this migration is independently
-- deployable and the agent table never weakens tenancy.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'clients'::regclass AND conname = 'uq_clients_id_firm'
  ) THEN
    ALTER TABLE clients
      ADD CONSTRAINT uq_clients_id_firm UNIQUE (id, firm_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  action_type TEXT NOT NULL,
  autonomy TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_approval',
  confidence NUMERIC,
  recommendation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  policy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_by_user_id TEXT,
  approved_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_agent_tasks_source_agent UNIQUE (client_id, source_type, source_id, agent_name),
  CONSTRAINT chk_agent_task_autonomy CHECK (autonomy IN ('autonomous', 'approval_required')),
  CONSTRAINT chk_agent_task_status CHECK (status IN ('queued', 'running', 'awaiting_approval', 'approved', 'dismissed', 'completed', 'failed'))
);

DO $$ BEGIN
  ALTER TABLE agent_tasks
    ADD CONSTRAINT fk_agent_tasks_client_same_firm
    FOREIGN KEY (client_id, firm_id) REFERENCES clients(id, firm_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_tasks_firm_status ON agent_tasks(firm_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_client_status ON agent_tasks(client_id, status, created_at DESC);
