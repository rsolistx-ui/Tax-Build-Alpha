import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { getEngagement } from "../services/engagements";
import { createVersion, createSignatureRequest } from "../services/doc-versioning";
import { buildEngagementLetterPdf } from "../services/engagement-letter";
import { sha256Hex } from "../services/documents";
import { newId } from "../lib/id";

export const engagementLetterRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
engagementLetterRoutes.use("*", requireSession);
engagementLetterRoutes.use("*", requireActiveBeta);

const generateSchema = z.object({ fee: z.string().max(200).optional() });

engagementLetterRoutes.post("/:clientId/engagements/:engagementId/letter", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);
  if (!client.email) return c.json({ error: "This client has no email on file. Add one before generating an engagement letter." }, 400);

  const engagement = await getEngagement(db, c.req.param("engagementId"), firm.id);
  if (!engagement || engagement.client_id !== client.id) return c.json({ error: "Engagement not found" }, 404);

  const body = generateSchema.parse(await c.req.json().catch(() => ({})));

  const { pdfBytes, signatureTab, dateTab } = await buildEngagementLetterPdf({
    firmName: firm.name,
    clientName: client.name,
    serviceType: engagement.service_type,
    taxYear: engagement.tax_year,
    fee: body.fee ?? null,
    effectiveDate: new Date(),
  });

  const documentId = newId("doc");
  const key = `engagement-letters/${firm.id}/${client.id}/${documentId}.pdf`;
  await c.env.RECEIPTS.put(key, pdfBytes, { httpMetadata: { contentType: "application/pdf" } });
  const hash = await sha256Hex(pdfBytes.buffer as ArrayBuffer);

  await db.query(
    `INSERT INTO client_documents (id, client_id, filename, r2_key, content_type, document_type, status, source_hash, uploaded_by)
     VALUES ($1,$2,$3,$4,'application/pdf','engagement_letter','confirmed',$5,$6)`,
    [documentId, client.id, `Engagement Letter - ${engagement.title}.pdf`, key, hash, c.get("userId")],
  );
  await createVersion(db, firm.id, documentId, key, c.get("userId"));

  const recipientId = "1";
  let request = await createSignatureRequest(db, firm.id, client.id, {
    engagementId: engagement.id,
    documentId,
    formType: "engagement_letter",
    recipients: [{ email: client.email, name: client.name, roleName: "Client", recipientId }],
  });
  const tabs = [
    { type: "signHere", recipientId, documentId, pageNumber: String(signatureTab.pageNumber), xPosition: String(signatureTab.xPosition), yPosition: String(signatureTab.yPosition), required: true, locked: false },
    { type: "dateSigned", recipientId, documentId, pageNumber: String(dateTab.pageNumber), xPosition: String(dateTab.xPosition), yPosition: String(dateTab.yPosition), required: true, locked: false },
  ];
  await db.query(`UPDATE signature_requests SET tabs=$1::jsonb WHERE id=$2`, [JSON.stringify(tabs), request.id]);
  request = { ...request, tabs };

  await db.query(
    `INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW())`,
    [crypto.randomUUID(), firm.id, client.id, "engagement_letter_generated", c.get("userId"), JSON.stringify({ engagementId: engagement.id, requestId: request.id, documentId })],
  );

  return c.json({ documentId, request }, 201);
});
