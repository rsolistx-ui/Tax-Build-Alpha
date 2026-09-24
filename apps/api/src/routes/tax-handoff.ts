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
  return { client, handoff: buildTaxHandoff({ taxYear, report, assigned }) };
}

taxHandoffRoutes.get("/:clientId/tax-handoff/:taxYear", async (c) => {
  const result = await loadHandoff(c);
  if ("error" in result) return result.error;
  return c.json({ handoff: result.handoff, lineOptions: SCHEDULE_C_LINES });
});

taxHandoffRoutes.get("/:clientId/tax-handoff/:taxYear/xlsx", async (c) => {
  const result = await loadHandoff(c);
  if ("error" in result) return result.error;
  const { client, handoff } = result;
  const bytes = await buildTaxHandoffWorkbook({
    clientName: client.name,
    legalName: client.legal_name,
    generatedAt: new Date().toISOString(),
    handoff,
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
