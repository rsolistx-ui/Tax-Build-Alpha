import { Hono } from "hono";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { ReliabilityEngineerService } from "../services/reliability-engineer";

export const systemReliabilityRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
systemReliabilityRoutes.use("*", requireSession);
systemReliabilityRoutes.use("*", requireActiveBeta);

systemReliabilityRoutes.get("/diagnostics", async (c) => {
  const db = createDb(c.env);
  const service = new ReliabilityEngineerService(db, c.env);
  const report = await service.runDiagnostics();
  return c.json(report);
});

systemReliabilityRoutes.post("/self-heal", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const service = new ReliabilityEngineerService(db, c.env);
  const result = await service.runSelfHealing(firm.id);
  return c.json(result);
});
