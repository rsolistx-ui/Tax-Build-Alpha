import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { newId } from "../lib/id";
import {
  getDocuSignAccessToken,
  createDocuSignEnvelope,
  getDocuSignEnvelopeStatus,
  getDocuSignEnvelopeDocuments,
  getDocuSignTemplates,
} from "../services/docu-sign";
import { approveDraftRequest } from "../services/client-requests";

export const docuSignRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
docuSignRoutes.use("*", requireSession);
docuSignRoutes.use("*", requireActiveBeta);

const docuSignConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  integratorKey: z.string().min(1),
  userId: z.string().min(1),
  baseUrl: z.string().url(),
  accountId: z.string().min(1),
});

docuSignRoutes.post("/config", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  
  const config = docuSignConfigSchema.parse(await c.req.json());
  
  await db.query(
    `INSERT INTO docu_sign_config (firm_id, client_id, client_secret, integrator_key, user_id, base_url, account_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (firm_id) DO UPDATE SET
       client_id = EXCLUDED.client_id,
       client_secret = EXCLUDED.client_secret,
       integrator_key = EXCLUDED.integrator_key,
       user_id = EXCLUDED.user_id,
       base_url = EXCLUDED.base_url,
       account_id = EXCLUDED.account_id,
       updated_at = NOW()`,
    [firm.id, config.clientId, config.clientSecret, config.integratorKey, config.userId, config.baseUrl, config.accountId],
  );

  return c.json({ success: true });
});

docuSignRoutes.get("/config", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  
  const [config] = await db.query<{ client_id: string; integrator_key: string; user_id: string; base_url: string; account_id: string }>(
    `SELECT client_id, integrator_key, user_id, base_url, account_id FROM docu_sign_config WHERE firm_id = $1`,
    [firm.id],
  );

  if (!config) {
    return c.json({ error: "DocuSign not configured" }, 404);
  }

  return c.json({
    clientId: config.client_id,
    integratorKey: config.integrator_key,
    userId: config.user_id,
    baseUrl: config.base_url,
    accountId: config.account_id,
  });
});

docuSignRoutes.post("/auth/token", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  
  const [config] = await db.query<{ client_id: string; client_secret: string; integrator_key: string; user_id: string; base_url: string; account_id: string; access_token?: string }>(
    `SELECT client_id, client_secret, integrator_key, user_id, base_url, account_id, access_token FROM docu_sign_config WHERE firm_id = $1`,
    [firm.id],
  );

  if (!config) {
    return c.json({ error: "DocuSign not configured" }, 404);
  }

  try {
    const { accessToken, expiresIn } = await getDocuSignAccessToken({
      clientId: config.client_id,
      clientSecret: config.client_secret,
      integratorKey: config.integrator_key,
      userId: config.user_id,
      baseUrl: config.base_url,
      accountId: config.account_id,
    });

    await db.query(
      `UPDATE docu_sign_config SET access_token = $1, access_token_expires_at = NOW() + INTERVAL '${expiresIn} seconds' WHERE firm_id = $2`,
      [accessToken, firm.id],
    );

    return c.json({ accessToken, expiresIn });
  } catch (error) {
    return c.json({ error: "DocuSign authentication failed", details: error instanceof Error ? error.message : String(error) }, 500);
  }
});

const createEnvelopeSchema = z.object({
  clientId: z.string().min(1),
  requestIds: z.array(z.string().min(1)),
  templateId: z.string().optional(),
  documents: z.array(z.object({
    documentId: z.string().min(1),
    name: z.string().min(1),
    documentBase64: z.string().min(1),
    fileExtension: z.string().min(1),
  })).min(1),
  signers: z.array(z.object({
    email: z.string().email(),
    name: z.string().min(1),
    roleName: z.string().min(1),
    clientUserId: z.string().optional(),
    tabs: z.object({
      signHereTabs: z.array(z.object({
        pageNumber: z.number().int().min(1),
        xPosition: z.number().int().min(0),
        yPosition: z.number().int().min(0),
      })).optional(),
      fullNameTabs: z.array(z.object({
        pageNumber: z.number().int().min(1),
        xPosition: z.number().int().min(0),
        yPosition: z.number().int().min(0),
      })).optional(),
      dateSignedTabs: z.array(z.object({
        pageNumber: z.number().int().min(1),
        xPosition: z.number().int().min(0),
        yPosition: z.number().int().min(0),
      })).optional(),
    }).optional(),
  })).min(1),
  subject: z.string().min(1).max(100),
  emailBlurb: z.string().min(1).max(1000),
});

docuSignRoutes.post("/envelopes", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  
  const [config] = await db.query<{ client_id: string; client_secret: string; integrator_key: string; user_id: string; base_url: string; account_id: string; access_token: string }>(
    `SELECT client_id, client_secret, integrator_key, user_id, base_url, account_id, access_token FROM docu_sign_config WHERE firm_id = $1`,
    [firm.id],
  );

  if (!config) {
    return c.json({ error: "DocuSign not configured" }, 404);
  }

  const requestBody = createEnvelopeSchema.parse(await c.req.json());
  
  const envelope = await createDocuSignEnvelope({
    clientId: config.client_id,
    clientSecret: config.client_secret,
    integratorKey: config.integrator_key,
    userId: config.user_id,
    baseUrl: config.base_url,
    accountId: config.account_id,
  }, config.access_token, {
    templateId: requestBody.templateId,
    documents: requestBody.documents,
    signers: requestBody.signers,
    subject: requestBody.subject,
    emailBlurb: requestBody.emailBlurb,
  });

  await db.query(
    `INSERT INTO docu_sign_envelopes (id, firm_id, client_id, envelope_id, status, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [newId("dse"), firm.id, requestBody.clientId, envelope.envelopeId, envelope.status],
  );

  return c.json({ envelopeId: envelope.envelopeId, status: envelope.status }, 201);
});

docuSignRoutes.get("/envelopes/:envelopeId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  
  const [config] = await db.query<{ client_id: string; client_secret: string; integrator_key: string; user_id: string; base_url: string; account_id: string; access_token: string }>(
    `SELECT client_id, client_secret, integrator_key, user_id, base_url, account_id, access_token FROM docu_sign_config WHERE firm_id = $1`,
    [firm.id],
  );

  if (!config) {
    return c.json({ error: "DocuSign not configured" }, 404);
  }

  const envelopeId = c.req.param("envelopeId");
  const envelope = await getDocuSignEnvelopeStatus({
    clientId: config.client_id,
    clientSecret: config.client_secret,
    integratorKey: config.integrator_key,
    userId: config.user_id,
    baseUrl: config.base_url,
    accountId: config.account_id,
  }, config.access_token, envelopeId);

  return c.json(envelope);
});

docuSignRoutes.get("/envelopes/:envelopeId/documents", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  
  const [config] = await db.query<{ client_id: string; client_secret: string; integrator_key: string; user_id: string; base_url: string; account_id: string; access_token: string }>(
    `SELECT client_id, client_secret, integrator_key, user_id, base_url, account_id, access_token FROM docu_sign_config WHERE firm_id = $1`,
    [firm.id],
  );

  if (!config) {
    return c.json({ error: "DocuSign not configured" }, 404);
  }

  const envelopeId = c.req.param("envelopeId");
  const documents = await getDocuSignEnvelopeDocuments({
    clientId: config.client_id,
    clientSecret: config.client_secret,
    integratorKey: config.integrator_key,
    userId: config.user_id,
    baseUrl: config.base_url,
    accountId: config.account_id,
  }, config.access_token, envelopeId);

  return c.json({ documents });
});

docuSignRoutes.get("/templates", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  
  const [config] = await db.query<{ client_id: string; client_secret: string; integrator_key: string; user_id: string; base_url: string; account_id: string; access_token: string }>(
    `SELECT client_id, client_secret, integrator_key, user_id, base_url, account_id, access_token FROM docu_sign_config WHERE firm_id = $1`,
    [firm.id],
  );

  if (!config) {
    return c.json({ error: "DocuSign not configured" }, 404);
  }

  const templates = await getDocuSignTemplates({
    clientId: config.client_id,
    clientSecret: config.client_secret,
    integratorKey: config.integrator_key,
    userId: config.user_id,
    baseUrl: config.base_url,
    accountId: config.account_id,
  }, config.access_token);

  return c.json({ templates });
});

const generate8879Schema = z.object({
  clientId: z.string().min(1),
  clientEmail: z.string().email(),
  clientName: z.string().min(1),
  taxYear: z.number().int().min(2020).max(2030),
  preparationMethod: z.enum(["electronic", "paper"]),
});

docuSignRoutes.post("/8879", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  if (!clientId) return c.json({ error: "Client ID required" }, 400);
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const body = generate8879Schema.parse(await c.req.json());

  const [config] = await db.query<{ client_id: string; client_secret: string; integrator_key: string; user_id: string; base_url: string; account_id: string; access_token: string }>(
    `SELECT client_id, client_secret, integrator_key, user_id, base_url, account_id, access_token FROM docu_sign_config WHERE firm_id = $1`,
    [firm.id],
  );

  if (!config) {
    return c.json({ error: "DocuSign not configured" }, 404);
  }

  const professionalName = c.get("userName") || "Tax Professional";
  const professionalEmail = c.get("userEmail");

  const envelope = await createDocuSignEnvelope({
    clientId: config.client_id,
    clientSecret: config.client_secret,
    integratorKey: config.integrator_key,
    userId: config.user_id,
    baseUrl: config.base_url,
    accountId: config.account_id,
  }, config.access_token, {
    documents: [],
    signers: [{
      email: body.clientEmail,
      name: body.clientName,
      roleName: "Taxpayer",
      tabs: {
        signHereTabs: [{ pageNumber: 1, xPosition: 100, yPosition: 500 }],
        fullNameTabs: [{ pageNumber: 1, xPosition: 100, yPosition: 450 }],
        dateSignedTabs: [{ pageNumber: 1, xPosition: 100, yPosition: 420 }],
      },
    }],
    subject: `IRS Form 8879 - E-Sign Authorization for ${body.taxYear} Tax Return`,
    emailBlurb: `Please review and sign the IRS Form 8879 to authorize electronic filing of your ${body.taxYear} tax return.`,
  });

  await db.query(
    `INSERT INTO docu_sign_envelopes (id, firm_id, client_id, envelope_id, status, document_type, created_at)
     VALUES ($1, $2, $3, $4, $5, '8879', NOW())`,
    [newId("dse"), firm.id, client.id, envelope.envelopeId, envelope.status],
  );

  return c.json({ envelopeId: envelope.envelopeId, status: envelope.status }, 201);
});

docuSignRoutes.post("/8879/request", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  if (!clientId) return c.json({ error: "Client ID required" }, 400);
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const body = generate8879Schema.parse(await c.req.json());

  const requestId = newId("creq");
  const workItemId = newId("wi");

  const [config] = await db.query<{ client_id: string; client_secret: string; integrator_key: string; user_id: string; base_url: string; account_id: string; access_token: string }>(
    `SELECT client_id, client_secret, integrator_key, user_id, base_url, account_id, access_token FROM docu_sign_config WHERE firm_id = $1`,
    [firm.id],
  );

  if (!config) {
    return c.json({ error: "DocuSign not configured" }, 404);
  }

  const professionalName = c.get("userName") || "Tax Professional";

  await db.transaction([
    {
      query: `INSERT INTO client_requests
        (id, firm_id, client_id, work_item_id, request_type, title, description, status,
         source_type, source_id, due_at, created_by_user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', 'docu_sign_8879', NULL, NULL, $8)`,
      params: [requestId, firm.id, client.id, workItemId, "signature_placeholder", 
        `Sign IRS Form 8879 for ${body.taxYear}`, 
        `Please sign the IRS Form 8879 to authorize electronic filing of your ${body.taxYear} tax return.`, 
        c.get("userId")],
    },
    {
      query: `INSERT INTO work_items
        (id, firm_id, client_id, engagement_id, title, work_type, status, priority, source_type, source_id, client_visible, due_at)
      VALUES ($1, $2, $3, NULL, $4, $5, $6, 'normal', $7, $8, $9, NULL)`,
      params: [workItemId, firm.id, client.id, 
        `Sign IRS Form 8879 for ${body.taxYear}`, "client_request", "open", 
        "client_request", requestId, true],
    },
    {
      query: `INSERT INTO audit_events (id, firm_id, client_id, actor_user_id, action, entity_type, entity_id, created_at)
      SELECT $1, firm_id, $2, $3, $4, 'client_request', $5, NOW() FROM clients WHERE id=$2`,
      params: [newId("aud"), client.id, c.get("userId"), "8879_request_created", requestId],
    },
  ]);

  return c.json({ requestId, workItemId }, 201);
});

const oauthConfigSchema = z.object({
  redirectUri: z.string().url(),
});

docuSignRoutes.post("/oauth/url", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = oauthConfigSchema.parse(await c.req.json());
  const baseUrl = c.env.DOCUSIGN_BASE_URL;
  const clientId = c.env.DOCUSIGN_CLIENT_ID;
  if (!baseUrl || !clientId) return c.json({ error: "DocuSign not configured (env)" }, 404);
  const state = newId("dsos");
  await db.query(
    `INSERT INTO docu_sign_oauth_state (id, firm_id, redirect_uri, created_at) VALUES ($1, $2, $3, NOW())`,
    [state, firm.id, body.redirectUri],
  );
  const params = new URLSearchParams({ response_type: "code", scope: "signature impersonation", client_id: clientId, redirect_uri: body.redirectUri, state });
  return c.json({ authUrl: `${baseUrl.replace(/\/$/, "")}/oauth/auth?${params.toString()}`, state });
});

docuSignRoutes.post("/oauth/exchange", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const { code, state } = await c.req.json<{ code: string; state: string }>();
  const [stateRow] = await db.query<{ firm_id: string; redirect_uri: string }>(
    `SELECT firm_id, redirect_uri FROM docu_sign_oauth_state WHERE id = $1`, [state],
  );
  if (!stateRow || stateRow.firm_id !== firm.id) return c.json({ error: "Invalid state" }, 400);
  const baseUrl = c.env.DOCUSIGN_BASE_URL;
  const clientId = c.env.DOCUSIGN_CLIENT_ID;
  const clientSecret = c.env.DOCUSIGN_CLIENT_SECRET;
  const accountId = c.env.DOCUSIGN_ACCOUNT_ID;
  if (!baseUrl || !clientId || !clientSecret) return c.json({ error: "DocuSign not configured (env)" }, 404);
  try {
    const basic = typeof Buffer !== "undefined"
      ? Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
      : btoa(`${clientId}:${clientSecret}`);
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: stateRow.redirect_uri }),
    });
    if (!response.ok) throw new Error(`DocuSign token exchange failed: ${response.status} ${await response.text()}`);
    const data = await response.json() as { access_token: string; refresh_token: string; expires_in: number; token_type: string; scope: string };
    await db.query(
      `INSERT INTO docu_sign_config (firm_id, client_id, client_secret, integrator_key, user_id, base_url, account_id, access_token, refresh_token, access_token_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW() + ($10 || ' seconds')::interval)
       ON CONFLICT (firm_id) DO UPDATE SET access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token, access_token_expires_at=EXCLUDED.access_token_expires_at, updated_at=NOW()`,
      [firm.id, clientId, clientSecret, clientId, c.get("userId"), baseUrl, accountId ?? "", data.access_token, data.refresh_token, String(data.expires_in)],
    );
    await db.query(`DELETE FROM docu_sign_oauth_state WHERE id = $1`, [state]);
    return c.json({ accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in, tokenType: data.token_type, scope: data.scope });
  } catch (error) {
    return c.json({ error: "Token exchange failed", details: error instanceof Error ? error.message : String(error) }, 500);
  }
});
