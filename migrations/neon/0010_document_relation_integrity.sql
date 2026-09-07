-- Milestone: Professional workspace release gate.
-- API-level ownership checks are not enough: this makes it impossible at
-- the database level for a client_documents row to reference a checklist
-- item or a duplicate-target document belonging to a different client,
-- even if a future code path forgets to check. Replay-safe.

-- Repair any legacy cross-client relationship before the constraint exists
-- to enforce it. Production currently has zero client_documents rows, but
-- this keeps the migration safe to run against any environment.
UPDATE client_documents cd
SET checklist_item_id = NULL
WHERE cd.checklist_item_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM document_checklist_items dci
    WHERE dci.id = cd.checklist_item_id AND dci.client_id = cd.client_id
  );

UPDATE client_documents cd
SET duplicate_of_document_id = NULL
WHERE cd.duplicate_of_document_id IS NOT NULL
  AND (
    cd.duplicate_of_document_id = cd.id
    OR NOT EXISTS (
      SELECT 1 FROM client_documents other
      WHERE other.id = cd.duplicate_of_document_id AND other.client_id = cd.client_id
    )
  );

-- Composite-key targets for the composite foreign keys below.
DO $$ BEGIN
  ALTER TABLE document_checklist_items ADD CONSTRAINT uq_checklist_id_client UNIQUE (id, client_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE client_documents ADD CONSTRAINT uq_documents_id_client UNIQUE (id, client_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Replace the single-column FKs (scoped to id only) with composite ones
-- scoped by client_id, so a checklist match or duplicate target can never
-- silently point at a different client row.
DO $$ BEGIN
  ALTER TABLE client_documents DROP CONSTRAINT client_documents_checklist_item_id_fkey;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE client_documents
    ADD CONSTRAINT fk_documents_checklist_same_client
    FOREIGN KEY (checklist_item_id, client_id) REFERENCES document_checklist_items(id, client_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE client_documents DROP CONSTRAINT client_documents_duplicate_of_document_id_fkey;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE client_documents
    ADD CONSTRAINT fk_documents_duplicate_same_client
    FOREIGN KEY (duplicate_of_document_id, client_id) REFERENCES client_documents(id, client_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
