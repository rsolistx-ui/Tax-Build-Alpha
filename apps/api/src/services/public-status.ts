import type { Db } from "../db";
import type { Env } from "../env";
import { newId } from "../lib/id";
import { ReliabilityEngineerService, type SystemDiagnosticsReport } from "./reliability-engineer";

const STALE_AFTER_MS = 90 * 60 * 1000;

export type PublicStatus = {
  status: "operational" | "degraded" | "unknown";
  checkedAt: string | null;
  components: Array<{ name: string; status: "operational" | "degraded" | "unknown" }>;
  supportTarget: string;
};

export async function recordPublicStatusCheck(db: Db, report: SystemDiagnosticsReport): Promise<void> {
  await db.query(
    `INSERT INTO public_status_checks (id, checked_at, postgres_ok, auth_ok, overall_healthy)
     VALUES ($1, NOW(), $2, $3, $4)`,
    [newId("stc"), report.checks.postgres.ok, report.checks.authD1.ok, report.overallHealthy],
  );
}

/** Runs the same live diagnostics used by operations, then keeps only public-safe result flags. */
export async function runPublicStatusCheck(env: Env): Promise<SystemDiagnosticsReport> {
  const db = (await import("../db")).createDb(env);
  const report = await new ReliabilityEngineerService(db, env).runDiagnostics();
  await recordPublicStatusCheck(db, report);
  return report;
}

export async function loadPublicStatus(db: Db, now = new Date()): Promise<PublicStatus> {
  const [latest] = await db.query<{ checked_at: string; postgres_ok: boolean; auth_ok: boolean; overall_healthy: boolean }>(
    `SELECT checked_at::text, postgres_ok, auth_ok, overall_healthy
       FROM public_status_checks ORDER BY checked_at DESC LIMIT 1`,
  );
  const stale = !latest || now.getTime() - new Date(latest.checked_at).getTime() > STALE_AFTER_MS;
  const component = (ok: boolean | undefined): "operational" | "degraded" | "unknown" =>
    stale ? "unknown" : ok ? "operational" : "degraded";
  return {
    status: stale ? "unknown" : latest!.overall_healthy ? "operational" : "degraded",
    checkedAt: latest?.checked_at ?? null,
    components: [
      { name: "Application database", status: component(latest?.postgres_ok) },
      { name: "Sign-in service", status: component(latest?.auth_ok) },
    ],
    supportTarget: "First human response by the end of the same business day.",
  };
}
