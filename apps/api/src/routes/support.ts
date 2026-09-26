import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { EmailDispatcherService } from "../services/email-dispatcher";
import { insertWorkAuditEvent } from "../services/work-audit";
import { activateSafeScopedRule } from "../services/scoped-rule-automation";
import { enqueueOutboxStatements, processDurableOutbox } from "../services/durable-outbox";

export const supportRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
supportRoutes.use("*", requireSession);

const contactSchema = z.object({
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
  category: z.string().optional(),
});

const ruleRequestSchema = z.object({
  clientId: z.string().optional(),
  clientName: z.string().optional(),
  directiveText: z.string().min(1).max(5000),
  ruleType: z.enum(["categorization", "personal_vs_business", "tax_deduction", "general"]).default("categorization"),
});

supportRoutes.post("/contact", async (c) => {
  const body = contactSchema.parse(await c.req.json());
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const ticketNumber = `ENG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const userName = c.get("userName") || "Practitioner";
  const userEmail = c.get("userEmail") || c.get("userId");

  const emailDispatcher = new EmailDispatcherService(c.env);

  // Capture the exact customer-facing copy with the request. Delivery is
  // queued atomically below, before any external provider is contacted.
  const clientResponse = emailDispatcher.buildClientSupportAutoResponse({
    ticketNumber,
    firmName: firm.name,
    userName,
    userEmail,
    subject: body.subject,
    message: body.message,
    category: body.category,
  });

  const supportPayload = {
    ticketNumber,
    firmName: firm.name,
    userName,
    userEmail,
    subject: body.subject,
    message: body.message,
    category: body.category,
  };
  await db.transaction([
    {
      query: `INSERT INTO support_tickets (id, firm_id, user_id, user_name, user_email, subject, message, category, status, ai_response, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_delivery', $9, NOW())`,
      params: [ticketNumber, firm.id, c.get("userId"), userName, userEmail, body.subject, body.message, body.category || "General", clientResponse.text],
    },
    ...enqueueOutboxStatements({
      firmId: firm.id,
      ticketNumber,
      operations: [
        { kind: "support_client_confirmation", payload: supportPayload, key: "client-confirmation" },
        { kind: "support_admin_alert", payload: supportPayload, key: "admin-alert" },
      ],
    }),
  ]);

  await insertWorkAuditEvent(db, {
    firmId: firm.id,
    entityType: "support_contact",
    entityId: ticketNumber,
    action: "support_ticket_auto_responded",
    actorUserId: c.get("userId"),
    afterJson: {
      subject: body.subject,
      category: body.category,
      deliveryQueued: true,
    },
  }).catch((error) => console.error("[support-ticket-audit]", error));

  c.executionCtx.waitUntil(processDurableOutbox(c.env).catch((error) => console.error("[outbox-support]", error)));

  return c.json({
    ok: true,
    ticketNumber,
    status: "pending_delivery",
    message: "Your inquiry has been received. A confirmation is being delivered to your email, and a Truepost specialist is reviewing your account.",
  });
});

/**
 * Endpoint for client / practitioner to submit custom rule requests without burning voice/dictation tokens.
 */
supportRoutes.post("/request-rule", async (c) => {
  const body = ruleRequestSchema.parse(await c.req.json());
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const ticketNumber = `RUL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const userName = c.get("userName") || "Practitioner";
  const userEmail = c.get("userEmail") || c.get("userId");

  const clientConfirmation = {
    ticketNumber,
    userName,
    userEmail,
    firmName: firm.name,
    clientName: body.clientName,
    directiveText: body.directiveText,
  };
  const adminAlert = {
    ticketNumber,
    firmName: firm.name,
    userName,
    userEmail,
    ruleTitle: `Rule Directive for ${body.clientName || "Practice"}`,
    ruleType: body.ruleType,
    directiveText: body.directiveText,
    markdownContent: `# Directive Request #${ticketNumber}\n\nClient: ${body.clientName || "Global"}\nRequested: "${body.directiveText}"`,
    clientName: body.clientName,
  };

  // Persist the instruction and delivery intent before controlled activation.
  await db.transaction([
    {
      query: `INSERT INTO client_rule_requests (id, firm_id, client_id, client_name, requested_by, user_email, directive_text, rule_type, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_review', NOW())`,
      params: [ticketNumber, firm.id, body.clientId || null, body.clientName || null, userName, userEmail, body.directiveText, body.ruleType],
    },
    ...enqueueOutboxStatements({
      firmId: firm.id,
      ticketNumber,
      operations: [
        { kind: "rule_client_confirmation", payload: clientConfirmation, key: "client-confirmation" },
        { kind: "rule_admin_alert", payload: adminAlert, key: "admin-alert" },
      ],
    }),
  ]);

  // 4. Narrow, non-tax client rules may activate immediately for *future*
  // intake suggestions. They are never retroactively applied here and they
  // cannot change code, escape the client scope, or make a tax conclusion.
  const automation = await activateSafeScopedRule({
    db,
    env: c.env,
    firmId: firm.id,
    clientId: body.clientId,
    clientName: body.clientName,
    directiveText: body.directiveText,
    ruleType: body.ruleType,
    actorUserId: c.get("userId"),
  });

  if (automation.status === "activated") {
    await db.query(
      `UPDATE client_rule_requests
       SET status = 'activated', ai_notes = $1, resolved_at = NOW()
       WHERE id = $2 AND firm_id = $3`,
      [automation.summary, ticketNumber, firm.id],
    );
    await db.transaction(enqueueOutboxStatements({
      firmId: firm.id,
      ticketNumber,
      operations: [{
        kind: "rule_activation_confirmation",
        payload: { ticketNumber, userName, userEmail, clientName: body.clientName, summary: automation.summary },
        key: "activation-confirmation",
      }],
    }));
  } else {
    await db.query(
      `UPDATE client_rule_requests SET ai_notes = $1 WHERE id = $2 AND firm_id = $3`,
      [automation.reason, ticketNumber, firm.id],
    );
  }

  c.executionCtx.waitUntil(processDurableOutbox(c.env).catch((error) => console.error("[outbox-rule]", error)));
  return c.json({
    ok: true,
    ticketNumber,
    status: automation.status,
    message: automation.status === "activated"
      ? "Your client-scoped rule is active for future intake suggestions. A confirmation is being delivered to your email."
      : "Your directive is safely queued for practitioner review. An automated confirmation is being delivered to your email.",
  });
});
