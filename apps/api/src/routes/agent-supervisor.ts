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

export const agentSupervisorRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
agentSupervisorRoutes.use("*", requireSession);
agentSupervisorRoutes.use("*", requireActiveBeta);

agentSupervisorRoutes.get("/:clientId/agent-tasks", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);
  const tasks = await db.query(
    `SELECT * FROM agent_tasks WHERE client_id = $1 AND firm_id = $2 ORDER BY created_at DESC LIMIT 200`,
    [client.id, firm.id],
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
  const [task] = await db.query<Record<string, unknown>>(
    `UPDATE agent_tasks SET status = $1, approved_by_user_id = CASE WHEN $1 = 'approved' THEN $2 ELSE NULL END,
       approved_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE NULL END, resolved_at = NOW(), resolution_note = $3, updated_at = NOW()
     WHERE id = $4 AND client_id = $5 AND firm_id = $6 AND status = 'awaiting_approval'
     RETURNING *`,
    [body.action === "approve" ? "approved" : "dismissed", c.get("userId"), body.note ?? null, c.req.param("taskId"), client.id, firm.id],
  );
  if (!task) return c.json({ error: "Task was not found or is no longer awaiting approval" }, 404);
  await db.query(
    `INSERT INTO audit_events (id, client_id, actor_user_id, action, after_json)
     VALUES ($1, $2, $3, 'agent_recommendation_reviewed', $4::jsonb)`,
    [newId("aud"), client.id, c.get("userId"), { agentTaskId: task.id, decision: body.action, actionType: task.action_type, recommendation: task.recommendation_json }],
  );
  return c.json({ task });
});
