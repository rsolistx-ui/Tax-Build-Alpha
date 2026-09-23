import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { listVersions, createVersion, listSignatureRequests, createSignatureRequest } from "../services/doc-versioning";
import { newId } from "../lib/id";
import { getValidDocuSignConfig, createDocuSignEnvelope, voidDocuSignEnvelope } from "../services/docu-sign";
import { signDocumentToken } from "../lib/signed-url";
import { NativeEsignService } from "../services/native-esign";
import { IRS_EFILE_SIGNATURE_PROVIDER_MESSAGE, isIrsEfileAuthorization } from "../services/tax-signature-policy";
import { issueSigningAccessLink } from "../services/signature-access";

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
docVersioningRoutes.get("/:clientId/signature-vault", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);

  const rows = await db.query<any>(
    `SELECT 
       sr.id as request_id,
       sr.document_id,
       sr.engagement_id,
       sr.form_type,
       sr.status,
       sr.signed_at,
       sr.created_at,
       sr.recipients,
       cd.filename,
       cd.document_type,
       e.title as engagement_title,
       ae.metadata as audit_metadata
     FROM signature_requests sr
     LEFT JOIN client_documents cd ON cd.id = sr.document_id
     LEFT JOIN engagements e ON e.id = sr.engagement_id
     LEFT JOIN (
       SELECT DISTINCT ON (metadata->>'requestId') metadata, created_at
       FROM audit_events
       WHERE event IN ('native_document_signed', 'signature_request_signed')
       ORDER BY metadata->>'requestId', created_at DESC
     ) ae ON ae.metadata->>'requestId' = sr.id
     WHERE sr.firm_id = $1 AND sr.client_id = $2
     ORDER BY sr.created_at DESC`,
    [firm.id, client.id]
  );

  const records = rows.map((r: any) => {
    const meta = r.audit_metadata || {};
    const recipients = Array.isArray(r.recipients) ? r.recipients : [];
    const signer = recipients[0] || {};
    return {
      requestId: r.request_id,
      documentId: r.document_id,
      engagementId: r.engagement_id,
      formType: r.form_type || "document",
      status: r.status,
      signedAt: r.signed_at || meta.signedAt || null,
      createdAt: r.created_at,
      filename: r.filename || `${r.form_type || "Document"}.pdf`,
      documentType: r.document_type || r.form_type,
      engagementTitle: r.engagement_title,
      signerName: meta.signerName || signer.name || "Client Signer",
      signerEmail: meta.signerEmail || signer.email || null,
      certificateId: meta.certificateId || null,
      documentHash: meta.finalHash || null,
      originalHash: meta.originalHash || null,
      ipAddress: meta.ipAddress || null,
      sourceUrl: r.document_id ? `/api/clients/${client.id}/documents/${r.document_id}/source` : null,
      tamperEvidentStatus: r.status === "signed" ? "Signed, SHA-256 recorded" : "Pending Signature",
      complianceNotice: isIrsEfileAuthorization(r.form_type)
        ? "IRS e-file authorizations are signed in the IRS e-file signatures panel."
        : "Ordinary-document signature record with certificate and integrity evidence.",
    };
  });

  return c.json({ records });
});
docVersioningRoutes.post("/:clientId/signature-requests", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const body = z.object({
    engagementId: z.string().optional(),
    documentId: z.string().optional(),
    formType: z.string().default("document"),
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
  if (isIrsEfileAuthorization(req.form_type)) {
    return c.json({ error: IRS_EFILE_SIGNATURE_PROVIDER_MESSAGE, code: "IRS_EFILE_PROVIDER_REQUIRED" }, 409);
  }

  let sentVia: "docusign" = "docusign";
  let config: Awaited<ReturnType<typeof getValidDocuSignConfig>> = null;
  try {
    config = await getValidDocuSignConfig(db, firm.id);
  } catch (error) {
    return c.json({ error: "DocuSign is configured but its access token could not be refreshed", details: error instanceof Error ? error.message : String(error) }, 502);
  }

  if (!config) {
    return c.json({
      error: "External signature delivery is not configured for this firm. No request was sent; use Folio's in-house signing for an ordinary document or connect an approved provider.",
    }, 409);
  }

  {
    const recipients = (req.recipients ?? []) as Array<{ email?: string; name?: string; roleName?: string; recipientId?: string }>;
    if (!recipients.length) return c.json({ error: "Signature request has no recipients" }, 400);
    if (recipients.some((r) => !r.email || !r.name)) return c.json({ error: "Every recipient needs an email and name to send for signature" }, 400);

    let documentBase64: string | undefined;
    let fileExtension = "pdf";
    if (req.document_id) {
      const [version] = await db.query<any>(`SELECT r2_key FROM document_versions WHERE document_id=$1 ORDER BY version DESC LIMIT 1`, [req.document_id]);
      if (version?.r2_key) {
        const object = await c.env.RECEIPTS.get(version.r2_key);
        if (object) {
          documentBase64 = Buffer.from(await object.arrayBuffer()).toString("base64");
          fileExtension = version.r2_key.split(".").pop() || "pdf";
        }
      }
    }
    if (!documentBase64) return c.json({ error: "No document content available to sign" }, 400);

    const tabsByRecipient = new Map<string, { signHereTabs: any[]; fullNameTabs: any[]; dateSignedTabs: any[] }>();
    for (const tab of (req.tabs ?? []) as any[]) {
      const key = tab.recipientId ?? "";
      const bucket = tabsByRecipient.get(key) ?? { signHereTabs: [], fullNameTabs: [], dateSignedTabs: [] };
      const entry = { pageNumber: Number(tab.pageNumber ?? 1), xPosition: Number(tab.xPosition ?? 0), yPosition: Number(tab.yPosition ?? 0) };
      if (tab.type === "signHere") bucket.signHereTabs.push(entry);
      else if (tab.type === "dateSigned") bucket.dateSignedTabs.push(entry);
      tabsByRecipient.set(key, bucket);
    }

    try {
      const envelope = await createDocuSignEnvelope(config, config.accessToken, {
        documents: [{ documentId: "1", name: req.form_type ?? "Document", documentBase64, fileExtension }],
        signers: recipients.map((r, i) => ({
          email: r.email!,
          name: r.name!,
          roleName: r.roleName ?? "Signer",
          clientUserId: r.recipientId ?? String(i + 1),
          tabs: tabsByRecipient.get(r.recipientId ?? ""),
        })),
        subject: `Please sign: ${req.form_type ?? "8879"}`,
        emailBlurb: `Please review and sign the attached ${req.form_type ?? "document"}.`,
      });
      await db.query(
        `INSERT INTO docu_sign_envelopes (id, firm_id, client_id, envelope_id, status, document_type, signature_request_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
        [newId("dse"), firm.id, client.id, envelope.envelopeId, envelope.status, req.form_type ?? null, req.id],
      );
      sentVia = "docusign";
    } catch (error) {
      return c.json({ error: "DocuSign send failed", details: error instanceof Error ? error.message : String(error) }, 502);
    }
  }

  await db.query(`UPDATE signature_requests SET status='sent', sent_at=NOW() WHERE id=$1`, [req.id]);
  await db.query(`INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW())`,
    [crypto.randomUUID(), firm.id, client.id, "signature_request_sent", c.get("userId"), JSON.stringify({ requestId: req.id, formType: req.form_type, sentVia })]);
  return c.json({ requestId: req.id, status: "sent", sentVia });
});
docVersioningRoutes.post("/:clientId/signature-requests/:requestId/void", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const [req] = await db.query<any>(`SELECT * FROM signature_requests WHERE id=$1 AND firm_id=$2 AND client_id=$3`, [c.req.param("requestId"), firm.id, client.id]);
  if (!req) return c.json({ error: "Signature request not found" }, 404);
  if (req.status === "signed" || req.status === "voided") return c.json({ error: `Already ${req.status}` }, 400);
  const body = z.object({ reason: z.string().default("Voided by firm") }).parse(await c.req.json().catch(() => ({})));

  const [envelopeRow] = await db.query<any>(`SELECT envelope_id FROM docu_sign_envelopes WHERE signature_request_id=$1`, [req.id]);
  if (envelopeRow) {
    try {
      const config = await getValidDocuSignConfig(db, firm.id);
      if (config) await voidDocuSignEnvelope(config, config.accessToken, envelopeRow.envelope_id, body.reason);
    } catch (error) {
      return c.json({ error: "DocuSign void failed", details: error instanceof Error ? error.message : String(error) }, 502);
    }
    await db.query(`UPDATE docu_sign_envelopes SET status='voided' WHERE signature_request_id=$1`, [req.id]);
  }

  await db.query(`UPDATE signature_requests SET status='voided', voided_at=NOW(), void_reason=$1 WHERE id=$2`, [body.reason, req.id]);
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
  return c.json({
    error: "A signature request cannot be completed from an authenticated staff session. Completion must come from a verified provider callback or the native ordinary-document signing flow.",
    code: "SIGNATURE_COMPLETION_REQUIRES_VERIFIED_EVIDENCE",
  }, 409);
});
docVersioningRoutes.post("/:clientId/signature-requests/:requestId/sign-native", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const [req] = await db.query<any>(
    `SELECT * FROM signature_requests WHERE id=$1 AND firm_id=$2 AND client_id=$3`,
    [c.req.param("requestId"), firm.id, client.id]
  );
  if (!req) return c.json({ error: "Signature request not found" }, 404);
  if (req.status === "signed") return c.json({ error: "Document is already signed" }, 400);
  if (isIrsEfileAuthorization(req.form_type)) {
    return c.json({
      error: IRS_EFILE_SIGNATURE_PROVIDER_MESSAGE,
    }, 409);
  }

  const body = z.object({
    signatureType: z.enum(["drawn", "typed"]),
    signatureData: z.string().min(1),
    signerName: z.string().min(1),
    signerEmail: z.string().email(),
    consentAgreed: z.boolean(),
  }).parse(await c.req.json());

  if (!body.consentAgreed) {
    return c.json({ error: "Signer must agree to ESIGN consent under 15 U.S.C. § 7001" }, 400);
  }
  const recipientEmails = Array.isArray(req.recipients)
    ? req.recipients.map((recipient: { email?: string }) => recipient.email?.trim().toLowerCase()).filter(Boolean)
    : [];
  if (recipientEmails.length > 0 && !recipientEmails.includes(body.signerEmail.trim().toLowerCase())) {
    return c.json({ error: "The signer email must match a recipient on this signature request." }, 403);
  }
  const sessionEmail = (c.get("userEmail") || "").trim().toLowerCase();
  if (!sessionEmail || body.signerEmail.trim().toLowerCase() !== sessionEmail) {
    return c.json({ error: "Staff cannot sign for a client. Create the recipient's secure signing link instead." }, 403);
  }

  let pdfBytes: Uint8Array | null = null;
  if (req.document_id) {
    const [version] = await db.query<any>(
      `SELECT r2_key FROM document_versions WHERE document_id=$1 ORDER BY version DESC LIMIT 1`,
      [req.document_id]
    );
    const key = version?.r2_key;
    if (key && c.env.RECEIPTS) {
      const obj = await c.env.RECEIPTS.get(key);
      if (obj) pdfBytes = new Uint8Array(await obj.arrayBuffer());
    }
    if (!pdfBytes) {
      const [doc] = await db.query<any>(
        `SELECT r2_key FROM client_documents WHERE id=$1`,
        [req.document_id]
      );
      if (doc?.r2_key && c.env.RECEIPTS) {
        const obj = await c.env.RECEIPTS.get(doc.r2_key);
        if (obj) pdfBytes = new Uint8Array(await obj.arrayBuffer());
      }
    }
  }

  if (!pdfBytes) {
    return c.json({ error: "Document file not found in storage to sign" }, 404);
  }

  const ipAddress = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "127.0.0.1";
  const userAgent = c.req.header("user-agent") || "Folio Practice OS Client";

  const nativeService = new NativeEsignService(db, c.env);
  const result = await nativeService.stampAndCertifyDocument(
    firm.id,
    client.id,
    req.id,
    req.document_id,
    pdfBytes,
    {
      signatureType: body.signatureType,
      signatureData: body.signatureData,
      signerName: body.signerName,
      signerEmail: body.signerEmail,
      consentAgreed: body.consentAgreed,
      ipAddress,
      userAgent,
    },
    req.tabs as any
  );

  return c.json({
    ok: true,
    certificateId: result.certificateId,
    documentHash: result.documentHash,
    signedR2Key: result.signedR2Key,
    status: "signed",
  });
});
docVersioningRoutes.post("/:clientId/signature-requests/:requestId/native-link", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const [req] = await db.query<any>(`SELECT * FROM signature_requests WHERE id=$1 AND firm_id=$2 AND client_id=$3`, [c.req.param("requestId"), firm.id, client.id]);
  if (!req) return c.json({ error: "Signature request not found" }, 404);
  if (req.status === "signed" || req.status === "voided") return c.json({ error: `Request is ${req.status}` }, 409);
  if (isIrsEfileAuthorization(req.form_type)) return c.json({ error: IRS_EFILE_SIGNATURE_PROVIDER_MESSAGE, code: "IRS_EFILE_PROVIDER_REQUIRED" }, 409);
  const recipients = Array.isArray(req.recipients) ? req.recipients : [];
  const recipient = recipients.find((item: any) => item?.email && item?.name) as { email: string; name?: string } | undefined;
  if (!recipient) return c.json({ error: "Add the client's name and email before creating a secure signing link." }, 400);
  const link = await issueSigningAccessLink(db, { firmId: firm.id, clientId: client.id, requestId: req.id, recipientEmail: recipient.email, recipientName: recipient.name, issuedByUserId: c.get("userId") });
  await db.query(`UPDATE signature_requests SET status='sent', sent_at=COALESCE(sent_at,NOW()) WHERE id=$1`, [req.id]);
  const origin = c.env.APP_ORIGIN || new URL(c.req.url).origin;
  return c.json({ signingUrl: `${origin}/sign#token=${encodeURIComponent(link.token)}`, expiresAt: link.expiresAt, recipient: { name: recipient.name || null, email: recipient.email } }, 201);
});
docVersioningRoutes.post("/:clientId/docusign/webhook", (c) =>
  c.json({ error: "This legacy webhook route is disabled. Configure the verified provider endpoint instead." }, 410),
);
docVersioningRoutes.get("/:clientId/documents/:docId/signed-url", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const docId = c.req.param("docId");
  const [doc] = await db.query<any>(`SELECT id, r2_key FROM client_documents WHERE id=$1 AND client_id=$2`, [docId, client.id]);
  if (!doc) return c.json({ error: "Document not found" }, 404);
  const [version] = await db.query<any>(`SELECT r2_key FROM document_versions WHERE document_id=$1 ORDER BY version DESC LIMIT 1`, [docId]);
  if (!(version?.r2_key ?? doc.r2_key)) return c.json({ error: "No document content available" }, 404);
  const expiresAt = Date.now() + 3600_000;
  const token = await signDocumentToken(c.env.BETTER_AUTH_SECRET, docId, expiresAt);
  return c.json({ signedUrl: `/api/signed-documents/${docId}/${token}`, expiresAt: new Date(expiresAt).toISOString() });
});
