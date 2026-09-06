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

  const [existingByName] = await db.query<{ id: string }>(
    `SELECT id FROM categories WHERE client_id = $1 AND LOWER(name) = LOWER($2)`,
    [clientId, body.name],
  );
  if (existingByName) {
    return c.json({ error: "A category with this name already exists" }, 409);
  }

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
      return c.json({ error: "A category with this name or slug already exists" }, 409);
    }
    throw error;
  }
});

categoryRoutes.get("/:clientId/categories/:categoryId/evidence", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const categoryId = c.req.param("categoryId");
  const [category] = await db.query<{ id: string; name: string; slug: string }>(
    `SELECT id, name, slug FROM categories WHERE id = $1 AND client_id = $2`,
    [categoryId, clientId],
  );
  if (!category) return c.json({ error: "Category not found" }, 404);

  const sort = c.req.query("sort") === "merchant" ? "merchant" : "date";
  const orderBy = sort === "merchant"
    ? "LOWER(COALESCE(r.extracted_merchant, r.filename)), r.extracted_date DESC NULLS LAST"
    : "r.extracted_date DESC NULLS LAST, LOWER(COALESCE(r.extracted_merchant, r.filename))";

  // Filed, professional-approved evidence only. Unreviewed AI extraction
  // never appears here regardless of the category it was tentatively given.
  // A receipt is discoverable via either its own category or any line
  // item's category, so source evidence is never lost due to line-item-level
  // allocation differing from the receipt-level category.
  const receipts = await db.query<{
    id: string;
    extracted_date: string | null;
    extracted_merchant: string | null;
    extracted_total: number | null;
    extracted_currency: string;
    filename: string;
    excluded_bank_disposition: string | null;
  }>(
    `SELECT DISTINCT r.id, r.extracted_date, r.extracted_merchant, r.extracted_total, r.extracted_currency, r.filename,
            excluded_bt.disposition AS excluded_bank_disposition
     FROM receipts r
     LEFT JOIN bank_transactions excluded_bt ON excluded_bt.matched_receipt_id = r.id
       AND excluded_bt.client_id = r.client_id
       AND excluded_bt.disposition IN (
         'personal', 'transfer', 'owner_contribution', 'owner_draw', 'loan', 'other_excluded', 'business_income'
       )
     WHERE r.client_id = $1
       AND r.status = 'filed'
       AND (
         r.category_id = $2
         OR LOWER(r.extracted_category) = LOWER($3)
         OR EXISTS (
           SELECT 1 FROM receipt_line_items li
           WHERE li.receipt_id = r.id
             AND (LOWER(li.category) = LOWER($3) OR LOWER(li.category) = LOWER($4))
         )
       )
     ORDER BY ${orderBy}`,
    [clientId, category.id, category.slug, category.name],
  );

  return c.json({
    category: { id: category.id, name: category.name, slug: category.slug },
    receipts: receipts.map((r) => ({
      id: r.id,
      date: r.extracted_date,
      merchant: r.extracted_merchant,
      total: r.extracted_total === null ? null : Number(r.extracted_total),
      currency: r.extracted_currency,
      filename: r.filename,
      category: category.name,
      sourceUrl: `/api/clients/${clientId}/receipts/${r.id}/source`,
      excludedFromOperatingPnl: r.excluded_bank_disposition !== null,
      excludedReason: r.excluded_bank_disposition
        ? `Matched bank transaction classified ${r.excluded_bank_disposition.replace(/_/g, " ")}`
        : null,
    })),
  });
});
