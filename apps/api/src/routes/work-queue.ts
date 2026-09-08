import { Hono } from "hono";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { createWorkItem, queryWorkQueue, updateWorkItemStatus, type WorkQueueFilter } from "../services/work-items";
import { z } from "zod";

export const workQueueRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
workQueueRoutes.use("*", requireSession);
workQueueRoutes.use("*", requireActiveBeta);

const VIEWS = [
  "overdue", "due_today", "due_soon", "waiting_on_client", "professional_review", "blocked", "recently_completed",
] as const;

/**
 * Firm-wide practice work queue. Every returned item is a deep link:
 * clientId (+ engagementId when present) is enough for the web client to
 * navigate straight to the exact client workspace tab and record.
 */
workQueueRoutes.get("/", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const query = c.req.query();
  const view = VIEWS.includes(query.view as (typeof VIEWS)[number]) ? (query.view as (typeof VIEWS)[number]) : undefined;
  const filter: WorkQueueFilter = {
    clientId: query.clientId || undefined,
    engagementId: query.engagementId || undefined,
    assignedUserId: query.assignedUserId || undefined,
    status: query.status || undefined,
    priority: query.priority || undefined,
    view,
    cursor: query.cursor || undefined,
    limit: query.limit ? Number(query.limit) : undefined,
  };

  const result = await queryWorkQueue(db, firm.id, filter);
  return c.json(result);
});

const createSchema = z.object({
  clientId: z.string().min(1),
  engagementId: z.string().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  workType: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  dueAt: z.string().nullable().optional(),
  assignedUserId: z.string().nullable().optional(),
});

workQueueRoutes.post("/", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = createSchema.parse(await c.req.json());

  const workItem = await createWorkItem(db, c.get("userId"), {
    firmId: firm.id,
    clientId: body.clientId,
    engagementId: body.engagementId,
    title: body.title,
    description: body.description,
    workType: body.workType,
    priority: body.priority,
    dueAt: body.dueAt,
    assignedUserId: body.assignedUserId,
  });
  return c.json({ workItem }, 201);
});

const statusSchema = z.object({
  status: z.enum(["open", "in_progress", "waiting_on_client", "blocked", "complete", "cancelled"]),
});

workQueueRoutes.patch("/:workItemId/status", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = statusSchema.parse(await c.req.json());

  const updated = await updateWorkItemStatus(db, c.req.param("workItemId"), firm.id, c.get("userId"), body.status);
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json({ workItem: updated });
});
