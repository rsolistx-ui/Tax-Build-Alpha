import { Hono } from "hono";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { getOrganizerChecklist } from "../services/tax-organizer";
import { runTaxDiagnostics } from "../services/tax-diagnostics";

export const taxOrganizerRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
taxOrganizerRoutes.use("*", requireSession);
taxOrganizerRoutes.use("*", requireActiveBeta);

taxOrganizerRoutes.get("/:clientId/tax-organizer/:taxForm", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const taxForm = c.req.param("taxForm");
  return c.json({ checklist: getOrganizerChecklist(taxForm), taxForm });
});

taxOrganizerRoutes.get("/:clientId/tax-diagnostics/:taxYear", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const diags = await runTaxDiagnostics(db, client.id, firm.id, Number(c.req.param("taxYear")));
  return c.json({ diagnostics: diags });
});
