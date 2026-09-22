import { Hono } from "hono";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { SmsReceiptIntakeService } from "../services/sms-receipt-intake";
import { hasValidTwilioSignature, isPermittedTwilioMediaUrl } from "../services/sms-webhook-security";
import { isSupportedUpload, suggestDocumentType } from "../services/documents";
import { newId } from "../lib/id";

export const directUploadSmsRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

const RESUMABLE_UPLOAD_BYTES = 100 * 1024 * 1024;
const RESUMABLE_PART_BYTES = 5 * 1024 * 1024;
type UploadedPart = { partNumber: number; etag: string; sha256: string; bytes: number };

async function authorizedClient(c: { env: Env; get(key: "userId" | "userName"): string; req: { param(name: string): string } }) {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  return { db, firm, client };
}

function safeFilename(value: string): string | null {
  const name = value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
  return name && name.length <= 180 ? name : null;
}

function partsFromJson(value: unknown): UploadedPart[] {
  if (!Array.isArray(value)) return [];
  return value.filter((part): part is UploadedPart => Boolean(part && typeof part === "object" && typeof (part as UploadedPart).partNumber === "number" && typeof (part as UploadedPart).etag === "string" && typeof (part as UploadedPart).sha256 === "string" && typeof (part as UploadedPart).bytes === "number"));
}

function hexDigest(bytes: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest("SHA-256", bytes).then((digest) => Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join(""));
}

/** Starts a recoverable multipart upload; an evidence document is created only at completion. */
directUploadSmsRoutes.post("/:clientId/documents/direct-upload-init", requireSession, requireActiveBeta, async (c) => {
  const body = await c.req.json<{ filename?: string; contentType?: string; sizeBytes?: number; sha256?: string; taxYear?: number | null }>().catch(
    (): { filename?: string; contentType?: string; sizeBytes?: number; sha256?: string; taxYear?: number | null } => ({}),
  );
  const filename = typeof body.filename === "string" ? safeFilename(body.filename) : null;
  const contentType = typeof body.contentType === "string" ? body.contentType.split(";")[0].trim().toLowerCase() : "";
  const sizeBytes = body.sizeBytes;
  const sha256 = typeof body.sha256 === "string" ? body.sha256.toLowerCase() : "";
  if (!filename || !contentType || typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > RESUMABLE_UPLOAD_BYTES || !/^[a-f0-9]{64}$/.test(sha256) || !isSupportedUpload(filename, contentType)) {
    return c.json({ error: "Provide a supported file, its exact byte size (up to 100 MB), and a SHA-256 checksum.", code: "INVALID_UPLOAD_MANIFEST" }, 400);
  }
  const { db, firm, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const sessionId = newId("upl");
  const documentId = newId("doc");
  const r2Key = `documents/${firm.id}/${client.id}/${documentId}/${filename}`;
  const multipart = await c.env.RECEIPTS.createMultipartUpload(r2Key, {
    httpMetadata: { contentType },
    customMetadata: { filename, clientId: client.id, expectedSha256: sha256 },
  });
  await db.query(
    `INSERT INTO document_upload_sessions
      (id, firm_id, client_id, document_id, r2_key, r2_upload_id, filename, content_type, expected_size_bytes, expected_sha256, part_size_bytes, created_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW() + INTERVAL '24 hours')`,
    [sessionId, firm.id, client.id, documentId, r2Key, multipart.uploadId, filename, contentType, sizeBytes, sha256, RESUMABLE_PART_BYTES, c.get("userId")],
  );
  await db.query(`INSERT INTO audit_events (id, client_id, actor_user_id, action, after_json) VALUES ($1,$2,$3,'document_upload_started',$4)`, [newId("aud"), client.id, c.get("userId"), { sessionId, documentId, filename, sizeBytes }]);
  return c.json({ sessionId, documentId, partSizeBytes: RESUMABLE_PART_BYTES, expiresInMinutes: 1440 }, 201);
});

/** Lets a browser resume a session after a connection or page interruption. */
directUploadSmsRoutes.get("/:clientId/documents/direct-upload/:sessionId", requireSession, requireActiveBeta, async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const [session] = await db.query<{ id: string; filename: string; expected_size_bytes: number; expected_sha256: string; part_size_bytes: number; uploaded_parts: unknown; status: string; expires_at: string }>(
    `SELECT id, filename, expected_size_bytes, expected_sha256, part_size_bytes, uploaded_parts, status, expires_at
     FROM document_upload_sessions WHERE id=$1 AND client_id=$2`,
    [c.req.param("sessionId"), client.id],
  );
  if (!session || new Date(session.expires_at).getTime() <= Date.now() || session.status === "aborted") {
    return c.json({ error: "This upload session is unavailable. Start a new upload.", code: "UPLOAD_SESSION_UNAVAILABLE" }, 409);
  }
  const totalParts = Math.ceil(Number(session.expected_size_bytes) / Number(session.part_size_bytes));
  return c.json({
    sessionId: session.id,
    filename: session.filename,
    sizeBytes: Number(session.expected_size_bytes),
    sha256: session.expected_sha256,
    partSizeBytes: Number(session.part_size_bytes),
    completedParts: partsFromJson(session.uploaded_parts).map((part) => part.partNumber),
    totalParts,
    status: session.status,
    expiresAt: session.expires_at,
  });
});

/** Streams one bounded chunk through the authenticated Worker into R2. */
directUploadSmsRoutes.put("/:clientId/documents/direct-upload-stream/:sessionId/:partNumber", requireSession, requireActiveBeta, async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const partNumber = Number(c.req.param("partNumber"));
  const [session] = await db.query<{ id: string; r2_key: string; r2_upload_id: string; expected_size_bytes: number; expected_sha256: string; part_size_bytes: number; uploaded_parts: unknown; status: string; expires_at: string }>(
    `SELECT id, r2_key, r2_upload_id, expected_size_bytes, expected_sha256, part_size_bytes, uploaded_parts, status, expires_at
     FROM document_upload_sessions WHERE id=$1 AND client_id=$2`,
    [c.req.param("sessionId"), client.id],
  );
  if (!session || session.status === "aborted" || session.status === "completed" || new Date(session.expires_at).getTime() <= Date.now()) return c.json({ error: "This upload session is unavailable. Start a new upload.", code: "UPLOAD_SESSION_UNAVAILABLE" }, 409);
  const totalParts = Math.ceil(Number(session.expected_size_bytes) / Number(session.part_size_bytes));
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > totalParts || !c.req.raw.body) return c.json({ error: "Invalid upload part.", code: "INVALID_UPLOAD_PART" }, 400);
  const expectedBytes = partNumber === totalParts ? Number(session.expected_size_bytes) - Number(session.part_size_bytes) * (totalParts - 1) : Number(session.part_size_bytes);
  const contentLength = Number(c.req.header("content-length"));
  if (!Number.isSafeInteger(contentLength) || contentLength !== expectedBytes) return c.json({ error: `Part ${partNumber} must be exactly ${expectedBytes} bytes.`, code: "INVALID_PART_SIZE" }, 400);
  const bytes = await c.req.raw.arrayBuffer();
  const suppliedHash = (c.req.header("x-truepost-part-sha256") || "").toLowerCase();
  const calculatedHash = await hexDigest(bytes);
  if (!/^[a-f0-9]{64}$/.test(suppliedHash) || suppliedHash !== calculatedHash) return c.json({ error: "Part checksum did not verify. Retry this part.", code: "PART_CHECKSUM_MISMATCH" }, 422);
  const multipart = c.env.RECEIPTS.resumeMultipartUpload(session.r2_key, session.r2_upload_id);
  const uploaded = await multipart.uploadPart(partNumber, bytes);
  const existing = partsFromJson(session.uploaded_parts).filter((part) => part.partNumber !== partNumber);
  const parts = [...existing, { partNumber, etag: uploaded.etag, sha256: calculatedHash, bytes: expectedBytes }].sort((a, b) => a.partNumber - b.partNumber);
  await db.query(`UPDATE document_upload_sessions SET uploaded_parts=$1, status='uploading' WHERE id=$2 AND client_id=$3`, [parts, session.id, client.id]);
  return c.json({ partNumber, uploadedParts: parts.length, totalParts });
});

/** Completes R2 and makes the completed object available for professional review. */
directUploadSmsRoutes.post("/:clientId/documents/direct-upload-complete/:sessionId", requireSession, requireActiveBeta, async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const [session] = await db.query<{ id: string; r2_key: string; r2_upload_id: string; document_id: string; filename: string; content_type: string; expected_size_bytes: number; expected_sha256: string; uploaded_parts: unknown; status: string; expires_at: string }>(
    `SELECT id, r2_key, r2_upload_id, document_id, filename, content_type, expected_size_bytes, expected_sha256, uploaded_parts, status, expires_at
     FROM document_upload_sessions WHERE id=$1 AND client_id=$2`,
    [c.req.param("sessionId"), client.id],
  );
  if (!session || session.status === "completed" || new Date(session.expires_at).getTime() <= Date.now()) return c.json({ error: "This upload session is unavailable. Start a new upload.", code: "UPLOAD_SESSION_UNAVAILABLE" }, 409);
  const parts = partsFromJson(session.uploaded_parts);
  const totalParts = Math.ceil(Number(session.expected_size_bytes) / RESUMABLE_PART_BYTES);
  if (parts.length !== totalParts || parts.some((part, index) => part.partNumber !== index + 1)) return c.json({ error: "Every upload part must be verified before completion.", code: "UPLOAD_INCOMPLETE" }, 409);
  const multipart = c.env.RECEIPTS.resumeMultipartUpload(session.r2_key, session.r2_upload_id);
  await multipart.complete(parts.map(({ partNumber, etag }) => ({ partNumber, etag })));
  const suggestedType = suggestDocumentType(session.filename);
  await db.transaction([
    { query: `INSERT INTO client_documents (id, client_id, filename, r2_key, content_type, size_bytes, document_type, source_hash, status, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'needs_review',$9)`, params: [session.document_id, client.id, session.filename, session.r2_key, session.content_type, session.expected_size_bytes, suggestedType, session.expected_sha256, c.get("userId")] },
    { query: `UPDATE document_upload_sessions SET status='completed', completed_at=NOW() WHERE id=$1 AND client_id=$2`, params: [session.id, client.id] },
    { query: `INSERT INTO audit_events (id, client_id, actor_user_id, action, after_json) VALUES ($1,$2,$3,'document_upload_completed',$4)`, params: [newId("aud"), client.id, c.get("userId"), { sessionId: session.id, documentId: session.document_id, filename: session.filename, sizeBytes: session.expected_size_bytes, sha256: session.expected_sha256, verifiedParts: parts.length }] },
  ]);
  return c.json({ id: session.document_id, suggestedType, status: "needs_review" });
});

directUploadSmsRoutes.delete("/:clientId/documents/direct-upload/:sessionId", requireSession, requireActiveBeta, async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const [session] = await db.query<{ r2_key: string; r2_upload_id: string; status: string }>(`SELECT r2_key, r2_upload_id, status FROM document_upload_sessions WHERE id=$1 AND client_id=$2`, [c.req.param("sessionId"), client.id]);
  if (!session) return c.json({ error: "Upload session not found" }, 404);
  if (session.status !== "completed") await c.env.RECEIPTS.resumeMultipartUpload(session.r2_key, session.r2_upload_id).abort().catch(() => undefined);
  await db.query(`UPDATE document_upload_sessions SET status='aborted' WHERE id=$1 AND client_id=$2 AND status <> 'completed'`, [c.req.param("sessionId"), client.id]);
  return c.json({ ok: true });
});

/**
 * POST /api/clients/:clientId/sms-drop
 * SMS Receipt Mobile Drop simulator & portal direct drop.
 */
directUploadSmsRoutes.post("/:clientId/sms-drop", requireSession, requireActiveBeta, async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const formData = await c.req.parseBody();
  const file = formData.file as unknown;
  const senderPhone = (formData.senderPhone as string) || client.phone || "+15555550100";
  const smsBody = (formData.notes as string) || "Mobile receipt drop";
  const amountHint = formData.amountHint ? Number(formData.amountHint) : undefined;

  let fileBytes: Uint8Array;
  let filename = "receipt.jpg";
  let mimeType = "image/jpeg";

  if (file instanceof File) {
    fileBytes = new Uint8Array(await file.arrayBuffer());
    filename = file.name || "receipt.jpg";
    mimeType = file.type || "image/jpeg";
  } else {
    // Generate synthetic receipt image for testing if no file passed
    fileBytes = new TextEncoder().encode("MMS_TEST_RECEIPT_PAYLOAD");
  }

  const service = new SmsReceiptIntakeService(db, c.env);
  const result = await service.ingestSmsReceipt({
    clientId,
    firmId: firm.id,
    clientName: client.name,
    fileBytes,
    filename,
    mimeType,
    senderPhone,
    smsBody,
    amountHint,
  });

  return c.json(result);
});

/**
 * POST /api/sms/inbound
 * Public webhook receiver for carrier/Twilio MMS inbound receipt photo drops.
 */
directUploadSmsRoutes.post("/sms/inbound", async (c) => {
  // Do not leave a public ingestion surface available until the actual carrier
  // credentials have been provisioned. This is intentionally fail-closed in
  // local, desktop, and partially configured production environments.
  if (!c.env.TWILIO_ACCOUNT_SID || !c.env.TWILIO_AUTH_TOKEN) {
    return c.text("SMS intake is not configured.", 503);
  }

  const db = createDb(c.env);
  const formData = await c.req.parseBody();

  const form = Object.fromEntries(
    Object.entries(formData).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const signatureValid = await hasValidTwilioSignature({
    authToken: c.env.TWILIO_AUTH_TOKEN,
    requestUrl: c.req.url,
    signature: c.req.header("x-twilio-signature"),
    form,
  });
  if (!signatureValid) return c.text("Unauthorized webhook.", 401);

  const from = (formData.From as string) || "";
  const body = (formData.Body as string) || "";
  const mediaUrl = (formData.MediaUrl0 as string) || "";
  const mediaType = (formData.MediaContentType0 as string) || "image/jpeg";

  if (!from || !mediaUrl || !isPermittedTwilioMediaUrl(mediaUrl)) {
    return c.text("<Response><Message>Sender phone number missing.</Message></Response>", 400, {
      "Content-Type": "text/xml",
    });
  }

  const service = new SmsReceiptIntakeService(db, c.env);
  const matchedClient = await service.findClientByPhone(from);

  if (!matchedClient) {
    return c.text(
      "<Response><Message>Truepost: This phone number is not registered to an active client entity.</Message></Response>",
      200,
      { "Content-Type": "text/xml" }
    );
  }

  if (!/^image\/(jpeg|png|webp)$/i.test(mediaType)) {
    return c.text("<Response><Message>Truepost accepts JPEG, PNG, or WebP receipt images by text.</Message></Response>", 415, {
      "Content-Type": "text/xml",
    });
  }

  let fileBytes: Uint8Array;
  try {
    const mediaRes = await fetch(mediaUrl, {
      headers: { Authorization: `Basic ${btoa(`${c.env.TWILIO_ACCOUNT_SID}:${c.env.TWILIO_AUTH_TOKEN}`)}` },
    });
    const advertisedSize = Number(mediaRes.headers.get("content-length") || "0");
    if (!mediaRes.ok || (Number.isFinite(advertisedSize) && advertisedSize > 20 * 1024 * 1024)) {
      return c.text("<Response><Message>Truepost could not accept this attachment. Please use the secure upload link.</Message></Response>", 413, { "Content-Type": "text/xml" });
    }
    fileBytes = new Uint8Array(await mediaRes.arrayBuffer());
    if (fileBytes.byteLength === 0 || fileBytes.byteLength > 20 * 1024 * 1024) {
      return c.text("<Response><Message>Truepost could not accept this attachment. Please use the secure upload link.</Message></Response>", 413, { "Content-Type": "text/xml" });
    }
  } catch {
    return c.text("<Response><Message>Truepost could not retrieve this attachment. Please use the secure upload link.</Message></Response>", 502, { "Content-Type": "text/xml" });
  }

  // Parse amount if present in text (e.g. "$45.20")
  const amountMatch = body.match(/\$?\s*([0-9]+(?:\.[0-9]{2})?)/);
  const amountHint = amountMatch ? parseFloat(amountMatch[1]) : undefined;

  const result = await service.ingestSmsReceipt({
    clientId: matchedClient.id,
    firmId: matchedClient.firm_id,
    clientName: matchedClient.name,
    fileBytes,
    filename: `sms_mms_${Date.now()}.jpg`,
    mimeType: mediaType,
    senderPhone: from,
    smsBody: body,
    amountHint,
  });

  return c.text(
    `<Response><Message>✓ Truepost: ${result.message}</Message></Response>`,
    200,
    { "Content-Type": "text/xml" }
  );
});
