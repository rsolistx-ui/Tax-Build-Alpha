import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import { requirePortalToken, type PortalVars } from "../middleware/portal";
import { getClient } from "../services/clients";
import { listEngagementsWithProgress } from "../services/engagements";
import { getClientRequest, listClientRequests, markRequestViewed, respondToRequest } from "../services/client-requests";
import { addRequestMessage, listRequestMessages } from "../services/request-messages";
import { ingestReceiptForClient, HttpError } from "../services/receipt-intake";
import { newId } from "../lib/id";
import { isSupportedUpload, isValidTaxYear, MAX_UPLOAD_BYTES, sha256Hex, suggestDocumentType } from "../services/documents";

/**
 * Client-facing portal API. Every route resolves firmId/clientId from the
 * portal token via requirePortalToken - never from a path or body
 * parameter the client supplies. A client can only ever see their own
 * engagements, requests, and client-visible documents.
 */
export const portalRoutes = new Hono<{ Bindings: Env; Variables: PortalVars }>();
portalRoutes.use("*", requirePortalToken);

portalRoutes.get("/me", async (c) => {
  const db = createDb(c.env);
  const client = await getClient(db, c.get("portalClientId"), c.get("portalFirmId"));
  if (!client) return c.json({ error: "Not found" }, 404);
  return c.json({ client: { id: client.id, name: client.name } });
});

/**
 * Home summary: active engagements, outstanding/due/overdue request
 * counts, and recently completed requests, so the client sees "what we
 * need from you" without opening every tab.
 */
portalRoutes.get("/home", async (c) => {
  const db = createDb(c.env);
  const firmId = c.get("portalFirmId");
  const clientId = c.get("portalClientId");

  const client = await getClient(db, clientId, firmId);
  if (!client) return c.json({ error: "Not found" }, 404);

  const engagements = await listEngagementsWithProgress(db, firmId, clientId);
  const activeEngagements = engagements.filter((e) => e.status !== "complete" && e.status !== "archived");

  const requests = (await listClientRequests(db, firmId, clientId)).filter((r) => r.status !== "draft");
  const outstanding = requests.filter((r) => r.status === "requested" || r.status === "viewed");
  const overdue = outstanding.filter((r) => r.due_at && new Date(r.due_at).getTime() < Date.now());
  const recentlyCompleted = requests.filter((r) => r.status === "satisfied").slice(0, 5);

  return c.json({
    client: { id: client.id, name: client.name },
    activeEngagements,
    outstandingRequestCount: outstanding.length,
    overdueRequests: overdue,
    dueRequests: outstanding.filter((r) => !overdue.includes(r)),
    recentlyCompletedRequests: recentlyCompleted,
  });
});

portalRoutes.get("/engagements", async (c) => {
  const db = createDb(c.env);
  const engagements = await listEngagementsWithProgress(db, c.get("portalFirmId"), c.get("portalClientId"));
  return c.json({ engagements });
});

portalRoutes.get("/requests", async (c) => {
  const db = createDb(c.env);
  const requests = await listClientRequests(db, c.get("portalFirmId"), c.get("portalClientId"));
  // Never show a request still in "draft" - that is pre-professional-approval.
  return c.json({ requests: requests.filter((r) => r.status !== "draft") });
});

async function loadPortalRequest(c: { env: Env; get: (k: keyof PortalVars) => string }, requestId: string) {
  const db = createDb(c.env);
  const request = await getClientRequest(db, requestId, c.get("portalFirmId"));
  if (!request || request.client_id !== c.get("portalClientId") || request.status === "draft") return undefined;
  return request;
}

portalRoutes.get("/requests/:requestId", async (c) => {
  const request = await loadPortalRequest(c, c.req.param("requestId"));
  if (!request) return c.json({ error: "Not found" }, 404);

  const db = createDb(c.env);
  await markRequestViewed(db, request.id, c.get("portalFirmId"));
  const messages = await listRequestMessages(db, request.id);
  return c.json({ request, messages });
});

const messageSchema = z.object({ body: z.string().trim().min(1).max(4000) });

portalRoutes.post("/requests/:requestId/messages", async (c) => {
  const request = await loadPortalRequest(c, c.req.param("requestId"));
  if (!request) return c.json({ error: "Not found" }, 404);

  const db = createDb(c.env);
  const body = messageSchema.parse(await c.req.json());
  const message = await addRequestMessage(db, request.id, c.get("portalFirmId"), c.get("portalClientId"), "client", null, body.body);
  return c.json({ message }, 201);
});

/**
 * Evidence upload for a request. Never a second storage system: missing
 * receipts flow through the exact same ingestReceiptForClient pipeline the
 * staff upload route uses (R2, extraction, correction memory, pending-
 * receipt linkage), branching to the client_documents path for every other
 * request type. actorUserId is null (client-originated); professional
 * review remains mandatory before any accounting disposition regardless of
 * who uploaded the file. Multiple files may be uploaded to the same
 * request in separate calls.
 */
portalRoutes.post("/requests/:requestId/evidence", async (c) => {
  const request = await loadPortalRequest(c, c.req.param("requestId"));
  if (!request) return c.json({ error: "Not found" }, 404);
  if (request.status === "satisfied" || request.status === "cancelled") {
    return c.json({ error: "This request is already closed" }, 409);
  }

  const db = createDb(c.env);
  const client = await getClient(db, c.get("portalClientId"), c.get("portalFirmId"));
  if (!client) return c.json({ error: "Not found" }, 404);

  const form = await c.req.formData();
  const entry = form.get("file");
  if (!entry || typeof entry === "string") return c.json({ error: "file is required" }, 400);
  const file = entry as File;
  if (file.size <= 0) return c.json({ error: "file is empty" }, 400);

  if (request.request_type === "missing_receipt") {
    try {
      const result = await ingestReceiptForClient(db, c.env, client, file, null, request.related_bank_transaction_id);
      if (!result.ok) return c.json({ error: result.error }, 500);
      await addRequestMessage(db, request.id, c.get("portalFirmId"), c.get("portalClientId"), "system", null, `Client uploaded a receipt (${file.name}).`);
      await respondToRequest(db, request.id, c.get("portalFirmId"));
      return c.json({ receiptId: result.receiptId }, 201);
    } catch (error) {
      if (error instanceof HttpError) return c.json({ error: error.message }, error.status as 400 | 404 | 409);
      throw error;
    }
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: `File exceeds the ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB upload limit`, code: "FILE_TOO_LARGE" }, 413);
  }
  if (!isSupportedUpload(file.name, file.type || null)) {
    return c.json({ error: "Unsupported file type. Supported: PDF, PNG, JPG, JPEG, HEIC, DOCX, XLSX, CSV.", code: "UNSUPPORTED_FILE_TYPE" }, 415);
  }
  const taxYearValue = form.get("taxYear");
  let taxYear: number | null = null;
  if (typeof taxYearValue === "string" && taxYearValue.trim()) {
    const parsedYear = Number(taxYearValue);
    if (!isValidTaxYear(parsedYear)) return c.json({ error: "taxYear must be an integer between 2000 and 2100" }, 400);
    taxYear = parsedYear;
  }

  const bytes = await file.arrayBuffer();
  const hash = await sha256Hex(bytes);
  const documentId = newId("doc");
  const key = `documents/${client.firm_id}/${client.id}/${documentId}/${file.name}`;
  await c.env.RECEIPTS.put(key, bytes, {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
    customMetadata: { filename: file.name, clientId: client.id },
  });

  const suggestedType = suggestDocumentType(file.name);
  await db.query(
    `INSERT INTO client_documents
      (id, client_id, filename, r2_key, content_type, size_bytes, document_type, tax_year, source_hash, status, request_id, client_visible, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'needs_review', $10, TRUE, NULL)`,
    [documentId, client.id, file.name, key, file.type || null, file.size, suggestedType, taxYear, hash, request.id],
  );
  await addRequestMessage(db, request.id, c.get("portalFirmId"), c.get("portalClientId"), "system", null, `Client uploaded a document (${file.name}).`);
  await respondToRequest(db, request.id, c.get("portalFirmId"));

  return c.json({ documentId, suggestedType }, 201);
});

portalRoutes.get("/documents", async (c) => {
  const db = createDb(c.env);
  const documents = await db.query(
    `SELECT id, filename, document_type, status, uploaded_at FROM client_documents WHERE client_id = $1 AND client_visible = TRUE ORDER BY uploaded_at DESC`,
    [c.get("portalClientId")],
  );
  return c.json({ documents });
});

/**
 * Portal-authorized document source, distinct from the staff document
 * source route: authorized by the portal token, scoped to this client, and
 * refuses any document that is not flagged client_visible - an internal
 * document is never reachable through the portal even by id.
 */
portalRoutes.get("/documents/:documentId/source", async (c) => {
  const db = createDb(c.env);
  const [document] = await db.query<{ r2_key: string; content_type: string | null; filename: string }>(
    `SELECT r2_key, content_type, filename FROM client_documents WHERE id = $1 AND client_id = $2 AND client_visible = TRUE`,
    [c.req.param("documentId"), c.get("portalClientId")],
  );
  if (!document) return c.json({ error: "Not found" }, 404);
  const object = await c.env.RECEIPTS.get(document.r2_key);
  if (!object) return c.json({ error: "Source object missing" }, 404);
  const filename = document.filename.replace(/["\r\n]/g, "");
  return new Response(object.body, {
    headers: {
      "content-type": document.content_type || object.httpMetadata?.contentType || "application/octet-stream",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
});
