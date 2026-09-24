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
  // Prior-year prefill lives on the document checklist
  // (POST /tax-readiness/:taxYear/checklist/prefill-prior-year).
  return c.json({ checklist: getOrganizerChecklist(taxForm), taxForm });
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
