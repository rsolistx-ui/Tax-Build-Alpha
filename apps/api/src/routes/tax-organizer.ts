import { Hono } from "hono";
import { z } from "zod";
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
  const checklist = getOrganizerChecklist(taxForm);
  if (checklist.length === 0 && taxForm !== "state_CA" && taxForm !== "state_NY") {
    const known = ["1040", "1120", "1120S", "1065", "state_CA", "state_NY"];
    if (!known.includes(taxForm)) return c.json({ error: "Unknown taxForm" }, 400);
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
  const diags = await runTaxDiagnostics(db, client.id, firm.id, parsed.data);
  return c.json({ diagnostics: diags });
});
