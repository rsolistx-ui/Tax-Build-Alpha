import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { createEngagement, getEngagement, isEngagementStatus, listEngagementsWithProgress, updateEngagementDetails, updateEngagementStatus } from "../services/engagements";
import { calendarDateSchema, taxYearSchema } from "../services/date-validation";

export const engagementRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
engagementRoutes.use("*", requireSession);
engagementRoutes.use("*", requireActiveBeta);

const SERVICE_TYPES = [
  "bookkeeping", "monthly_close", "quarterly_work", "tax_1040", "tax_1065",
  "tax_1120", "tax_1120s", "payroll_compliance", "advisory", "custom",
] as const;

const createSchema = z.object({
  serviceType: z.enum(SERVICE_TYPES),
  title: z.string().trim().min(1).max(200),
  startDate: calendarDateSchema.nullable().optional(),
  dueDate: calendarDateSchema.nullable().optional(),
  recurrence: z.string().nullable().optional(),
  assignedUserId: z.string().nullable().optional(),
  taxYear: taxYearSchema.nullable().optional(),
});

const statusSchema = z.object({ status: z.string().min(1) });

engagementRoutes.get("/:clientId/engagements", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const engagements = await listEngagementsWithProgress(db, firm.id, client.id);
  return c.json({ engagements });
});

engagementRoutes.post("/:clientId/engagements", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const body = createSchema.parse(await c.req.json());
  const engagement = await createEngagement(db, c.get("userId"), {
    firmId: firm.id,
    clientId: client.id,
    serviceType: body.serviceType,
    title: body.title,
    startDate: body.startDate,
    dueDate: body.dueDate,
    recurrence: body.recurrence,
    assignedUserId: body.assignedUserId,
    taxYear: body.taxYear,
  });
  return c.json({ engagement }, 201);
});

const detailsSchema = z.object({
  startDate: calendarDateSchema.nullable().optional(),
  dueDate: calendarDateSchema.nullable().optional(),
  recurrence: z.string().nullable().optional(),
  taxYear: taxYearSchema.nullable().optional(),
});

engagementRoutes.patch("/:clientId/engagements/:engagementId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const engagement = await getEngagement(db, c.req.param("engagementId"), firm.id);
  if (!engagement || engagement.client_id !== client.id) return c.json({ error: "Not found" }, 404);

  const body = detailsSchema.parse(await c.req.json());
  const updated = await updateEngagementDetails(db, engagement.id, firm.id, c.get("userId"), body);
  return c.json({ engagement: updated });
});

engagementRoutes.patch("/:clientId/engagements/:engagementId/status", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const body = statusSchema.parse(await c.req.json());
  if (!isEngagementStatus(body.status)) return c.json({ error: "Invalid status" }, 400);

  const engagement = await getEngagement(db, c.req.param("engagementId"), firm.id);
  if (!engagement || engagement.client_id !== client.id) return c.json({ error: "Not found" }, 404);

  const updated = await updateEngagementStatus(db, engagement.id, firm.id, c.get("userId"), body.status);
  return c.json({ engagement: updated });
});
