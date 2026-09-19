import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { EmailDispatcherService } from "../services/email-dispatcher";
import { insertWorkAuditEvent } from "../services/work-audit";
import { newId } from "../lib/id";

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

async function initSupportTables(db: any) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      firm_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT,
      user_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      category TEXT,
      status TEXT NOT NULL DEFAULT 'auto_responded',
      ai_response TEXT,
      auto_responded_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS client_rule_requests (
      id TEXT PRIMARY KEY,
      firm_id TEXT NOT NULL,
      client_id TEXT,
      client_name TEXT,
      requested_by TEXT NOT NULL,
      user_email TEXT NOT NULL,
      directive_text TEXT NOT NULL,
      rule_type TEXT NOT NULL DEFAULT 'categorization',
      status TEXT NOT NULL DEFAULT 'pending_review',
      ai_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    )
  `);
}

supportRoutes.post("/contact", async (c) => {
  const body = contactSchema.parse(await c.req.json());
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  await initSupportTables(db);

  const ticketNumber = `ENG-${Math.floor(1000 + Math.random() * 9000)}`;
  const userName = c.get("userName") || "Practitioner";
  const userEmail = c.get("userEmail") || c.get("userId");

  const emailDispatcher = new EmailDispatcherService(c.env);

  // 1. Immediately send AI auto-response to the customer
  const clientResponse = emailDispatcher.buildClientSupportAutoResponse({
    ticketNumber,
    firmName: firm.name,
    userName,
    userEmail,
    subject: body.subject,
    message: body.message,
    category: body.category,
  });

  await emailDispatcher.sendClientAutoResponse({
    ticketNumber,
    firmName: firm.name,
    userName,
    userEmail,
    subject: body.subject,
    message: body.message,
    category: body.category,
  });

  // 2. Alert the platform admin
  await emailDispatcher.notifyAdminOfSupportContact({
    ticketNumber,
    firmName: firm.name,
    userName,
    userEmail,
    subject: body.subject,
    message: body.message,
    category: body.category,
  });

  // 3. Store in database for live admin telemetry
  await db.query(
    `INSERT INTO support_tickets (id, firm_id, user_id, user_name, user_email, subject, message, category, status, ai_response, auto_responded_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'auto_responded', $9, NOW(), NOW())`,
    [
      ticketNumber,
      firm.id,
      c.get("userId"),
      userName,
      userEmail,
      body.subject,
      body.message,
      body.category || "General",
      clientResponse.text,
    ],
  );

  await insertWorkAuditEvent(db, {
    firmId: firm.id,
    entityType: "support_contact",
    entityId: ticketNumber,
    action: "support_ticket_auto_responded",
    actorUserId: c.get("userId"),
    afterJson: {
      subject: body.subject,
      category: body.category,
      autoResponded: true,
    },
  }).catch(() => {});

  return c.json({
    ok: true,
    ticketNumber,
    status: "auto_responded",
    message: "Your inquiry has been received. Our Sentinel system has dispatched an instant confirmation to your email, and a Truepost specialist is reviewing your account.",
  });
});

/**
 * Endpoint for client / practitioner to submit custom rule requests without burning voice/dictation tokens.
 */
supportRoutes.post("/request-rule", async (c) => {
  const body = ruleRequestSchema.parse(await c.req.json());
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  await initSupportTables(db);

  const ticketNumber = `RUL-${Math.floor(1000 + Math.random() * 9000)}`;
  const userName = c.get("userName") || "Practitioner";
  const userEmail = c.get("userEmail") || c.get("userId");

  const emailDispatcher = new EmailDispatcherService(c.env);

  // 1. Send immediate confirmation to client
  await emailDispatcher.sendClientRuleRequestAutoResponse({
    ticketNumber,
    userName,
    userEmail,
    firmName: firm.name,
    clientName: body.clientName,
    directiveText: body.directiveText,
  });

  // 2. Alert platform admin
  await emailDispatcher.notifyAdminOfRuleRequest({
    ticketNumber,
    firmName: firm.name,
    userName,
    userEmail,
    ruleTitle: `Rule Directive for ${body.clientName || "Practice"}`,
    ruleType: body.ruleType,
    directiveText: body.directiveText,
    markdownContent: `# Directive Request #${ticketNumber}\n\nClient: ${body.clientName || "Global"}\nRequested: "${body.directiveText}"`,
    clientName: body.clientName,
  });

  // 3. Store in client_rule_requests for admin to compile
  await db.query(
    `INSERT INTO client_rule_requests (id, firm_id, client_id, client_name, requested_by, user_email, directive_text, rule_type, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_review', NOW())`,
    [
      ticketNumber,
      firm.id,
      body.clientId || null,
      body.clientName || null,
      userName,
      userEmail,
      body.directiveText,
      body.ruleType,
    ],
  );

  return c.json({
    ok: true,
    ticketNumber,
    status: "pending_review",
    message: "Your custom rule directive has been queued with the Truepost Operations Desk. An automated confirmation has been sent to your email.",
  });
});
