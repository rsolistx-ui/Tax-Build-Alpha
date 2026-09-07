-- Milestone: Final professional workspace contract and period correction.
-- Migration 0010's composite FKs used a blanket ON DELETE SET NULL, but
-- client_id participates in both composite keys and is NOT NULL - a
-- blanket SET NULL tries to null client_id too when the referenced row
-- disappears, which the NOT NULL constraint would reject. Recreate both
-- constraints with column-specific SET NULL so only the nullable
-- relationship column (checklist_item_id / duplicate_of_document_id) is
-- cleared and client_id is always preserved. Replay-safe.

DO $$ BEGIN
  ALTER TABLE client_documents DROP CONSTRAINT fk_documents_checklist_same_client;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE client_documents
    ADD CONSTRAINT fk_documents_checklist_same_client
    FOREIGN KEY (checklist_item_id, client_id) REFERENCES document_checklist_items(id, client_id)
    ON DELETE SET NULL (checklist_item_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE client_documents DROP CONSTRAINT fk_documents_duplicate_same_client;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE client_documents
    ADD CONSTRAINT fk_documents_duplicate_same_client
    FOREIGN KEY (duplicate_of_document_id, client_id) REFERENCES client_documents(id, client_id)
    ON DELETE SET NULL (duplicate_of_document_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
