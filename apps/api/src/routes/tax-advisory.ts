import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { getClientProfile } from "../services/client-profile";
import { assemblePnlReport } from "../services/reporting";
import { generateAdvisoryRoadmap, type AdvisoryInputs } from "../services/tax-advisory-roadmap";
import { newId } from "../lib/id";

export const taxAdvisoryRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

const advisoryQuerySchema = z.object({
  taxYear: z.coerce.number().int().optional(),
  ownerAge: z.coerce.number().int().min(18).max(100).optional(),
  hoursWorkedPerWeek: z.coerce.number().min(1).max(100).optional(),
  augustaDays: z.coerce.number().int().min(0).max(14).optional(),
  augustaDailyRate: z.coerce.number().min(0).max(50000).optional(),
  plannedEquipmentPurchases: z.coerce.number().min(0).optional(),
  heavyVehiclePurchases: z.coerce.number().min(0).optional(),
  marginalTaxBracket: z.coerce.number().min(0.10).max(0.50).optional(),
});

/**
 * GET /api/clients/:clientId/advisory-roadmap
 * Generates an executive Tax Advisory Strategy Roadmap based on canonical P&L ledger data,
 * client profile, and practitioner-adjusted assumptions.
 */
taxAdvisoryRoutes.get("/:clientId/advisory-roadmap", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const query = advisoryQuerySchema.parse(c.req.query());
  const profile = await getClientProfile(db, clientId);

  // Fetch canonical P&L for net operating profit
  const pnlReport = await assemblePnlReport(
    db,
    clientId,
    query.taxYear ? `${query.taxYear}-01-01` : null,
    query.taxYear ? `${query.taxYear}-12-31` : null
  );

  const netProfit = "net" in pnlReport ? Number(pnlReport.net ?? 0) : 0;

  const inputs: AdvisoryInputs = {
    taxYear: query.taxYear ?? (profile?.tax_year || new Date().getFullYear()),
    netProfit,
    entityType: profile?.entity_type,
    industry: profile?.industry,
    marginalTaxBracket: query.marginalTaxBracket ?? 0.28,
    ownerAge: query.ownerAge ?? 45,
    hoursWorkedPerWeek: query.hoursWorkedPerWeek ?? 40,
    augustaDays: query.augustaDays ?? 12,
    augustaDailyRate: query.augustaDailyRate ?? 1250,
    plannedEquipmentPurchases: query.plannedEquipmentPurchases ?? 0,
    heavyVehiclePurchases: query.heavyVehiclePurchases ?? 0,
  };

  const roadmap = generateAdvisoryRoadmap(
    clientId,
    client.legal_name || client.name,
    inputs
  );

  return c.json({
    roadmap,
    clientName: client.name,
    legalName: client.legal_name,
    entityType: profile?.entity_type || null,
    industry: profile?.industry || null,
  });
});

/**
 * POST /api/clients/:clientId/advisory-roadmap/log
 * Persists an immutable audit log record documenting that the practitioner generated
 * and reviewed the Tax Advisory Roadmap with the client under Treasury Circular 230.
 */
taxAdvisoryRoutes.post("/:clientId/advisory-roadmap/log", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = z
    .object({
      taxYear: z.number().int(),
      totalEstimatedSavings: z.number(),
      memoSummary: z.string().min(1),
    })
    .parse(await c.req.json());

  const auditId = newId("audit");
  await db.query(
    `INSERT INTO audit_events (
      id, firm_id, client_id, actor_id, actor_name, event_type, details, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [
      auditId,
      firm.id,
      clientId,
      c.get("userId"),
      c.get("userName") || "Practitioner",
      "tax_advisory_roadmap_generated",
      JSON.stringify({
        taxYear: body.taxYear,
        totalEstimatedSavings: body.totalEstimatedSavings,
        memoSummary: body.memoSummary,
      }),
    ]
  );

  return c.json({ ok: true, auditId });
});
