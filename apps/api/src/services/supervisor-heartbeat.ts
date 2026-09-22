import type { Db } from "../db";
import type { Env } from "../env";
import { createDb } from "../db";
import { newId } from "../lib/id";
import { prepareMorningBrief } from "./morning-brief";

export type SupervisorHeartbeatResult = {
  ranAt: string;
  runSlot: string;
  firmsScanned: number;
  firmsSkipped: number;
  recommendationsCreated: number;
  failures: number;
  /** Kept explicit so monitoring never implies that a model was polled. */
  llmCalls: number;
};

type FirmRow = { id: string };

/**
 * A half-hourly, idempotent supervisor pass. It scans durable evidence and
 * prepares only approval-required work. It does not poll an LLM, send client
 * communication, alter a ledger, or reach tax conclusions. Those actions
 * continue to require an event-specific workflow and the professional gate.
 */
export async function runSupervisorHeartbeat(env: Env, now = new Date()): Promise<SupervisorHeartbeatResult> {
  return runSupervisorHeartbeatWithDb(createDb(env), now);
}

export async function runSupervisorHeartbeatWithDb(db: Db, now = new Date()): Promise<SupervisorHeartbeatResult> {
  const runSlot = halfHourSlot(now);
  const firms = await db.query<FirmRow>(`SELECT id FROM firms ORDER BY id`);
  let firmsScanned = 0;
  let firmsSkipped = 0;
  let recommendationsCreated = 0;
  let failures = 0;

  for (const firm of firms) {
    const [claim] = await db.query<{ id: string }>(
      `INSERT INTO supervisor_heartbeat_runs (id, firm_id, run_slot, status, started_at)
       VALUES ($1, $2, $3::timestamptz, 'running', NOW())
       ON CONFLICT (firm_id, run_slot) DO NOTHING
       RETURNING id`,
      [newId("sup"), firm.id, runSlot],
    );

    if (!claim) {
      firmsSkipped += 1;
      continue;
    }

    try {
      const brief = await prepareMorningBrief(db, firm.id);
      recommendationsCreated += brief.recommendationsCreated;
      firmsScanned += 1;
      await db.query(
        `UPDATE supervisor_heartbeat_runs
         SET status = 'completed', completed_at = NOW(), clients_scanned = $1,
             recommendations_created = $2, llm_calls = 0
         WHERE id = $3`,
        [brief.clientsScanned, brief.recommendationsCreated, claim.id],
      );
    } catch (error) {
      failures += 1;
      console.error("[supervisor-heartbeat] firm run failed", { firmId: firm.id, error });
      await db.query(
        `UPDATE supervisor_heartbeat_runs
         SET status = 'failed', completed_at = NOW(), failure_reason = $1
         WHERE id = $2`,
        [error instanceof Error ? error.message.slice(0, 500) : "Unknown supervisor failure", claim.id],
      ).catch((updateError) => console.error("[supervisor-heartbeat] could not record failure", { firmId: firm.id, updateError }));
    }
  }

  return {
    ranAt: now.toISOString(),
    runSlot,
    firmsScanned,
    firmsSkipped,
    recommendationsCreated,
    failures,
    llmCalls: 0,
  };
}

export function halfHourSlot(now: Date): string {
  const slot = new Date(now);
  slot.setUTCSeconds(0, 0);
  slot.setUTCMinutes(slot.getUTCMinutes() < 30 ? 0 : 30);
  return slot.toISOString();
}
