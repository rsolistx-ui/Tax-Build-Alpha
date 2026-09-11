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
import type { DbStatement } from "../db";

export const agentSupervisorRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
agentSupervisorRoutes.use("*", requireSession);
agentSupervisorRoutes.use("*", requireActiveBeta);

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
     ORDER BY at.created_at ASC`,
    [firm.id],
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
  const tasks = await db.query(
    `SELECT * FROM agent_tasks WHERE client_id = $1 AND firm_id = $2 ORDER BY created_at DESC LIMIT 200`,
    [client.id, firm.id],
  );
  return c.json({ tasks });
});

const resolveSchema = z.object({ action: z.enum(["approve", "dismiss"]), note: z.string().trim().max(500).optional() });

function normalizeMerchant(merchant: string): string {
  return merchant.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

agentSupervisorRoutes.patch("/:clientId/agent-tasks/:taskId", async (c) => {
  const body = resolveSchema.parse(await c.req.json());
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);
  const actorUserId = c.get("userId");

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
    [c.req.param("taskId"), client.id, firm.id],
  );
  if (!task) return c.json({ error: "Task was not found or is no longer awaiting approval" }, 404);

  const approved = body.action === "approve";
  const newStatus = approved ? "approved" : "dismissed";
  const statements: DbStatement[] = [
    {
      query: `UPDATE agent_tasks
        SET status = $1,
            approved_by_user_id = CASE WHEN $1 = 'approved' THEN $2 ELSE NULL END,
            approved_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE NULL END,
            resolved_at = NOW(),
            resolution_note = $3,
            updated_at = NOW()
        WHERE id = $4`,
      params: [newStatus, approved ? actorUserId : null, body.note ?? null, task.id],
    },
    {
      query: `INSERT INTO audit_events (id, client_id, actor_user_id, action, after_json)
        VALUES ($1, $2, $3, 'agent_recommendation_reviewed', $4::jsonb)`,
      params: [newId("aud"), client.id, actorUserId, { agentTaskId: task.id, decision: body.action, actionType: task.action_type, recommendation: task.recommendation_json }],
    },
  ];

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
          {
            query: `UPDATE receipts SET category_id = $1, updated_at = NOW() WHERE id = $2 AND client_id = $3`,
            params: [resolved.id, task.source_id, client.id],
          },
          {
            query: `INSERT INTO audit_events (id, client_id, receipt_id, actor_user_id, action, after_json)
              VALUES ($1, $2, $3, $4, 'receipt_category_applied', $5::jsonb)`,
            params: [newId("aud"), client.id, task.source_id, actorUserId, { categoryId: resolved.id, category: categoryHint, from: "agent_approval" }],
          },
        );
        if (merchant) {
          statements.push({
            query: `INSERT INTO correction_rules
              (id, client_id, rule_type, match_key, output_json, seen_count, last_applied_at)
              VALUES ($1, $2, 'merchant_category', $3, $4::jsonb, 1, NOW())
              ON CONFLICT (client_id, rule_type, match_key) DO UPDATE SET
                output_json = EXCLUDED.output_json,
                seen_count = correction_rules.seen_count + 1,
                last_applied_at = NOW(),
                updated_at = NOW()`,
            params: [newId("rule"), client.id, normalizeMerchant(merchant), { category: categoryHint }],
          });
        }
      }
    }
  }

  await db.transaction(statements);

  const [updated] = await db.query<Record<string, unknown>>(
    `SELECT * FROM agent_tasks WHERE id = $1 AND client_id = $2`,
    [task.id, client.id],
  );
  return c.json({ task: updated });
});
