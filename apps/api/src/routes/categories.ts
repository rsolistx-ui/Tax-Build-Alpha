import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { newId } from "../lib/id";

export const categoryRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

categoryRoutes.use("*", requireSession);

categoryRoutes.get("/:clientId/categories", async (c) => {
  const firm = await ensureFirm(c.env.DB, c.get("userId"), c.get("userName"));
  const client = await getClient(c.env.DB, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM categories WHERE client_id = ? ORDER BY sort_order, name COLLATE NOCASE`,
  )
    .bind(c.req.param("clientId"))
    .all();

  return c.json({ categories: results ?? [] });
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
});

categoryRoutes.post("/:clientId/categories", async (c) => {
  const firm = await ensureFirm(c.env.DB, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(c.env.DB, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const body = createSchema.parse(await c.req.json());
  const slug =
    body.slug ??
    body.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  const id = newId("cat");
  try {
    await c.env.DB.prepare(
      `INSERT INTO categories (id, client_id, name, slug, is_default, sort_order)
       VALUES (?, ?, ?, ?, 0, 100)`,
    )
      .bind(id, clientId, body.name, slug)
      .run();
  } catch {
    return c.json({ error: "Category slug already exists" }, 409);
  }

  const category = await c.env.DB.prepare(`SELECT * FROM categories WHERE id = ?`)
    .bind(id)
    .first();
  return c.json({ category }, 201);
});
