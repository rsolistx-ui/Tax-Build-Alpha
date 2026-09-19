import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { listCarryforwards, createCarryforward, utilizeCarryforward } from "../services/tax-carryforwards";
import { listStateMods, createStateMod } from "../services/tax-state-mods";
import { listM3, createM3, addM3Line } from "../services/tax-m3";
import { priorYearCompare } from "../services/tax-prior-year";
import { listExtensions, createExtension } from "../services/tax-extensions";

export const taxExtendedRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
taxExtendedRoutes.use("*", requireSession);
taxExtendedRoutes.use("*", requireActiveBeta);

taxExtendedRoutes.get("/:clientId/carryforwards", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  return c.json({ carryforwards: await listCarryforwards(db, firm.id, client.id) });
});
taxExtendedRoutes.post("/:clientId/carryforwards", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const body = z.object({ carryforwardType: z.string(), state: z.string().optional(), taxYearGenerated: z.number().int(), taxYearExpires: z.number().int().optional(), originalAmount: z.number(), notes: z.string().optional() }).parse(await c.req.json());
  return c.json({ carryforward: await createCarryforward(db, firm.id, client.id, body) }, 201);
});
taxExtendedRoutes.post("/:clientId/carryforwards/:cfId/utilize", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const body = z.object({ taxYearUsed: z.number().int(), amountUsed: z.number().positive(), returnType: z.string() }).parse(await c.req.json());
  await utilizeCarryforward(db, firm.id, client.id, c.req.param("cfId"), body.taxYearUsed, body.amountUsed, body.returnType);
  return c.json({ ok: true });
});

taxExtendedRoutes.get("/:clientId/state-mods/:taxYear", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  return c.json({ mods: await listStateMods(db, firm.id, client.id, Number(c.req.param("taxYear"))) });
});
taxExtendedRoutes.post("/:clientId/state-mods", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const body = z.object({ state: z.string().length(2), taxYear: z.number().int(), modificationType: z.string(), description: z.string(), amount: z.number(), federalLineCode: z.string().optional(), stateLineCode: z.string().optional(), apportionmentFactor: z.number().optional() }).parse(await c.req.json());
  return c.json({ mod: await createStateMod(db, firm.id, client.id, body) }, 201);
});
taxExtendedRoutes.post("/:clientId/state-mods/calculate-conformity", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const { computeCaliforniaConformity, computeNewYorkConformity, applyStateConformityToDatabase } = await import("../services/state-tax-rules");

  const body = z.object({
    state: z.enum(["CA", "NY"]),
    taxYear: z.number().int(),
    applyImmediately: z.boolean().default(false),
    // CA inputs
    federalBonusDepreciation: z.number().optional(),
    californiaAllowableDepreciation: z.number().optional(),
    federalSection179Deduction: z.number().optional(),
    hsaContributionsDeducted: z.number().optional(),
    hsaEarningsTaxable: z.number().optional(),
    isCaliforniaLlc: z.boolean().optional(),
    californiaGrossReceipts: z.number().optional(),
    californiaPteTaxPaid: z.number().optional(),
    // NY inputs
    newYorkAllowableDepreciation: z.number().optional(),
    stateLocalTaxDeductedFed: z.number().optional(),
    mctdNetSelfEmploymentEarnings: z.number().optional(),
    mctdZone: z.union([z.literal(1), z.literal(2)]).optional(),
    nyPtetTaxPaid: z.number().optional(),
  }).parse(await c.req.json());

  let result;
  if (body.state === "CA") {
    result = computeCaliforniaConformity(body.taxYear, {
      federalBonusDepreciation: body.federalBonusDepreciation,
      californiaAllowableDepreciation: body.californiaAllowableDepreciation,
      federalSection179Deduction: body.federalSection179Deduction,
      hsaContributionsDeducted: body.hsaContributionsDeducted,
      hsaEarningsTaxable: body.hsaEarningsTaxable,
      isCaliforniaLlc: body.isCaliforniaLlc,
      californiaGrossReceipts: body.californiaGrossReceipts,
      californiaPteTaxPaid: body.californiaPteTaxPaid,
    });
  } else {
    result = computeNewYorkConformity(body.taxYear, {
      federalBonusDepreciation: body.federalBonusDepreciation,
      newYorkAllowableDepreciation: body.newYorkAllowableDepreciation,
      stateLocalTaxDeductedFed: body.stateLocalTaxDeductedFed,
      mctdNetSelfEmploymentEarnings: body.mctdNetSelfEmploymentEarnings,
      mctdZone: body.mctdZone,
      nyPtetTaxPaid: body.nyPtetTaxPaid,
    });
  }

  let appliedCount = 0;
  if (body.applyImmediately) {
    const applyRes = await applyStateConformityToDatabase(db, firm.id, client.id, result);
    appliedCount = applyRes.inserted;
  }

  return c.json({ result, appliedCount });
});
taxExtendedRoutes.delete("/:clientId/state-mods/:modId", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  await db.query(`DELETE FROM state_tax_modifications WHERE id=$1 AND firm_id=$2 AND client_id=$3`, [c.req.param("modId"), firm.id, client.id]);
  return c.json({ ok: true });
});

taxExtendedRoutes.get("/:clientId/m3/:taxYear", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  return c.json(await listM3(db, firm.id, client.id, Number(c.req.param("taxYear"))) ?? { reconciliation: null, lines: [] });
});
taxExtendedRoutes.post("/:clientId/m3", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const body = z.object({ taxYear: z.number().int() }).parse(await c.req.json());
  return c.json({ reconciliation: await createM3(db, firm.id, client.id, body.taxYear) }, 201);
});
taxExtendedRoutes.post("/:clientId/m3/:reconId/lines", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const body = z.object({ part: z.enum(["I","II","III"]), lineCode: z.string(), lineLabel: z.string(), lineCategory: z.string(), perBooks: z.number(), temporaryDiff: z.number(), permanentDiff: z.number(), otherDiff: z.number(), sortOrder: z.number().optional(), notes: z.string().optional() }).parse(await c.req.json());
  const [recon] = await db.query<any>(`SELECT id FROM m3_reconciliations WHERE id=$1 AND firm_id=$2 AND client_id=$3`, [c.req.param("reconId"), firm.id, client.id]);
  if (!recon) return c.json({ error: "M-3 reconciliation not found" }, 404);
  return c.json({ line: await addM3Line(db, c.req.param("reconId"), body) }, 201);
});

taxExtendedRoutes.get("/:clientId/prior-year-compare/:taxYear", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  return c.json(await priorYearCompare(db, firm.id, client.id, Number(c.req.param("taxYear"))));
});

taxExtendedRoutes.get("/:clientId/extensions", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  return c.json({ extensions: await listExtensions(db, firm.id, client.id) });
});
taxExtendedRoutes.post("/:clientId/extensions", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const body = z.object({ taxYear: z.number().int(), formType: z.string(), dueDate: z.string() }).parse(await c.req.json());
  return c.json({ extension: await createExtension(db, firm.id, client.id, body) }, 201);
});
