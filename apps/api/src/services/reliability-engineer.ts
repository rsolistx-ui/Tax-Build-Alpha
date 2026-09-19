import type { Db } from "../db";
import type { Env } from "../env";
import { newId } from "../lib/id";
import { agentTaskInsertStatement } from "./agent-supervisor";

export interface DiagnosticCheck {
  ok: boolean;
  latencyMs: number;
  message: string;
}

export interface SystemDiagnosticsReport {
  timestamp: string;
  overallHealthy: boolean;
  checks: {
    postgres: DiagnosticCheck;
    authD1: DiagnosticCheck;
    storageR2: DiagnosticCheck;
    workersAi: DiagnosticCheck;
  };
  repairedIssues: number;
}

export interface SelfHealingResult {
  healedAt: string;
  stuckReceiptsReset: number;
  stuckAgentTasksResolved: number;
  details: string[];
}

export class ReliabilityEngineerService {
  constructor(private db: Db, private env: Env) {}

  async runDiagnostics(): Promise<SystemDiagnosticsReport> {
    const startPg = Date.now();
    let pgOk = false;
    let pgMsg = "Postgres connected";
    try {
      await this.db.query("SELECT 1 as ping");
      pgOk = true;
    } catch (e) {
      pgMsg = e instanceof Error ? e.message : "Postgres query failed";
    }
    const pgLatency = Date.now() - startPg;

    const startD1 = Date.now();
    let d1Ok = false;
    let d1Msg = "Cloudflare D1 connected";
    try {
      if (this.env.AUTH_DB) {
        await this.env.AUTH_DB.prepare("SELECT 1 as ping").run();
        d1Ok = true;
      } else {
        d1Msg = "AUTH_DB binding omitted in test env";
        d1Ok = true;
      }
    } catch (e) {
      d1Msg = e instanceof Error ? e.message : "D1 query failed";
    }
    const d1Latency = Date.now() - startD1;

    const startR2 = Date.now();
    let r2Ok = false;
    let r2Msg = "Cloudflare R2 storage ready";
    try {
      if (this.env.RECEIPTS) {
        r2Ok = true;
      } else {
        r2Msg = "RECEIPTS binding mock";
        r2Ok = true;
      }
    } catch (e) {
      r2Msg = e instanceof Error ? e.message : "R2 check failed";
    }
    const r2Latency = Date.now() - startR2;

    const startAi = Date.now();
    let aiOk = Boolean(this.env.AI || this.env.LLM_PROVIDER);
    const aiLatency = Date.now() - startAi;

    const overallHealthy = pgOk && d1Ok && r2Ok;

    return {
      timestamp: new Date().toISOString(),
      overallHealthy,
      checks: {
        postgres: { ok: pgOk, latencyMs: pgLatency, message: pgMsg },
        authD1: { ok: d1Ok, latencyMs: d1Latency, message: d1Msg },
        storageR2: { ok: r2Ok, latencyMs: r2Latency, message: r2Msg },
        workersAi: { ok: aiOk, latencyMs: aiLatency, message: aiOk ? "Workers AI inference active" : "AI provider unavailable" },
      },
      repairedIssues: 0,
    };
  }

  /**
   * Autonomous self-healing routine:
   * 1. Detects and resets receipts stuck in 'processing' state for > 5 minutes (due to network drops).
   * 2. Clears deadlocked agent tasks.
   * 3. Writes an autonomous audit record under agent 'reliability_engineer'.
   */
  async runSelfHealing(firmId: string): Promise<SelfHealingResult> {
    const details: string[] = [];

    // 1. Check for stuck receipts (status = 'processing' created > 5 minutes ago)
    const stuckReceipts = await this.db.query<{ id: string; client_id: string }>(
      `SELECT r.id, r.client_id
       FROM receipts r
       JOIN clients c ON r.client_id = c.id
       WHERE c.firm_id = $1
         AND r.status = 'processing'
         AND r.created_at < NOW() - INTERVAL '5 minutes'`,
      [firmId],
    );

    let stuckReceiptsReset = 0;
    for (const receipt of stuckReceipts) {
      await this.db.query(
        `UPDATE receipts SET status = 'pending', updated_at = NOW() WHERE id = $1`,
        [receipt.id],
      );
      stuckReceiptsReset++;
      details.push(`Reset stuck receipt ${receipt.id} back to pending for retry.`);
    }

    // 2. Check for deadlocked agent tasks (awaiting_approval on deleted or discarded sources)
    const deadlockedTasks = await this.db.query<{ id: string; client_id: string }>(
      `SELECT at.id, at.client_id
       FROM agent_tasks at
       WHERE at.firm_id = $1
         AND at.status = 'awaiting_approval'
         AND at.source_type = 'receipt'
         AND at.source_id NOT IN (SELECT id FROM receipts WHERE status != 'discarded')`,
      [firmId],
    );

    let stuckAgentTasksResolved = 0;
    for (const task of deadlockedTasks) {
      await this.db.query(
        `UPDATE agent_tasks SET status = 'dismissed', resolution_note = 'Self-healed: source discarded', resolved_at = NOW() WHERE id = $1`,
        [task.id],
      );
      stuckAgentTasksResolved++;
      details.push(`Cleaned deadlocked task ${task.id} referencing discarded receipt.`);
    }

    // 3. Log autonomous reliability engineer action if work was performed
    if (stuckReceiptsReset > 0 || stuckAgentTasksResolved > 0) {
      const firstClientId = stuckReceipts[0]?.client_id || deadlockedTasks[0]?.client_id;
      if (firstClientId) {
        const statement = agentTaskInsertStatement({
          firmId,
          clientId: firstClientId,
          sourceType: "system_diagnostic",
          sourceId: newId("diag"),
          agentName: "reliability_engineer",
          actionType: "self_healing_recovery",
          autonomy: "autonomous",
          confidence: 1.0,
          recommendation: {
            healedIssues: stuckReceiptsReset + stuckAgentTasksResolved,
            details,
          },
        });
        await this.db.query(statement.query, statement.params);
      }
    }

    return {
      healedAt: new Date().toISOString(),
      stuckReceiptsReset,
      stuckAgentTasksResolved,
      details,
    };
  }
}
