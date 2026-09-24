import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { getOrganizerChecklist } from "../services/tax-organizer";
import { runTaxDiagnostics } from "../services/tax-diagnostics";

export const taxOrganizerRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

taxOrganizerRoutes.get("/:clientId/tax-organizer/:taxForm", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const taxForm = c.req.param("taxForm");
  const prefilledOnly = c.req.query("prefill") === "1";
  let checklist = getOrganizerChecklist(taxForm);
  if (prefilledOnly) {
    const prior = await db.query<any>(`SELECT source_code FROM receipts WHERE firm_id=$1 AND client_id=$2 AND category=$3`, [firm.id, client.id, taxForm]);
    const prefilled = new Set(prior.map((r: any) => r.source_code));
    checklist = checklist.map((c) => ({ ...c, prefilled: prefilled.has(c.code) }));
  }
  return c.json({ checklist, taxForm });
});

taxOrganizerRoutes.get("/:clientId/tax-diagnostics/:taxYear", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const parsed = z.coerce.number().int().min(2000).max(2100).safeParse(c.req.param("taxYear"));
  if (!parsed.success) return c.json({ error: "Invalid taxYear" }, 400);
  const diags = await runTaxDiagnostics(db, client.id, parsed.data);
  return c.json({ diagnostics: diags });
});
