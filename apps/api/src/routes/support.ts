import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { EmailDispatcherService } from "../services/email-dispatcher";
import { insertWorkAuditEvent } from "../services/work-audit";

export const supportRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
supportRoutes.use("*", requireSession);

const contactSchema = z.object({
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
  category: z.string().optional(),
});

supportRoutes.post("/contact", async (c) => {
  const body = contactSchema.parse(await c.req.json());
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const ticketNumber = `ENG-${Math.floor(1000 + Math.random() * 9000)}`;

  const emailDispatcher = new EmailDispatcherService(c.env);
  const dispatch = await emailDispatcher.notifyAdminOfSupportContact({
    ticketNumber,
    firmName: firm.name,
    userName: c.get("userName") || "Practitioner",
    userEmail: c.get("userId"),
    subject: body.subject,
    message: body.message,
    category: body.category,
  });

  await insertWorkAuditEvent(db, {
    firmId: firm.id,
    entityType: "support_contact",
    entityId: ticketNumber,
    action: "support_ticket_opened",
    actorUserId: c.get("userId"),
    afterJson: {
      subject: body.subject,
      category: body.category,
      delivered: dispatch.delivered,
      simulated: dispatch.simulated,
    },
  }).catch(() => {});

  return c.json({
    ok: true,
    ticketNumber,
    message: "Your message has been received by our engineering desk. Our team has reviewed your note and will follow up shortly.",
  });
});
