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

export const agentSchedulerRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
agentSchedulerRoutes.use("*", requireSession);
agentSchedulerRoutes.use("*", requireActiveBeta);

const scheduleSchema = z.object({
  clientId: z.string(),
  triggers: z.array(z.string()).optional(),
});

agentSchedulerRoutes.post("/run", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = scheduleSchema.parse(await c.req.json());
  const client = await getClient(db, body.clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const created: Array<{ id: string; action_type: string; source_type: string }> = [];

  // 1. Uncategorized receipts → categorization recommendation
  const uncategorized = await db.query<{ id: string; merchant: string | null }>(
    `SELECT r.id, r.extracted_merchant AS merchant FROM receipts r
     LEFT JOIN agent_tasks at ON at.source_type = 'receipt' AND at.source_id = r.id
     AND at.action_type = 'categorization_review' AND at.status = 'awaiting_approval'
     WHERE r.client_id = $1 AND r.status IN ('review', 'filed') AND r.category_id IS NULL AND at.id IS NULL
     LIMIT 20`,
    [client.id],
  );
  for (const row of uncategorized) {
    const merchant = row.merchant || "unknown";
    const [existing] = await db.query<{ output_json: Record<string, unknown> }>(
      `SELECT output_json FROM correction_rules WHERE client_id = $1 AND rule_type = 'merchant_category' AND match_key = $2 LIMIT 1`,
      [client.id, merchant.toLowerCase()],
    );
    const categoryHint = existing?.output_json?.category as string | null;
    const confidence = existing ? 0.9 : 0.5;
    const [task] = await db.query<{ id: string }>(
      `INSERT INTO agent_tasks (id, client_id, firm_id, source_type, source_id, action_type, status, autonomy, recommendation_json, confidence, created_at)
       VALUES ($1, $2, $3, 'receipt', $4, 'categorization_review', 'awaiting_approval', $5, $6::jsonb, $7, NOW())
       ON CONFLICT DO NOTHING RETURNING id`,
      [newId("agt"), client.id, firm.id, row.id, "approval_required",
       JSON.stringify({ merchant, category: categoryHint || "uncategorized", reason: categoryHint ? `Merchant memory: ${categoryHint}` : `No prior category for ${merchant}` }),
       confidence],
    );
    if (task) created.push({ id: task.id, action_type: "categorization_review", source_type: "receipt" });
  }

  // 2. Missing evidence → client request recommendation
  const missingEvidence = await db.query<{ id: string }>(
    `SELECT bt.id FROM bank_transactions bt
     LEFT JOIN agent_tasks at ON at.source_type = 'bank_transaction' AND at.source_id = bt.id
     AND at.action_type = 'missing_evidence_review' AND at.status = 'awaiting_approval'
     WHERE bt.client_id = $1
       AND bt.matched_receipt_id IS NULL
       AND bt.triage IN ('unmatched', 'needs_review', 'likely_match', 'receipt_pending')
       AND at.id IS NULL
     LIMIT 10`,
    [client.id],
  );
  for (const row of missingEvidence) {
    const [task] = await db.query<{ id: string }>(
      `INSERT INTO agent_tasks (id, client_id, firm_id, source_type, source_id, action_type, status, autonomy, recommendation_json, confidence, created_at)
       VALUES ($1, $2, $3, 'bank_transaction', $4, 'missing_evidence_review', 'awaiting_approval', $5, $6::jsonb, $7, NOW())
       ON CONFLICT DO NOTHING RETURNING id`,
      [newId("agt"), client.id, firm.id, row.id, "approval_required",
       JSON.stringify({ transactionId: row.id, reason: "Bank activity has no linked receipt and needs professional review before any client request is prepared." }),
       0.8],
    );
    if (task) created.push({ id: task.id, action_type: "missing_evidence_review", source_type: "receipt" });
  }

  // 3. Extension due → notification recommendation
  const extensionsDue = await db.query<{ id: string; due_date: string }>(
    `SELECT id, due_date FROM tax_extensions WHERE client_id = $1 AND status = 'pending' AND due_date <= NOW() + INTERVAL '7 days'`,
    [client.id],
  );
  for (const ext of extensionsDue) {
    const [task] = await db.query<{ id: string }>(
      `INSERT INTO agent_tasks (id, client_id, firm_id, source_type, source_id, action_type, status, autonomy, recommendation_json, confidence, created_at)
       VALUES ($1, $2, $3, 'extension', $4, 'extension_due_review', 'awaiting_approval', $5, $6::jsonb, $7, NOW())
       ON CONFLICT DO NOTHING RETURNING id`,
      [newId("agt"), client.id, firm.id, ext.id, "approval_required",
       JSON.stringify({ extensionId: ext.id, dueDate: ext.due_date, reason: `Extension due ${ext.due_date} — recommend filing extension` }),
       0.95],
    );
    if (task) created.push({ id: task.id, action_type: "extension_due_review", source_type: "extension" });
  }

  return c.json({ created, count: created.length, clientId: client.id });
});

agentSchedulerRoutes.post("/notify", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = z.object({
    clientId: z.string().optional(),
    userId: z.string().optional(),
    message: z.string(),
    eventType: z.string().optional(),
  }).parse(await c.req.json());

  const where = body.clientId
    ? `WHERE user_id IN (SELECT user_id FROM clients WHERE id=$1)`
    : body.userId
    ? `WHERE user_id=$1`
    : "";
  const params = body.clientId ? [body.clientId] : body.userId ? [body.userId] : [];
  const subs = await db.query<any>(`SELECT endpoint, p256dh, auth FROM push_subscriptions ${where}`, params);

  for (const sub of subs) {
    try {
      await fetch(sub.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", TTL: "60" },
        body: JSON.stringify({
          title: "Folio Tax — " + (body.eventType || "Update"),
          body: body.message,
          url: "/",
          icon: "/icons/icon-192.png",
          data: { eventType: body.eventType, clientId: body.clientId },
        }),
      });
    } catch { /* per-subscription failures are silent */ }
  }

  return c.json({ sent: subs.length, eventType: body.eventType });
});

agentSchedulerRoutes.get("/status/:clientId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const [pending] = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM agent_tasks WHERE client_id = $1 AND status = 'awaiting_approval'`,
    [client.id],
  );
  const [approved] = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM agent_tasks WHERE client_id = $1 AND status = 'approved' AND created_at >= NOW() - INTERVAL '24 hours'`,
    [client.id],
  );
  const [rules] = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM correction_rules WHERE client_id = $1 AND rule_type = 'merchant_category'`,
    [client.id],
  );

  return c.json({
    clientId: client.id,
    pendingRecommendations: Number(pending?.count || 0),
    approvedToday: Number(approved?.count || 0),
    learnedRules: Number(rules?.count || 0),
    approvalRequired: true,
    scheduled: false,
    pipeline: "manual_run_only",
  });
});
