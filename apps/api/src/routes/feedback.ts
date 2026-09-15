import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { newId } from "../lib/id";

export const feedbackRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
feedbackRoutes.use("*", requireSession);

const feedbackSchema = z.object({
  category: z.enum(["bug", "feature", "ux", "performance", "integration", "other"]),
  message: z.string().trim().min(1).max(2000),
  page: z.string().trim().max(500).optional(),
  clientId: z.string().optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
});

feedbackRoutes.post("/", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = feedbackSchema.parse(await c.req.json());
  const [row] = await db.query<any>(
    `INSERT INTO feedback_submissions (id, firm_id, user_id, category, message, page, client_id, severity, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', NOW())
     RETURNING *`,
    [newId("fb"), firm.id, c.get("userId"), body.category, body.message, body.page ?? null, body.clientId ?? null, body.severity],
  );
  return c.json({ submission: row }, 201);
});

feedbackRoutes.get("/", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const status = c.req.query("status");
  const where = status ? `WHERE firm_id = $1 AND status = $2` : `WHERE firm_id = $1`;
  const params = status ? [firm.id, status] : [firm.id];
  const rows = await db.query<any>(`SELECT * FROM feedback_submissions ${where} ORDER BY created_at DESC LIMIT 100`, params);
  return c.json({ submissions: rows });
});

feedbackRoutes.patch("/:id", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = z.object({ status: z.enum(["open", "in_progress", "resolved", "closed", "wont_fix"]) }).parse(await c.req.json());
  const [row] = await db.query<any>(
    `UPDATE feedback_submissions SET status = $1 WHERE id = $2 AND firm_id = $3 RETURNING *`,
    [body.status, c.req.param("id"), firm.id],
  );
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ submission: row });
});
