import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { newId } from "../lib/id";

export const categoryRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
categoryRoutes.use("*", requireSession);

categoryRoutes.get("/:clientId/categories", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const categories = await db.query(
    `SELECT * FROM categories WHERE client_id = $1 ORDER BY sort_order, LOWER(name)`,
    [clientId],
  );
  return c.json({ categories });
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
});

categoryRoutes.post("/:clientId/categories", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const body = createSchema.parse(await c.req.json());
  const slug =
    body.slug ??
    body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  try {
    const [category] = await db.query(
      `INSERT INTO categories (id, client_id, name, slug, is_default, sort_order)
       VALUES ($1, $2, $3, $4, FALSE, 100)
       RETURNING *`,
      [newId("cat"), clientId, body.name, slug],
    );
    return c.json({ category }, 201);
  } catch (error) {
    if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
      return c.json({ error: "Category slug already exists" }, 409);
    }
    throw error;
  }
});
