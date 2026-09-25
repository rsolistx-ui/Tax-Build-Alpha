import { Hono } from "hono";
import { isClientVisible } from "../services/client-assignment";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { getEngagement } from "../services/engagements";
import { createWorkItem, getWorkItem, queryWorkQueue, updateWorkItemStatus, type WorkQueueFilter } from "../services/work-items";
import { isoTimestampSchema } from "../services/date-validation";
import { z } from "zod";

export const workQueueRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
workQueueRoutes.use("*", requireSession);
workQueueRoutes.use("*", requireActiveBeta);

const VIEWS = [
  "overdue", "due_today", "due_soon", "waiting_on_client", "professional_review", "blocked", "recently_completed",
] as const;
const STATUSES = ["open", "in_progress", "waiting_on_client", "blocked", "complete", "cancelled"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const MAX_LIMIT = 100;

const querySchema = z.object({
  clientId: z.string().min(1).optional(),
  engagementId: z.string().min(1).optional(),
  assignedUserId: z.string().min(1).optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  view: z.enum(VIEWS).optional(),
  // created_at|id - both segments required and non-empty, matching what
  // queryWorkQueue's own cursor encoding produces.
  cursor: z.string().regex(/^[^|]+\|[^|]+$/).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
});

/**
 * Firm-wide practice work queue. Every returned item is a deep link:
 * clientId (+ engagementId when present) is enough for the web client to
 * navigate straight to the exact client workspace tab and record.
 */
workQueueRoutes.get("/", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "Invalid query parameters" }, 400);
  const query = parsed.data;

  const filter: WorkQueueFilter = {
    clientId: query.clientId,
    engagementId: query.engagementId,
    assignedUserId: query.assignedUserId,
    status: query.status,
    priority: query.priority,
    view: query.view,
    cursor: query.cursor,
    limit: query.limit,
    scopeUserId: c.get("clientScopeUserId") ?? null,
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
  priority: z.enum(PRIORITIES).optional(),
  dueAt: isoTimestampSchema.nullable().optional(),
  assignedUserId: z.string().nullable().optional(),
});

/**
 * clientId and engagementId are never trusted as-is: both are verified to
 * belong to the caller's firm (and the engagement to the same client)
 * before any row is written. A mismatch returns a plain 404 - never a
 * response that reveals whether the referenced object exists at all in
 * some other firm or client.
 */
workQueueRoutes.post("/", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = createSchema.parse(await c.req.json());

  const client = await getClient(db, body.clientId, firm.id);
  if (!client || !(await isClientVisible(db, c.get("clientScopeUserId"), client.id))) return c.json({ error: "Not found" }, 404);

  if (body.engagementId) {
    const engagement = await getEngagement(db, body.engagementId, firm.id);
    if (!engagement || engagement.client_id !== client.id) return c.json({ error: "Not found" }, 404);
  }

  const workItem = await createWorkItem(db, c.get("userId"), {
    firmId: firm.id,
    clientId: client.id,
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

const statusSchema = z.object({ status: z.enum(STATUSES) });

workQueueRoutes.patch("/:workItemId/status", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = statusSchema.parse(await c.req.json());

  const scopeUserId = c.get("clientScopeUserId");
  if (scopeUserId) {
    const item = await getWorkItem(db, c.req.param("workItemId"), firm.id);
    if (!item || !item.client_id || !(await isClientVisible(db, scopeUserId, item.client_id))) return c.json({ error: "Not found" }, 404);
  }

  const updated = await updateWorkItemStatus(db, c.req.param("workItemId"), firm.id, c.get("userId"), body.status);
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json({ workItem: updated });
});
