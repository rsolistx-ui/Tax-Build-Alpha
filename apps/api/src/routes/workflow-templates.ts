import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { WorkflowTemplateService } from "../services/workflow-templates";
import { newId } from "../lib/id";

export const workflowTemplateRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
workflowTemplateRoutes.use("*", requireSession);
workflowTemplateRoutes.use("*", requireActiveBeta);

const stepSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  daysOffset: z.number().int(),
  workType: z.string().max(100).optional(),
});

const createTemplateSchema = z.object({
  serviceType: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  steps: z.array(stepSchema).min(1),
});

const subscribeSchema = z.object({
  templateId: z.string(),
  recurrence: z.enum(["once", "monthly", "quarterly", "annually"]),
  firstRunDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const applyNowSchema = z.object({
  templateId: z.string(),
  anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

workflowTemplateRoutes.get("/templates", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const service = new WorkflowTemplateService(db);
  return c.json({ templates: await service.listTemplates(firm.id) });
});

workflowTemplateRoutes.post("/templates", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = createTemplateSchema.parse(await c.req.json());
  const service = new WorkflowTemplateService(db);
  const template = await service.createTemplate(firm.id, body);
  return c.json({ template }, 201);
});

workflowTemplateRoutes.get("/:clientId/subscriptions", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const service = new WorkflowTemplateService(db);
  return c.json({ subscriptions: await service.listSubscriptionsForClient(client.id) });
});

workflowTemplateRoutes.post("/:clientId/subscriptions", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = subscribeSchema.parse(await c.req.json());
  const service = new WorkflowTemplateService(db);
  const template = await service.getTemplate(body.templateId);
  if (!template || template.firmId !== firm.id) return c.json({ error: "Template not found" }, 404);

  const subscription = await service.subscribeClient(firm.id, client.id, body.templateId, body.recurrence, body.firstRunDate);

  await db.query(
    "INSERT INTO audit_events (id, client_id, actor_user_id, action, after_json) VALUES ($1, $2, $3, 'workflow_subscription_created', $4::jsonb)",
    [newId("aud"), client.id, c.get("userId"), { templateId: body.templateId, recurrence: body.recurrence }],
  );

  return c.json({ subscription }, 201);
});

workflowTemplateRoutes.delete("/subscriptions/:subscriptionId", async (c) => {
  const db = createDb(c.env);
  await ensureFirm(db, c.get("userId"), c.get("userName"));
  const service = new WorkflowTemplateService(db);
  await service.deactivateSubscription(c.req.param("subscriptionId"));
  return c.json({ ok: true });
});

// Apply a template to a client immediately, outside the recurrence schedule.
workflowTemplateRoutes.post("/:clientId/apply-now", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = applyNowSchema.parse(await c.req.json());
  const service = new WorkflowTemplateService(db);
  const template = await service.getTemplate(body.templateId);
  if (!template || template.firmId !== firm.id) return c.json({ error: "Template not found" }, 404);

  const workItemIds = await service.applyTemplateToClient(firm.id, client.id, template, body.anchorDate, `manual_${newId()}`);

  await db.query(
    "INSERT INTO audit_events (id, client_id, actor_user_id, action, after_json) VALUES ($1, $2, $3, 'workflow_template_applied', $4::jsonb)",
    [newId("aud"), client.id, c.get("userId"), { templateId: body.templateId, workItemIds }],
  );

  return c.json({ workItemIds }, 201);
});
