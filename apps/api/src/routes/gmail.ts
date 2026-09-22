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
  createGmailDraft,
  sendGmailMessage,
  listGmailMessages,
  getGmailMessage,
  listGmailLabels,
  searchGmailMessages,
  createGmailDraftBody,
} from "../services/gmail";
import { resolveGmailAccessToken } from "../services/gmail-oauth";
import { getClientRequest, approveDraftRequest } from "../services/client-requests";
import { addRequestMessage } from "../services/request-messages";
import { gmailTriageAgentTaskStatement } from "../services/agent-supervisor";

export const gmailRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
gmailRoutes.use("*", requireSession);
gmailRoutes.use("*", requireActiveBeta);

gmailRoutes.post("/config", async (c) =>
  c.json({ error: "Manual Gmail credential entry is disabled. Use the secure Google connection flow." }, 410),
);

gmailRoutes.get("/config", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  
  const [config] = await db.query<any>(
    `SELECT refresh_token_ciphertext, connected_at, granted_scope FROM gmail_config WHERE firm_id = $1`,
    [firm.id],
  );

  if (!config) {
    return c.json({ error: "Gmail not configured" }, 404);
  }

  return c.json({ connected: Boolean(config.refresh_token_ciphertext), connectedAt: config.connected_at, scope: config.granted_scope });
});

async function connectedAccessToken(env: Env, config: { refresh_token_ciphertext?: string | null; refresh_token_iv?: string | null }): Promise<string> {
  return resolveGmailAccessToken({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    encryptionKey: env.GMAIL_TOKEN_ENCRYPTION_KEY,
    refreshTokenCiphertext: config.refresh_token_ciphertext,
    refreshTokenIv: config.refresh_token_iv,
  });
}

gmailRoutes.post("/auth/token", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  
  const [config] = await db.query<any>(
    `SELECT * FROM gmail_config WHERE firm_id = $1`,
    [firm.id],
  );

  if (!config) {
    return c.json({ error: "Gmail not configured" }, 404);
  }

  try {
    await connectedAccessToken(c.env, config);
    return c.json({ connected: true });
  } catch {
    return c.json({ error: "Gmail authentication failed. Reconnect the firm Gmail account." }, 502);
  }
});

gmailRoutes.get("/labels", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  
  const [config] = await db.query<any>(
    `SELECT * FROM gmail_config WHERE firm_id = $1`,
    [firm.id],
  );

  if (!config) {
    return c.json({ error: "Gmail not configured" }, 404);
  }

  const labels = await listGmailLabels(await connectedAccessToken(c.env, config));
  return c.json({ labels });
});

gmailRoutes.get("/messages", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  
  const [config] = await db.query<any>(
    `SELECT * FROM gmail_config WHERE firm_id = $1`,
    [firm.id],
  );

  if (!config) {
    return c.json({ error: "Gmail not configured" }, 404);
  }

  const query = c.req.query("q");
  const maxResults = parseInt(c.req.query("maxResults") || "50", 10);

  const result = await listGmailMessages(await connectedAccessToken(c.env, config), query, maxResults);
  return c.json(result);
});

gmailRoutes.get("/messages/:messageId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  
  const [config] = await db.query<any>(
    `SELECT * FROM gmail_config WHERE firm_id = $1`,
    [firm.id],
  );

  if (!config) {
    return c.json({ error: "Gmail not configured" }, 404);
  }

  const messageId = c.req.param("messageId");
  const format = (c.req.query("format") as "full" | "metadata" | "minimal" | "raw") || "full";

  const message = await getGmailMessage(await connectedAccessToken(c.env, config), messageId, format);
  return c.json(message);
});

gmailRoutes.post("/search", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  
  const [config] = await db.query<any>(
    `SELECT * FROM gmail_config WHERE firm_id = $1`,
    [firm.id],
  );

  if (!config) {
    return c.json({ error: "Gmail not configured" }, 404);
  }

  const body = z.object({ query: z.string().min(1) }).parse(await c.req.json());

  const messages = await searchGmailMessages(await connectedAccessToken(c.env, config), body.query);
  return c.json({ messages });
});

gmailRoutes.post("/drafts", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  
  const [config] = await db.query<any>(
    `SELECT * FROM gmail_config WHERE firm_id = $1`,
    [firm.id],
  );

  if (!config) {
    return c.json({ error: "Gmail not configured" }, 404);
  }

  const body = z.object({
    to: z.string().email(),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(50000),
    inReplyTo: z.string().optional(),
    references: z.string().optional(),
  }).parse(await c.req.json());

  const draft = await createGmailDraft(await connectedAccessToken(c.env, config), {
    to: body.to,
    subject: body.subject,
    body: body.body,
    inReplyTo: body.inReplyTo,
    references: body.references,
  });

  return c.json(draft, 201);
});

const autoDraftSchema = z.object({
  clientId: z.string().min(1),
  requestIds: z.array(z.string().min(1)),
});

gmailRoutes.post("/auto-draft", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  if (!clientId) return c.json({ error: "Client ID required" }, 400);
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const body = autoDraftSchema.parse(await c.req.json());

  const [config] = await db.query<any>(
    `SELECT * FROM gmail_config WHERE firm_id = $1`,
    [firm.id],
  );

  if (!config) {
    return c.json({ error: "Gmail not configured" }, 404);
  }

  const professionalName = c.get("userName") || "Tax Professional";
  if (!client.email) return c.json({ error: "This client needs an email address before a draft can be created." }, 409);

  const requests = await Promise.all(
    body.requestIds.map((id) => 
      db.query<any>(`SELECT * FROM client_requests WHERE id = $1 AND firm_id = $2`, [id, firm.id])
        .then(([r]) => r)
    )
  );

  const uniqueClients = new Set(requests.map((r) => r.client_id));
  if (uniqueClients.size > 1) {
    return c.json({ error: "Can only auto-draft for requests from the same client" }, 400);
  }

  const requestTitles = requests.map((r) => r.title).join(", ");
  const clientName = client.name;

  const draftBody = createGmailDraftBody(clientName, requestTitles, undefined, `Best regards,\n${professionalName}`);

  try {
    const draft = await createGmailDraft(await connectedAccessToken(c.env, config), {
      to: client.email,
      subject: `${requestTitles}`,
      body: draftBody,
    });

    return c.json({ draftId: draft.id, message: `Draft created with ${requests.length} requests` });
  } catch {
    return c.json({ error: "Failed to create draft. Reconnect Gmail and try again." }, 502);
  }
});

gmailRoutes.post("/auto-draft/send", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  if (!clientId) return c.json({ error: "Client ID required" }, 400);
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const body = autoDraftSchema.parse(await c.req.json());

  const [config] = await db.query<any>(
    `SELECT * FROM gmail_config WHERE firm_id = $1`,
    [firm.id],
  );

  if (!config) {
    return c.json({ error: "Gmail not configured" }, 404);
  }

  const professionalName = c.get("userName") || "Tax Professional";
  if (!client.email) return c.json({ error: "This client needs an email address before a message can be sent." }, 409);

  const requests = await Promise.all(
    body.requestIds.map((id) => 
      db.query<any>(`SELECT * FROM client_requests WHERE id = $1 AND firm_id = $2`, [id, firm.id])
        .then(([r]) => r)
    )
  );

  const uniqueClients = new Set(requests.map((r) => r.client_id));
  if (uniqueClients.size > 1) {
    return c.json({ error: "Can only auto-send for requests from the same client" }, 400);
  }

  const requestTitles = requests.map((r) => r.title).join(", ");
  const clientName = client.name;

  const messageBody = createGmailDraftBody(clientName, requestTitles, undefined, `Best regards,\n${professionalName}`);

  try {
    const sent = await sendGmailMessage(await connectedAccessToken(c.env, config), {
      to: client.email,
      subject: `${requestTitles}`,
      body: messageBody,
    });

    return c.json({ messageId: sent.id, message: `Message sent with ${requests.length} requests` });
  } catch {
    return c.json({ error: "Failed to send message. Reconnect Gmail and try again." }, 502);
  }
});

gmailRoutes.post("/thread/:threadId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  
  const [config] = await db.query<{ refresh_token_ciphertext: string | null; refresh_token_iv: string | null }>(
    `SELECT refresh_token_ciphertext, refresh_token_iv FROM gmail_config WHERE firm_id = $1`,
    [firm.id],
  );

  if (!config) {
    return c.json({ error: "Gmail not configured" }, 404);
  }

  const threadId = c.req.param("threadId");
  if (!threadId) return c.json({ error: "Thread ID required" }, 400);
  
  const accessToken = await connectedAccessToken(c.env, config);
  const messages = await listGmailMessages(accessToken, `thread_id:${threadId}`);
  
  const fullMessages = await Promise.all(
    messages.messages.map((msg) => getGmailMessage(accessToken, msg.id, "full"))
  );

  const clientName = "Client";
  const threadBody = fullMessages.map((msg) => {
    const from = msg.payload.headers.find((h) => h.name.toLowerCase() === "from")?.value || "Unknown";
    const date = msg.payload.headers.find((h) => h.name.toLowerCase() === "date")?.value || "Unknown date";
    return `From: ${from}\nDate: ${date}\n\n[Message content not shown for brevity]`;
  }).join("\n\n");

  return c.json({
    threadId,
    messageCount: fullMessages.length,
    sampleBody: threadBody.substring(0, 1000),
  });
});

gmailRoutes.get("/threads/search", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  
  const [config] = await db.query<{ refresh_token_ciphertext: string | null; refresh_token_iv: string | null }>(
    `SELECT refresh_token_ciphertext, refresh_token_iv FROM gmail_config WHERE firm_id = $1`,
    [firm.id],
  );

  if (!config) {
    return c.json({ error: "Gmail not configured" }, 404);
  }

  const query = c.req.query("q") || "";
  const maxResults = parseInt(c.req.query("maxResults") || "20", 10);

  const messages = await searchGmailMessages(await connectedAccessToken(c.env, config), query);
  const uniqueThreads = new Map<string, typeof messages[number]>();

  for (const msg of messages) {
    if (!uniqueThreads.has(msg.threadId)) {
      uniqueThreads.set(msg.threadId, msg);
    }
  }

  const threads = Array.from(uniqueThreads.values()).slice(0, maxResults);

  return c.json({
    threads,
    threadCount: uniqueThreads.size,
  });
});

function headerValue(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractEmailAddress(fromHeader: string): string {
  const match = fromHeader.match(/<([^>]+)>/);
  return (match ? match[1] : fromHeader).trim().toLowerCase();
}

const triageSchema = z.object({ maxMessages: z.number().int().min(1).max(50).optional() });

/**
 * Inbound triage: scans recent inbox messages, matches the sender's address
 * against a known client's email, and creates an approval-required agent
 * task per matched, not-yet-triaged message. Nothing is replied to, filed,
 * or sent automatically - this only prepares work for her to review on the
 * agent desk, per the one hard guardrail (human authorization on everything
 * client-facing).
 */
gmailRoutes.post("/triage", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const [config] = await db.query<{ refresh_token_ciphertext: string | null; refresh_token_iv: string | null }>(
    `SELECT refresh_token_ciphertext, refresh_token_iv FROM gmail_config WHERE firm_id = $1`,
    [firm.id],
  );
  if (!config) {
    return c.json({ error: "Gmail is not connected for this firm yet." }, 404);
  }

  const body = triageSchema.parse(await c.req.json().catch(() => ({})));
  const maxMessages = body.maxMessages ?? 20;

  const clientRows = await db.query<{ id: string; email: string }>(
    `SELECT id, email FROM clients WHERE firm_id = $1 AND email IS NOT NULL`,
    [firm.id],
  );
  const clientByEmail = new Map(clientRows.map((r) => [r.email.toLowerCase(), r.id]));
  if (clientByEmail.size === 0) {
    return c.json({ scanned: 0, matched: 0, tasksCreated: 0, unmatchedSenders: [], note: "No clients have an email on file yet, so nothing could be matched." });
  }

  let listResult: { messages: Array<{ id: string; threadId: string }> };
  try {
    listResult = await listGmailMessages(await connectedAccessToken(c.env, config), "in:inbox", maxMessages);
  } catch {
    return c.json({ error: "Could not reach Gmail. The connection may need to be re-authorized." }, 502);
  }

  let matched = 0;
  let tasksCreated = 0;
  const unmatchedSenders = new Set<string>();

  for (const stub of listResult.messages) {
    let message;
    try {
      message = await getGmailMessage(await connectedAccessToken(c.env, config), stub.id, "metadata");
    } catch {
      continue;
    }
    const fromEmail = extractEmailAddress(headerValue(message.payload.headers, "From"));
    const clientId = clientByEmail.get(fromEmail);
    if (!clientId) {
      if (fromEmail) unmatchedSenders.add(fromEmail);
      continue;
    }
    matched++;
    const stmt = gmailTriageAgentTaskStatement({
      firmId: firm.id,
      clientId,
      gmailMessageId: message.id,
      gmailThreadId: message.threadId,
      fromEmail,
      subject: headerValue(message.payload.headers, "Subject") || "(no subject)",
      snippet: message.snippet ?? "",
    });
    const inserted = await db.query<{ id: string }>(`${stmt.query} RETURNING id`, stmt.params);
    if (inserted.length > 0) tasksCreated++;
  }

  return c.json({
    scanned: listResult.messages.length,
    matched,
    tasksCreated,
    unmatchedSenders: Array.from(unmatchedSenders),
  });
});
