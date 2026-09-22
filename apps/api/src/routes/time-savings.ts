import { Hono } from "hono";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getWeeklyTimeSavings } from "../services/time-savings";

export const timeSavingsRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
timeSavingsRoutes.use("*", requireSession);
timeSavingsRoutes.use("*", requireActiveBeta);

timeSavingsRoutes.get("/", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  return c.json(await getWeeklyTimeSavings(db, firm.id));
});

timeSavingsRoutes.get("/export", async (c) => {
  const format = c.req.query("format") || "csv";
  if (format === "csv") {
    const db = createDb(c.env);
    const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
    const report = await getWeeklyTimeSavings(db, firm.id);
    const csvContent = [
      "Category,Estimated Hours Returned,Method",
      `Receipt Processing,${report.hoursFromReceipts},Completed receipt estimate (4.5 minutes each)`,
      `Bank Reconciliation,${report.hoursFromBank},Categorized bank-line estimate (2.5 minutes each)`,
      `Client Evidence Chasing,${report.hoursFromChasing},Satisfied client-request estimate (15 minutes each)`,
      `Secure Document Signing,${report.hoursFromEsign},Completed signature estimate (25 minutes each)`,
      `Total,${report.totalHoursSaved},Current-week evidence-derived estimate`,
      `Method,,${report.estimateMethod}`,
    ].join("\r\n");

    return new Response(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="truepost-time-savings-audit.csv"`,
      },
    });
  }

  return c.text("PDF export generated in report center", 200);
});
