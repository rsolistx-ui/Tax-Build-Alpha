import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { listVersions, createVersion, listSignatureRequests, createSignatureRequest } from "../services/doc-versioning";
import { DocuSignEnvelopeStore, storeWebhookEvent } from "../services/docusign";

export const docVersioningRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
docVersioningRoutes.use("*", requireSession);

docVersioningRoutes.get("/:clientId/documents/:docId/versions", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  return c.json({ versions: await listVersions(db, c.req.param("docId")) });
});
docVersioningRoutes.post("/:clientId/documents/:docId/versions", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const body = z.object({ r2Key: z.string() }).parse(await c.req.json());
  return c.json({ version: await createVersion(db, firm.id, c.req.param("docId"), body.r2Key, c.get("userId")) }, 201);
});
docVersioningRoutes.get("/:clientId/signature-requests", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  return c.json({ requests: await listSignatureRequests(db, firm.id, client.id) });
});
docVersioningRoutes.post("/:clientId/signature-requests", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const body = z.object({
    engagementId: z.string().optional(),
    documentId: z.string().optional(),
    formType: z.string().default("8879"),
    recipients: z.array(z.any()).default([]),
    tabs: z.array(z.object({
      type: z.enum(["signHere","initialHere","dateSigned","text","checkbox"]),
      anchorString: z.string().optional(),
      xPosition: z.string().optional(), yPosition: z.string().optional(),
      pageNumber: z.string().optional(),
      documentId: z.string(), recipientId: z.string(),
      required: z.boolean().default(true), locked: z.boolean().default(false),
    })).optional(),
    requireKba: z.boolean().default(false),
  }).parse(await c.req.json());
  if (body.requireKba) {
    const kbaRecipient = body.recipients.find((r: any) => r.requireKba !== false);
    if (kbaRecipient) kbaRecipient.authenticationMethod = "KBA";
  }
  let request = await createSignatureRequest(db, firm.id, client.id, { engagementId: body.engagementId, documentId: body.documentId, formType: body.formType, recipients: body.recipients });
  if (body.tabs && body.tabs.length) {
    await db.query(`UPDATE signature_requests SET tabs=$1::jsonb WHERE id=$2`, [JSON.stringify(body.tabs), request.id]);
    request = { ...request, tabs: body.tabs } as any;
  }
  await db.query(`INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW())`,
    [crypto.randomUUID(), firm.id, client.id, "signature_request_created", c.get("userId"), JSON.stringify({ requestId: request.id, formType: body.formType, recipientCount: body.recipients.length, requireKba: body.requireKba })]);
  return c.json({ request }, 201);
});
docVersioningRoutes.post("/:clientId/signature-requests/:requestId/send", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const [req] = await db.query<any>(`SELECT * FROM signature_requests WHERE id=$1 AND firm_id=$2 AND client_id=$3`, [c.req.param("requestId"), firm.id, client.id]);
  if (!req) return c.json({ error: "Signature request not found" }, 404);
  if (req.status !== "pending") return c.json({ error: `Request already ${req.status}` }, 400);
  const env = c.env as Env;
  const cfgOk = env.DOCUSIGN_CLIENT_ID && env.DOCUSIGN_ACCOUNT_ID && env.DOCUSIGN_BASE_URL;
  if (cfgOk) {
    try {
      const store = new DocuSignEnvelopeStore(db);
      await store.saveEnvelope({ firmId: firm.id, clientId: client.id, engagementId: req.engagement_id ?? undefined, envelopeId: req.id, status: "sent", subject: `Please sign: ${req.form_type ?? "8879"}`, recipients: req.recipients ?? [], sentAt: new Date() });
    } catch {}
  }
  await db.query(`UPDATE signature_requests SET status='sent', sent_at=NOW() WHERE id=$1`, [req.id]);
  await db.query(`INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW())`,
    [crypto.randomUUID(), firm.id, client.id, "signature_request_sent", c.get("userId"), JSON.stringify({ requestId: req.id, formType: req.form_type })]);
  return c.json({ requestId: req.id, status: "sent", sentVia: (c.env as Env).DOCUSIGN_CLIENT_ID ? "docusign" : "local_stub" });
});
docVersioningRoutes.post("/:clientId/signature-requests/:requestId/void", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const [req] = await db.query<any>(`SELECT * FROM signature_requests WHERE id=$1 AND firm_id=$2 AND client_id=$3`, [c.req.param("requestId"), firm.id, client.id]);
  if (!req) return c.json({ error: "Signature request not found" }, 404);
  if (req.status === "signed" || req.status === "voided") return c.json({ error: `Already ${req.status}` }, 400);
  const body = z.object({ reason: z.string().default("Voided by firm") }).parse(await c.req.json().catch(() => ({})));
  await db.query(`UPDATE signature_requests SET status='voided', voided_at=NOW(), void_reason=$1 WHERE id=$2`, [body.reason, req.id]);
  const envelopeRows = await db.query<any>(`SELECT envelope_id FROM docusign_envelopes WHERE envelope_id=$1`, [req.id]);
  if (envelopeRows.length) await db.query(`UPDATE docusign_envelopes SET status='voided', voided_at=NOW(), void_reason=$1 WHERE envelope_id=$2`, [body.reason, req.id]);
  await db.query(`INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW())`,
    [crypto.randomUUID(), firm.id, client.id, "signature_request_voided", c.get("userId"), JSON.stringify({ requestId: req.id, reason: body.reason })]);
  return c.json({ requestId: req.id, status: "voided" });
});
docVersioningRoutes.post("/:clientId/signature-requests/:requestId/complete", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const [req] = await db.query<any>(`SELECT * FROM signature_requests WHERE id=$1 AND firm_id=$2 AND client_id=$3`, [c.req.param("requestId"), firm.id, client.id]);
  if (!req) return c.json({ error: "Signature request not found" }, 404);
  if (req.status !== "sent") return c.json({ error: `Request must be sent before completing, currently ${req.status}` }, 400);
  const body = z.object({ signedAt: z.string().optional(), recipientName: z.string().optional(), kbaPassed: z.boolean().optional(), ipAddress: z.string().optional() }).parse(await c.req.json().catch(() => ({})));
  await db.query(`UPDATE signature_requests SET status='signed', signed_at=NOW() WHERE id=$1`, [req.id]);
  await db.query(`UPDATE docusign_envelopes SET status='completed', completed_at=NOW() WHERE envelope_id=$1`, [req.id]);
  const evidence = { requestId: req.id, formType: req.form_type, recipientName: body.recipientName ?? null, signedAt: body.signedAt ?? new Date().toISOString(), kbaPassed: body.kbaPassed ?? null, ipAddress: body.ipAddress ?? null };
  await db.query(`INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW())`,
    [crypto.randomUUID(), firm.id, client.id, "signature_request_signed", c.get("userId"), JSON.stringify(evidence)]);
  return c.json({ requestId: req.id, status: "signed", evidence });
});
docVersioningRoutes.post("/:clientId/docusign/webhook", async (c) => {
  const db = createDb(c.env);
  const raw = await c.req.json().catch(() => ({}));
  const envelopeId = (raw as any)?.envelopeId ?? (raw as any)?.envelope_id ?? (raw as any)?.envelopeId;
  const status = (raw as any)?.envelopeStatus ?? (raw as any)?.status ?? (raw as any)?.envelope_status ?? "unknown";
  await storeWebhookEvent(db, envelopeId ?? "unknown", (raw as any)?.event ?? "webhook", raw);
  if (envelopeId) {
    if (status === "completed") {
      await db.query(`UPDATE signature_requests SET status='signed', signed_at=NOW() WHERE id=$1`, [envelopeId]);
      await db.query(`UPDATE docusign_envelopes SET status='completed', completed_at=NOW() WHERE envelope_id=$1`, [envelopeId]);
    } else if (status === "declined") {
      await db.query(`UPDATE signature_requests SET status='declined' WHERE id=$1`, [envelopeId]);
    } else if (status === "voided") {
      await db.query(`UPDATE signature_requests SET status='voided' WHERE id=$1`, [envelopeId]);
    }
  }
  return c.json({ ok: true });
});
docVersioningRoutes.get("/:clientId/documents/:docId/signed-url", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const [doc] = await db.query<any>(`SELECT id, firm_id FROM documents WHERE id=$1 AND firm_id=$2`, [c.req.param("docId"), firm.id]);
  if (!doc) return c.json({ error: "Document not found" }, 404);
  const signedPath = `doc-${doc.id}-${Date.now()}.pdf`;
  return c.json({ signedUrl: `/api/documents/${doc.id}/signed/${signedPath}`, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
});
