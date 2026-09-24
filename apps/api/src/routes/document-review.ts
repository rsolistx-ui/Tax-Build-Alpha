import { Hono } from "hono";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { applyDocumentReviewAction, loadReviewDocument, type DocumentReviewAction } from "./workspace";
import { canReadSignedRecords, signedRecordDocumentSql } from "../services/firm-roles";

/**
 * Cross-client evidence-processing queue: Phyllis processes uncertain
 * documents without opening each client manually. Reuses the same
 * applyDocumentReviewAction as the client-scoped endpoint - one review
 * model, not two.
 */
export const documentReviewRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
documentReviewRoutes.use("*", requireSession);
documentReviewRoutes.use("*", requireActiveBeta);

documentReviewRoutes.get("/review", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const documents = await db.query<{
    id: string; client_id: string; client_name: string; filename: string; content_type: string | null;
    document_type: string; tax_year: number | null; status: string; duplicate_of_document_id: string | null;
    checklist_item_id: string | null; checklist_doc_type: string | null; checklist_custom_label: string | null;
    uploaded_at: string;
  }>(
    `SELECT cd.id, cd.client_id, c.name AS client_name, cd.filename, cd.content_type, cd.document_type,
            cd.tax_year, cd.status, cd.duplicate_of_document_id, cd.checklist_item_id,
            dci.doc_type AS checklist_doc_type, dci.custom_label AS checklist_custom_label, cd.uploaded_at
     FROM client_documents cd
     JOIN clients c ON c.id = cd.client_id
     LEFT JOIN document_checklist_items dci ON dci.id = cd.checklist_item_id
     WHERE c.firm_id = $1 AND cd.status = 'needs_review'
       AND ($2::boolean = false OR NOT ${signedRecordDocumentSql("cd")})
     ORDER BY cd.uploaded_at ASC
     LIMIT 200`,
    [firm.id, !canReadSignedRecords(c.get("firmRole") ?? "read_only")],
  );

  return c.json({
    documents: documents.map((d) => ({
      id: d.id,
      clientId: d.client_id,
      clientName: d.client_name,
      filename: d.filename,
      contentType: d.content_type,
      documentType: d.document_type,
      taxYear: d.tax_year,
      status: d.status,
      duplicateWarning: d.duplicate_of_document_id !== null,
      duplicateOfDocumentId: d.duplicate_of_document_id,
      checklistMatch: d.checklist_item_id ? { id: d.checklist_item_id, docType: d.checklist_doc_type, customLabel: d.checklist_custom_label } : null,
      uploadedAt: d.uploaded_at,
    })),
  });
});

documentReviewRoutes.patch("/review/:documentId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = (await c.req.json()) as DocumentReviewAction;
  const documentId = c.req.param("documentId");
  const result = await applyDocumentReviewAction(db, firm.id, documentId, c.get("userId"), body);
  if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 404);
  // Terminal actions (confirm/mark_duplicate/mark_not_needed) resolve the
  // review queue's reason for showing this document - the caller removes
  // it. Every other action is a correction that keeps the item under
  // review, so the caller needs its refreshed row, not a removal signal.
  const document = result.terminal ? null : await loadReviewDocument(db, documentId, firm.id);
  return c.json({ ok: true, terminal: result.terminal, document });
});
