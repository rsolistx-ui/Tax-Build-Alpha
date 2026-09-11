import type { Db, DbStatement } from "../db";
import { newId } from "../lib/id";

export const AGENT_POLICY = {
  autonomous: ["intake", "extraction", "matching_suggestion", "reminder_preparation", "request_draft", "work_queue_triage"],
  approvalRequired: ["categorization", "filing", "bank_disposition", "client_sync", "tax_accounting_conclusion"],
} as const;

type AgentTaskInput = {
  firmId: string;
  clientId: string;
  sourceType: "receipt" | "bank_import" | "client_request";
  sourceId: string;
  agentName: "intake_specialist" | "reconciliation_specialist" | "practice_coordinator";
  actionType: string;
  autonomy: "autonomous" | "approval_required";
  confidence?: number | null;
  recommendation: Record<string, unknown>;
};

/**
 * The supervisor's durable hand-off.  Tasks are created only from meaningful
 * events (uploads, imports, prepared client requests), are idempotent, and
 * never execute an action that Folio's policy reserves for the professional.
 * This lets the UI show real work completed and real work awaiting approval
 * without pretending that an unattended model made an accounting or tax
 * decision.
 */
export function agentTaskInsertStatement(input: AgentTaskInput): DbStatement {
  const status = input.autonomy === "autonomous" ? "completed" : "awaiting_approval";
  return {
    query: `INSERT INTO agent_tasks
      (id, firm_id, client_id, source_type, source_id, agent_name, action_type, autonomy,
       status, confidence, recommendation_json, policy_json, resolved_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb,
       CASE WHEN $9 = 'completed' THEN NOW() ELSE NULL END)
     ON CONFLICT (client_id, source_type, source_id, agent_name) DO NOTHING`,
    params: [
      newId("agt"), input.firmId, input.clientId, input.sourceType, input.sourceId,
      input.agentName, input.actionType, input.autonomy, status, input.confidence ?? null,
      input.recommendation,
      { ...AGENT_POLICY, humanApprovalRequired: input.autonomy === "approval_required" },
    ],
  };
}

export async function delegateAgentTask(db: Db, input: AgentTaskInput): Promise<void> {
  const statement = agentTaskInsertStatement(input);
  await db.query(statement.query, statement.params);
}

/**
 * The practice coordinator's autonomous request-draft step.  The draft is
 * prepared from the bank exception without a human; the resulting request is
 * still a draft that a professional must approve before it is sent to the
 * client, so the professional gate is preserved downstream.
 */
export function requestDraftAgentTaskStatement(input: {
  firmId: string;
  clientId: string;
  requestId: string;
  requestType: string;
  title: string;
  relatedBankTransactionId: string;
}): DbStatement {
  return agentTaskInsertStatement({
    firmId: input.firmId,
    clientId: input.clientId,
    sourceType: "client_request",
    sourceId: input.requestId,
    agentName: "practice_coordinator",
    actionType: "request_draft",
    autonomy: "autonomous",
    confidence: null,
    recommendation: {
      requestType: input.requestType,
      title: input.title,
      relatedBankTransactionId: input.relatedBankTransactionId,
      status: "draft",
      reason: "Prepared automatically from a bank exception; the professional approves the request before it goes to the client.",
    },
  });
}

export async function delegateReceiptAgents(
  db: Db,
  input: {
    firmId: string; clientId: string; receiptId: string; confidence: number | null;
    merchant: string | null; category: string | null; total: number | null; validationStatus: string;
  },
): Promise<void> {
  await Promise.all([
    delegateAgentTask(db, {
      ...input, sourceType: "receipt", sourceId: input.receiptId, agentName: "intake_specialist",
      actionType: "extract_and_validate", autonomy: "autonomous", confidence: input.confidence,
      recommendation: { merchant: input.merchant, total: input.total, validationStatus: input.validationStatus },
    }),
    delegateAgentTask(db, {
      ...input, sourceType: "receipt", sourceId: input.receiptId, agentName: "practice_coordinator",
      actionType: "categorization_review", autonomy: "approval_required", confidence: input.confidence,
      recommendation: { category: input.category, merchant: input.merchant, reason: "AI extraction and client correction memory; professional approval required." },
    }),
  ]);
}

export async function delegateBankImportAgent(db: Db, input: {
  firmId: string; clientId: string; importBatchId: string; insertedCount: number; duplicateCount: number;
}): Promise<void> {
  await delegateAgentTask(db, {
    ...input, sourceType: "bank_import", sourceId: input.importBatchId,
    agentName: "reconciliation_specialist", actionType: "triage_bank_import",
    autonomy: "approval_required",
    recommendation: { insertedCount: input.insertedCount, duplicateCount: input.duplicateCount, reason: "Matches and dispositions are suggestions until approved." },
  });
}
