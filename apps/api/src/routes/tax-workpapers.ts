import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { getTaxWorkpaper, upsertTaxWorkpaper } from "../services/tax-workpapers";

export const taxWorkpaperRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

taxWorkpaperRoutes.get("/:clientId/tax-workpaper/:taxYear", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const parsed = z.coerce.number().int().min(2000).max(2100).safeParse(c.req.param("taxYear"));
  if (!parsed.success) return c.json({ error: "Invalid taxYear" }, 400);
  const wp = await getTaxWorkpaper(db, firm.id, client.id, parsed.data);
  return c.json({ workpaper: wp ?? null });
});

taxWorkpaperRoutes.put("/:clientId/tax-workpaper/:taxYear", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const parsed = z.coerce.number().int().min(2000).max(2100).safeParse(c.req.param("taxYear"));
  if (!parsed.success) return c.json({ error: "Invalid taxYear" }, 400);
  const body = z.object({ data: z.any(), name: z.string().optional() }).parse(await c.req.json());
  const wp = await upsertTaxWorkpaper(db, firm.id, client.id, parsed.data, body.data, body.name);
  try {
    const { appendSyncEvent, firePushes } = await import("../services/sync");
    await appendSyncEvent(db, firm.id, c.get("userId"), "workpaper", client.id, "update", { taxYear: parsed.data });
    await firePushes(db, c.get("userId"), "Workpaper saved", `${client.id} ${parsed.data}`);
  } catch {}
  return c.json({ workpaper: wp });
});
taxWorkpaperRoutes.get("/:clientId/tax-workpaper/:taxYear/traceability", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const taxYear = Number(c.req.param("taxYear"));
  const pnl = await db.query<any>(
    `SELECT c.slug as category, SUM(pl.amount) as total, SUM(pl.amount) FILTER (WHERE pl.source_bank_transaction_id IS NULL AND pl.receipt_id IS NULL) as untied
     FROM pnl_lines pl LEFT JOIN categories c ON c.id = pl.category_id
     WHERE pl.client_id=$1 AND pl.tax_year=$2 AND c.firm_id=$3
     GROUP BY c.slug`, [client.id, taxYear, firm.id]);
  const missingEvidence = await db.query<any>(
    `SELECT r.id, r.merchant, r.date as receipt_date FROM receipts r
     LEFT JOIN pnl_lines pl ON pl.receipt_id=r.id
     WHERE r.firm_id=$1 AND r.client_id=$2 AND r.tax_year=$3 AND pl.id IS NULL
     ORDER BY r.date DESC LIMIT 25`, [firm.id, client.id, taxYear]);
  const bankUnmapped = await db.query<any>(
    `SELECT bt.id, bt.merchant, bt.amount FROM bank_transactions bt
     LEFT JOIN pnl_lines pl ON pl.source_bank_transaction_id=bt.id
     WHERE bt.firm_id=$1 AND bt.client_id=$2 AND bt.occurrence_date >= $3 AND bt.occurrence_date < $4 AND pl.id IS NULL
     ORDER BY bt.occurrence_date DESC LIMIT 25`,
    [firm.id, client.id, `${taxYear}-01-01`, `${taxYear + 1}-01-01`]);
  return c.json({ pnlByCategory: pnl, missingEvidence, bankUnmapped });
});
