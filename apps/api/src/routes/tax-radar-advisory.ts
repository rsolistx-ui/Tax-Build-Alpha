import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { TaxRadarAdvisoryService } from "../services/tax-radar-advisory";
import { assemblePnlReport } from "../services/reporting";

export const taxRadarAdvisoryRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

// 1099 Radar Scan
taxRadarAdvisoryRoutes.get("/:clientId/1099-radar", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new TaxRadarAdvisoryService(db);
  const items = await service.scan1099Radar(firm.id, clientId);
  return c.json({ contractors: items });
});

// Update W-9 status
taxRadarAdvisoryRoutes.post("/:clientId/1099-radar/w9", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = z
    .object({
      contractorName: z.string().min(1),
      hasW9: z.boolean(),
      einSsnLast4: z.string().optional(),
      email: z.string().email().optional(),
    })
    .parse(await c.req.json());

  const service = new TaxRadarAdvisoryService(db);
  await service.updateContractorW9(firm.id, clientId, body);
  return c.json({ ok: true });
});

// S-Corp Tax Savings Analysis
taxRadarAdvisoryRoutes.get("/:clientId/s-corp-analysis", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  // Get current net profit from P&L report
  const pnl = await assemblePnlReport(db, clientId, null, null);
  const netProfit = "net" in pnl ? Number(pnl.net ?? 0) : 0;

  const service = new TaxRadarAdvisoryService(db);
  const analysis = service.calculateSCorpSavings(netProfit);

  return c.json({ analysis, clientName: client.name });
});
