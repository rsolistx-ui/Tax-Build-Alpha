import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { assemblePnlReport, isAccrualUnsupported } from "../services/reporting";
import { buildTaxHandoff, getAssignedLines, SCHEDULE_C_LINES, setCategoryLine } from "../services/tax-handoff";
import { buildTaxHandoffWorkbook } from "../services/excel";
import { sanitizeFilenameSegment } from "../services/filenames";
import { insertWorkAuditEvent } from "../services/work-audit";
import { newId } from "../lib/id";
import { loadTaxInputsSummary, TAX_INPUT_KINDS, TAX_INPUT_SCHEMAS, type TaxInputKind } from "../services/tax-inputs";

// Session and beta checks are applied once to /api/clients/* in index.ts;
// do not add use("*") here (see client-prefix-middleware.test.ts).
export const taxHandoffRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

const taxYearSchema = z.coerce.number().int().min(2000).max(2100);

async function loadHandoff(c: any) {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return { error: c.json({ error: "Client not found" }, 404) };
  const parsed = taxYearSchema.safeParse(c.req.param("taxYear"));
  if (!parsed.success) return { error: c.json({ error: "Invalid taxYear" }, 400) };
  const taxYear = parsed.data;
  const [report, assigned] = await Promise.all([
    assemblePnlReport(db, client.id, `${taxYear}-01-01`, `${taxYear}-12-31`),
    getAssignedLines(db, firm.id, client.id, taxYear),
  ]);
  if (isAccrualUnsupported(report)) return { error: c.json({ error: report.warning, code: "ACCRUAL_NOT_SUPPORTED" }, 400) };
  const handoff = buildTaxHandoff({ taxYear, report, assigned });
  const inputs = await loadTaxInputsSummary(db, {
    firmId: firm.id, clientId: client.id, taxYear,
    // The books' net profit, not the handoff's line 29: categories still missing a line would understate it.
    bookedBusinessIncome: report.income, tentativeProfit: report.net,
  });
  return { client, handoff, inputs };
}

taxHandoffRoutes.get("/:clientId/tax-handoff/:taxYear", async (c) => {
  const result = await loadHandoff(c);
  if ("error" in result) return result.error;
  return c.json({ handoff: result.handoff, inputs: result.inputs, lineOptions: SCHEDULE_C_LINES });
});

/** Return inputs (vehicles, home office, assets, 1099s received, estimated payments); see services/tax-inputs.ts. */
async function inputScope(c: any) {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return { error: c.json({ error: "Client not found" }, 404) };
  const taxYear = taxYearSchema.safeParse(c.req.param("taxYear"));
  if (!taxYear.success) return { error: c.json({ error: "Invalid taxYear" }, 400) };
  return { db, firm, client, taxYear: taxYear.data };
}

function parseInputData(kind: TaxInputKind, data: unknown) {
  const parsed = TAX_INPUT_SCHEMAS[kind].safeParse(data);
  return parsed.success ? { data: parsed.data } : { error: parsed.error.issues[0] ? `${parsed.error.issues[0].path.join(".") || kind}: ${parsed.error.issues[0].message}` : "Invalid input" };
}

taxHandoffRoutes.post("/:clientId/tax-handoff/:taxYear/inputs", async (c) => {
  const s = await inputScope(c);
  if ("error" in s) return s.error;
  const body = z.object({ kind: z.enum(TAX_INPUT_KINDS), data: z.unknown() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Send kind and data." }, 400);
  const parsed = parseInputData(body.data.kind, body.data.data);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  const id = newId("tin");
  const [created] = await s.db.query<{ id: string }>(
    `INSERT INTO client_tax_inputs (id, firm_id, client_id, tax_year, kind, data, created_by_user_id, updated_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7) ON CONFLICT DO NOTHING RETURNING id`,
    [id, s.firm.id, s.client.id, s.taxYear, body.data.kind, JSON.stringify(parsed.data), c.get("userId")],
  );
  if (!created) return c.json({ error: "This client already has a home office worksheet for that year. Edit it instead." }, 409);
  await insertWorkAuditEvent(s.db, { firmId: s.firm.id, entityType: "client_tax_input", entityId: id, action: "tax_input_created", actorUserId: c.get("userId"), afterJson: { clientId: s.client.id, taxYear: s.taxYear, kind: body.data.kind, data: parsed.data } });
  return c.json({ id }, 201);
});

taxHandoffRoutes.put("/:clientId/tax-handoff/:taxYear/inputs/:inputId", async (c) => {
  const s = await inputScope(c);
  if ("error" in s) return s.error;
  const [existing] = await s.db.query<{ kind: TaxInputKind; data: unknown }>(
    `SELECT kind, data FROM client_tax_inputs WHERE id = $1 AND firm_id = $2 AND client_id = $3 AND tax_year = $4`,
    [c.req.param("inputId"), s.firm.id, s.client.id, s.taxYear],
  );
  if (!existing) return c.json({ error: "Input not found" }, 404);
  const body = z.object({ data: z.unknown() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Send data." }, 400);
  const parsed = parseInputData(existing.kind, body.data.data);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  await s.db.query(
    `UPDATE client_tax_inputs SET data = $5::jsonb, updated_by_user_id = $6, updated_at = NOW()
      WHERE id = $1 AND firm_id = $2 AND client_id = $3 AND tax_year = $4`,
    [c.req.param("inputId"), s.firm.id, s.client.id, s.taxYear, JSON.stringify(parsed.data), c.get("userId")],
  );
  await insertWorkAuditEvent(s.db, { firmId: s.firm.id, entityType: "client_tax_input", entityId: c.req.param("inputId"), action: "tax_input_updated", actorUserId: c.get("userId"), beforeJson: existing.data, afterJson: parsed.data });
  return c.json({ ok: true });
});

taxHandoffRoutes.delete("/:clientId/tax-handoff/:taxYear/inputs/:inputId", async (c) => {
  const s = await inputScope(c);
  if ("error" in s) return s.error;
  const [removed] = await s.db.query<{ kind: string; data: unknown }>(
    `DELETE FROM client_tax_inputs WHERE id = $1 AND firm_id = $2 AND client_id = $3 AND tax_year = $4 RETURNING kind, data`,
    [c.req.param("inputId"), s.firm.id, s.client.id, s.taxYear],
  );
  if (!removed) return c.json({ error: "Input not found" }, 404);
  await insertWorkAuditEvent(s.db, { firmId: s.firm.id, entityType: "client_tax_input", entityId: c.req.param("inputId"), action: "tax_input_deleted", actorUserId: c.get("userId"), beforeJson: removed });
  return c.json({ ok: true });
});

taxHandoffRoutes.get("/:clientId/tax-handoff/:taxYear/xlsx", async (c) => {
  const result = await loadHandoff(c);
  if ("error" in result) return result.error;
  const { client, handoff, inputs } = result;
  const bytes = await buildTaxHandoffWorkbook({
    clientName: client.name,
    legalName: client.legal_name,
    generatedAt: new Date().toISOString(),
    handoff,
    inputs,
  });
  const draft = !handoff.booksComplete || handoff.needsLine.length > 0 ? " DRAFT" : "";
  const filename = `${sanitizeFilenameSegment(client.name)} - Schedule C ${handoff.taxYear} - Truepost${draft}.xlsx`;
  return new Response(bytes, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
    },
  });
});

taxHandoffRoutes.put("/:clientId/tax-handoff/:taxYear/lines", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const parsedYear = taxYearSchema.safeParse(c.req.param("taxYear"));
  if (!parsedYear.success) return c.json({ error: "Invalid taxYear" }, 400);
  const body = z
    .object({
      categoryId: z.string().min(1),
      lineCode: z.string().refine((code) => SCHEDULE_C_LINES.some((l) => l.code === code), "Unknown Schedule C line").nullable(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? "Invalid body" }, 400);

  const [category] = await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM categories WHERE id = $1 AND client_id = $2`,
    [body.data.categoryId, client.id],
  );
  if (!category) return c.json({ error: "Category not found" }, 404);

  await setCategoryLine(db, {
    firmId: firm.id,
    clientId: client.id,
    categoryId: category.id,
    taxYear: parsedYear.data,
    lineCode: body.data.lineCode,
    userId: c.get("userId"),
  });
  await insertWorkAuditEvent(db, {
    firmId: firm.id,
    entityType: "category_tax_line",
    entityId: category.id,
    action: body.data.lineCode ? "tax_line_set" : "tax_line_cleared",
    actorUserId: c.get("userId"),
    afterJson: { clientId: client.id, category: category.name, taxYear: parsedYear.data, lineCode: body.data.lineCode },
  });
  return c.json({ ok: true });
});
