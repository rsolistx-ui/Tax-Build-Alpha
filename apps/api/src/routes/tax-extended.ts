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

// 1099-NEC / 1099-MISC Contractor Threshold Radar ($600 IRS Rule)
taxExtendedRoutes.get("/:clientId/1099-radar", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const taxYear = Number(c.req.query("taxYear") || new Date().getFullYear());

  // Aggregate bank transaction outflows by vendor description
  const rows = await db.query<{
    vendor_name: string;
    total_paid: number;
    payment_count: number;
    last_payment: string;
  }>(
    `SELECT
       TRIM(description) as vendor_name,
       SUM(ABS(amount))::numeric as total_paid,
       COUNT(*)::int as payment_count,
       MAX(txn_date) as last_payment
     FROM bank_transactions
     WHERE client_id = $1
       AND amount < 0
       AND (EXTRACT(YEAR FROM txn_date::date) = $2 OR txn_date IS NULL)
     GROUP BY TRIM(description)
     HAVING SUM(ABS(amount)) >= 250
     ORDER BY total_paid DESC
     LIMIT 50`,
    [client.id, taxYear],
  );

  // Check existing W-9 signature requests or uploaded documents
  const w9Requests = await db.query<{ title: string; status: string }>(
    `SELECT title, status FROM signature_requests WHERE client_id = $1 AND form_type ILIKE '%W-9%'`,
    [client.id],
  ).catch(() => []);

  const w9Docs = await db.query<{ filename: string }>(
    `SELECT filename FROM client_documents WHERE client_id = $1 AND (filename ILIKE '%w9%' OR filename ILIKE '%w-9%')`,
    [client.id],
  ).catch(() => []);

  let total1099Spend = 0;
  let requiring1099Count = 0;
  let missingW9Count = 0;

  const contractors = rows.map((r) => {
    const totalPaid = Number(r.total_paid);
    const requires1099 = totalPaid >= 600;
    if (requires1099) {
      total1099Spend += totalPaid;
      requiring1099Count++;
    }

    const hasSignedW9 = w9Docs.some((d) => d.filename.toLowerCase().includes(r.vendor_name.toLowerCase()))
      || w9Requests.some((req) => req.title.toLowerCase().includes(r.vendor_name.toLowerCase()) && req.status === "completed");
    const hasPendingW9 = w9Requests.some((req) => req.title.toLowerCase().includes(r.vendor_name.toLowerCase()) && req.status !== "completed");

    let w9Status: "on_file" | "requested" | "missing" = "missing";
    if (hasSignedW9) w9Status = "on_file";
    else if (hasPendingW9) w9Status = "requested";

    if (requires1099 && w9Status === "missing") {
      missingW9Count++;
    }

    return {
      vendorName: r.vendor_name,
      totalPaid,
      paymentCount: Number(r.payment_count),
      lastPaymentDate: r.last_payment,
      requires1099,
      status: totalPaid >= 600 ? "exceeded_threshold" : totalPaid >= 450 ? "approaching_threshold" : "below_threshold",
      w9Status,
    };
  });

  return c.json({
    taxYear,
    statutoryThreshold: 600,
    summary: {
      totalVendorsEvaluated: contractors.length,
      requiring1099: requiring1099Count,
      missingW9: missingW9Count,
      total1099Spend: Math.round(total1099Spend * 100) / 100,
    },
    contractors,
  });
});

// 1-Click W-9 Dispatch via Native E-Sign Vault
taxExtendedRoutes.post("/:clientId/1099-radar/request-w9", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = z.object({
    contractorName: z.string().min(1),
    email: z.string().email(),
  }).parse(await c.req.json());

  const { newId } = await import("../lib/id");
  const requestId = newId("sig");

  // Insert statutory signature request for W-9
  await db.query(
    `INSERT INTO signature_requests (
       id, firm_id, client_id, document_id, form_type, title, status, recipients, tabs, created_at, updated_at
     ) VALUES ($1, $2, $3, NULL, 'W-9', $4, 'pending', $5::jsonb, $6::jsonb, NOW(), NOW())`,
    [
      requestId,
      firm.id,
      client.id,
      `IRS Form W-9 Request — ${body.contractorName}`,
      JSON.stringify([{ name: body.contractorName, email: body.email, role: "contractor" }]),
      JSON.stringify([{ type: "signHere", pageNumber: 1, xPosition: 120, yPosition: 680 }]),
    ],
  );

  return c.json({
    ok: true,
    requestId,
    message: `IRS Form W-9 electronic signature request dispatched to ${body.contractorName} (${body.email}) via Folio E-Sign Vault.`,
  }, 201);
});
