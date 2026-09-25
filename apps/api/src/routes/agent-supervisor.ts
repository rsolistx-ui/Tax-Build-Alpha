import { Hono } from "hono";
import { visibleClientSql } from "../services/client-assignment";
import { z } from "zod";
import { createDb } from "../db";
import type { DbStatement } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { newId } from "../lib/id";
import {
  agentTaskResolveClaimStatement,
  categorizationApprovalStatements,
  engagementLetterDraftAgentTaskStatement,
  normalizeMerchant,
} from "../services/agent-supervisor";
import { createVersion, createSignatureRequest } from "../services/doc-versioning";
import { buildEngagementLetterPdf } from "../services/engagement-letter";
import { sha256Hex } from "../services/documents";
import {
  getDocuSignAccessToken,
  createDocuSignEnvelope,
} from "../services/docu-sign";
import { getEngagement } from "../services/engagements";
import { canReadSignedRecords } from "../services/firm-roles";

export const agentSupervisorRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

export const agentDeskRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
agentDeskRoutes.use("*", requireSession);
agentDeskRoutes.use("*", requireActiveBeta);

agentDeskRoutes.get("/", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const tasks = await db.query(
    `SELECT at.*, c.name AS client_name
     FROM agent_tasks at
     JOIN clients c ON c.id = at.client_id AND c.firm_id = at.firm_id
     WHERE at.firm_id = $1 AND at.status = 'awaiting_approval'
       AND ($2::boolean = false OR at.action_type <> 'engagement_letter_draft')
       AND ${visibleClientSql("at.client_id", "$3")}
     ORDER BY at.created_at ASC`,
    [firm.id, !canReadSignedRecords(c.get("firmRole") ?? "read_only"), c.get("clientScopeUserId") ?? null],
  );
  return c.json({ tasks });
});

agentSupervisorRoutes.get("/:clientId/correction-rules", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);
  const rules = await db.query(
    `SELECT id, rule_type, match_key, output_json, seen_count, last_applied_at, created_at
     FROM correction_rules
     WHERE client_id = $1 AND rule_type = 'merchant_category'
     ORDER BY seen_count DESC, last_applied_at DESC`,
    [client.id],
  );
  return c.json({ rules });
});

agentSupervisorRoutes.get("/:clientId/agent-tasks", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);
  // Engagement-letter drafts become signed records when approved; roles that
  // cannot read signed records do not see or act on them.
  const hideSigned = !canReadSignedRecords(c.get("firmRole") ?? "read_only");
  const tasks = await db.query(
    `SELECT * FROM agent_tasks WHERE client_id = $1 AND firm_id = $2
       AND ($3::boolean = false OR action_type <> 'engagement_letter_draft')
     ORDER BY created_at DESC LIMIT 200`,
    [client.id, firm.id, hideSigned],
  );
  return c.json({ tasks });
});

const resolveSchema = z.object({ action: z.enum(["approve", "dismiss"]), note: z.string().trim().max(500).optional() });

agentSupervisorRoutes.patch("/:clientId/agent-tasks/:taskId", async (c) => {
  const body = resolveSchema.parse(await c.req.json());
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);
  const actorUserId = c.get("userId");
  const taskId = c.req.param("taskId");

  const [task] = await db.query<{
    id: string;
    source_type: string;
    source_id: string;
    action_type: string;
    status: string;
    recommendation_json: Record<string, unknown>;
  }>(
    `SELECT id, source_type, source_id, action_type, status, recommendation_json
     FROM agent_tasks
     WHERE id = $1 AND client_id = $2 AND firm_id = $3 AND status = 'awaiting_approval'`,
    [taskId, client.id, firm.id],
  );
  if (!task) return c.json({ error: "Task was not found or is no longer awaiting approval" }, 404);
  if (task.action_type === "engagement_letter_draft" && !canReadSignedRecords(c.get("firmRole") ?? "read_only")) {
    return c.json({ error: "Task was not found or is no longer awaiting approval" }, 404);
  }

  const approved = body.action === "approve";
  const newStatus = approved ? "approved" : "dismissed";

  // Guarded claim: only one request can win this row
  const claim = agentTaskResolveClaimStatement({
    taskId,
    clientId: client.id,
    firmId: firm.id,
    newStatus,
    actorUserId,
    note: body.note ?? null,
  });
  const claimResult = await db.query<{ id: string }>(claim.query, claim.params);
  if (claimResult.length === 0) {
    return c.json({ error: "Task was not found or is no longer awaiting approval" }, 404);
  }

  const auditStmt = {
    query: `INSERT INTO audit_events (id, client_id, actor_user_id, action, after_json)
      VALUES ($1, $2, $3, 'agent_recommendation_reviewed', $4::jsonb)`,
    params: [
      newId("aud"),
      client.id,
      actorUserId,
      { agentTaskId: task.id, decision: body.action, actionType: task.action_type, recommendation: task.recommendation_json },
    ],
  };

  const statements: DbStatement[] = [auditStmt];

  if (approved && task.action_type === "email_triage" && task.source_type === "gmail_message") {
    const rec = task.recommendation_json as { subject?: string; snippet?: string; fromEmail?: string; gmailThreadId?: string };
    statements.push({
      query: `INSERT INTO work_items
        (id, firm_id, client_id, title, description, work_type, status, priority, source_type, source_id, client_visible)
      VALUES ($1, $2, $3, $4, $5, 'email_follow_up', 'open', 'normal', 'gmail_message', $6, FALSE)`,
      params: [
        newId("wi"), firm.id, client.id,
        `Email: ${rec.subject ?? "(no subject)"}`,
        `From ${rec.fromEmail ?? "client"}: ${rec.snippet ?? ""}\n\nOpen in Gmail: https://mail.google.com/mail/u/0/#inbox/${rec.gmailThreadId ?? ""}`,
        task.source_id,
      ],
    });
  }

  if (approved && task.action_type === "categorization_review" && task.source_type === "receipt") {
    const categoryHint = (task.recommendation_json.category as string | null) ?? null;
    const merchant = (task.recommendation_json.merchant as string | null) ?? null;

    if (categoryHint) {
      const [resolved] = await db.query<{ id: string }>(
        `SELECT id FROM categories WHERE client_id = $1 AND (LOWER(slug) = LOWER($2) OR LOWER(name) = LOWER($2)) LIMIT 1`,
        [client.id, categoryHint],
      );
      if (resolved) {
        statements.push(
          ...categorizationApprovalStatements({
            clientId: client.id,
            actorUserId,
            receiptId: task.source_id,
            merchant,
            categoryHint,
            categoryId: resolved.id,
          }),
        );
      }
    }
  }

  if (approved && task.action_type === "engagement_letter_draft" && task.source_type === "engagement_letter") {
    const engagementId = task.source_id;
    const fee = (task.recommendation_json.fee as string | null) ?? null;

    const engagement = await getEngagement(db, engagementId, firm.id);
    if (engagement && engagement.client_id === client.id) {
      if (!client.email) {
        throw new Error("Client has no email on file; cannot send engagement letter");
      }

      const { pdfBytes, signatureTab, dateTab } = await buildEngagementLetterPdf({
        firmName: firm.name,
        clientName: client.name,
        serviceType: engagement.service_type,
        taxYear: engagement.tax_year,
        fee,
        effectiveDate: new Date(),
      });

      const documentId = newId("doc");
      const key = `engagement-letters/${firm.id}/${client.id}/${documentId}.pdf`;
      await c.env.RECEIPTS.put(key, pdfBytes, { httpMetadata: { contentType: "application/pdf" } });
      const hash = await sha256Hex(pdfBytes.buffer as ArrayBuffer);

      await db.query(
        `INSERT INTO client_documents (id, client_id, filename, r2_key, content_type, document_type, status, source_hash, uploaded_by)
         VALUES ($1,$2,$3,$4,'application/pdf','engagement_letter','confirmed',$5,$6)`,
        [documentId, client.id, `Engagement Letter - ${engagement.title}.pdf`, key, hash, actorUserId],
      );
      await createVersion(db, firm.id, documentId, key, actorUserId);

      const recipientId = "1";
      let request = await createSignatureRequest(db, firm.id, client.id, {
        engagementId: engagement.id,
        documentId,
        formType: "engagement_letter",
        recipients: [{ email: client.email, name: client.name, roleName: "Client", recipientId }],
      });
      const tabs = [
        { type: "signHere", recipientId, documentId, pageNumber: signatureTab.pageNumber, xPosition: signatureTab.xPosition, yPosition: signatureTab.yPosition, required: true, locked: false },
        { type: "dateSigned", recipientId, documentId, pageNumber: dateTab.pageNumber, xPosition: dateTab.xPosition, yPosition: dateTab.yPosition, required: true, locked: false },
      ];
      await db.query(`UPDATE signature_requests SET tabs=$1::jsonb WHERE id=$2`, [JSON.stringify(tabs), request.id]);
      request = { ...request, tabs };

      const [config] = await db.query<{ client_id: string; client_secret: string; integrator_key: string; user_id: string; base_url: string; account_id: string; access_token: string }>(
        `SELECT client_id, client_secret, integrator_key, user_id, base_url, account_id, access_token FROM docu_sign_config WHERE firm_id = $1`,
        [firm.id],
      );
      if (config && config.access_token) {
        const { accessToken } = await getDocuSignAccessToken({
          clientId: config.client_id,
          clientSecret: config.client_secret,
          integratorKey: config.integrator_key,
          userId: config.user_id,
          baseUrl: config.base_url,
          accountId: config.account_id,
        });

        const envelope = await createDocuSignEnvelope(
          {
            clientId: config.client_id,
            clientSecret: config.client_secret,
            integratorKey: config.integrator_key,
            userId: config.user_id,
            baseUrl: config.base_url,
            accountId: config.account_id,
          },
          accessToken,
          {
            templateId: undefined,
            documents: [{ documentId, name: `Engagement Letter - ${engagement.title}.pdf`, documentBase64: Buffer.from(pdfBytes).toString("base64"), fileExtension: "pdf" }],
            signers: [{
              email: client.email,
              name: client.name,
              roleName: "Client",
              clientUserId: recipientId,
              tabs: {
                signHereTabs: [{ pageNumber: signatureTab.pageNumber, xPosition: signatureTab.xPosition, yPosition: signatureTab.yPosition }],
                dateSignedTabs: [{ pageNumber: dateTab.pageNumber, xPosition: dateTab.xPosition, yPosition: dateTab.yPosition }],
              },
            }],
            subject: `Engagement Letter - ${engagement.title}`,
            emailBlurb: `Please review and sign the engagement letter for ${engagement.title}.`,
          },
        );

        await db.query(
          `INSERT INTO docu_sign_envelopes (id, firm_id, client_id, envelope_id, status, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [newId("dse"), firm.id, client.id, envelope.envelopeId, envelope.status],
        );
      }

      await db.query(
        `INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at) VALUES ($1,$2,$3,'engagement_letter_sent',$4,$5::jsonb,NOW())`,
        [crypto.randomUUID(), firm.id, client.id, actorUserId, JSON.stringify({ engagementId: engagement.id, documentId, requestId: request.id })],
      );
    }
  }

  await db.transaction(statements);

  const [updated] = await db.query<Record<string, unknown>>(
    `SELECT * FROM agent_tasks WHERE id = $1 AND client_id = $2`,
    [taskId, client.id],
  );
  return c.json({ task: updated });
});
