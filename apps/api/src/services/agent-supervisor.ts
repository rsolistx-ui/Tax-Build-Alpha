import type { Db, DbStatement } from "../db";
import { newId } from "../lib/id";

export const AGENT_POLICY = {
  autonomous: [
    "intake",
    "extraction",
    "matching_suggestion",
    "reminder_preparation",
    "request_draft",
    "work_queue_triage",
    "system_diagnostics",
    "self_healing_recovery",
  ],
  approvalRequired: ["categorization", "filing", "bank_disposition", "client_sync", "tax_accounting_conclusion"],
} as const;

type AgentTaskInput = {
  firmId: string;
  clientId: string;
  sourceType: "receipt" | "bank_import" | "bank_transaction" | "client_request" | "gmail_message" | "engagement_letter" | "extension" | "system_diagnostic";
  sourceId: string;
  agentName: "intake_specialist" | "reconciliation_specialist" | "practice_coordinator" | "reliability_engineer";
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

/**
 * Claim-statement for resolving a task.  The guarded UPDATE ... RETURNING is
 * the single point of truth for "this task is still awaiting approval", so
 * two simultaneous approvals cannot both win: only the request whose UPDATE
 * matches a row proceeds to the side effects, and a concurrent loser sees an
 * empty result and reports the task as already resolved.
 */
export function agentTaskResolveClaimStatement(input: {
  taskId: string;
  clientId: string;
  firmId: string;
  newStatus: "approved" | "dismissed";
  actorUserId: string;
  note: string | null;
}): DbStatement {
  return {
    query: `UPDATE agent_tasks
      SET status = $1,
          approved_by_user_id = CASE WHEN $1 = 'approved' THEN $2 ELSE NULL END,
          approved_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE NULL END,
          resolved_at = NOW(),
          resolution_note = $3,
          updated_at = NOW()
      WHERE id = $4 AND client_id = $5 AND firm_id = $6 AND status = 'awaiting_approval'
      RETURNING id`,
    params: [input.newStatus, input.actorUserId, input.note, input.taskId, input.clientId, input.firmId],
  };
}

export function agentResolveAuditStatement(input: {
  clientId: string;
  actorUserId: string;
  task: { id: string; action_type: string; recommendation_json: Record<string, unknown> };
  decision: "approve" | "dismiss";
}): DbStatement {
  return {
    query: `INSERT INTO audit_events (id, client_id, actor_user_id, action, after_json)
      VALUES ($1, $2, $3, 'agent_recommendation_reviewed', $4::jsonb)`,
    params: [
      newId("aud"),
      input.clientId,
      input.actorUserId,
      { agentTaskId: input.task.id, decision: input.decision, actionType: input.task.action_type, recommendation: input.task.recommendation_json },
    ],
  };
}

/**
 * The material side effects of approving a categorization_review for a
 * receipt: apply the category to the receipt, audit the application, and
 * teach merchant memory that this merchant maps to this category.  Pure
 * statement builder - the route resolves the category id (a read) and then
 * commits these statements atomically with the resolution audit.
 */
export function categorizationApprovalStatements(input: {
  clientId: string;
  actorUserId: string;
  receiptId: string;
  merchant: string | null;
  categoryHint: string | null;
  categoryId: string | null;
}): DbStatement[] {
  const merchant = input.merchant;
  const categoryHint = input.categoryHint;
  const statements: DbStatement[] = [];
  if (!categoryHint || !input.categoryId) return statements;
  statements.push(
    {
      query: `UPDATE receipts SET category_id = $1, updated_at = NOW() WHERE id = $2 AND client_id = $3`,
      params: [input.categoryId, input.receiptId, input.clientId],
    },
    {
      query: `INSERT INTO audit_events (id, client_id, receipt_id, actor_user_id, action, after_json)
        VALUES ($1, $2, $3, $4, 'receipt_category_applied', $5::jsonb)`,
      params: [newId("aud"), input.clientId, input.receiptId, input.actorUserId, { categoryId: input.categoryId, category: categoryHint, from: "agent_approval" }],
    },
  );
  if (merchant) {
    statements.push({
      query: `INSERT INTO correction_rules
        (id, client_id, rule_type, match_key, output_json, seen_count, last_applied_at)
        VALUES ($1, $2, 'merchant_category', $3, $4::jsonb, 1, NOW())
        ON CONFLICT (client_id, rule_type, match_key) DO UPDATE SET
          output_json = EXCLUDED.output_json,
          seen_count = correction_rules.seen_count + 1,
          last_applied_at = NOW(),
          updated_at = NOW()`,
      params: [newId("rule"), input.clientId, normalizeMerchant(merchant), { category: categoryHint }],
    });
  }
  return statements;
}

export function normalizeMerchant(merchant: string): string {
  return merchant.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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

/**
 * Inbound-email triage: an email from a known client's address becomes a
 * follow-up task on approval, never an autonomous reply or action. Idempotent
 * on (clientId, gmailMessageId) via the same unique constraint every other
 * agent task uses, so re-scanning the inbox never double-creates a task for
 * a message already triaged.
 */
export function gmailTriageAgentTaskStatement(input: {
  firmId: string;
  clientId: string;
  gmailMessageId: string;
  gmailThreadId: string;
  fromEmail: string;
  subject: string;
  snippet: string;
}): DbStatement {
  return agentTaskInsertStatement({
    firmId: input.firmId,
    clientId: input.clientId,
    sourceType: "gmail_message",
    sourceId: input.gmailMessageId,
    agentName: "practice_coordinator",
    actionType: "email_triage",
    autonomy: "approval_required",
    recommendation: {
      gmailMessageId: input.gmailMessageId,
      gmailThreadId: input.gmailThreadId,
      fromEmail: input.fromEmail,
      subject: input.subject,
      snippet: input.snippet,
      reason: "Matched to this client by their email address on file. Approving creates a follow-up task; nothing is sent or actioned automatically.",
    },
  });
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

/**
 * Engagement letter draft: when an engagement is ready, create an
 * approval-required task for the professional to review the letter
 * before it's sent to the client via DocuSign.
 */
export function engagementLetterDraftAgentTaskStatement(input: {
  firmId: string;
  clientId: string;
  engagementId: string;
  fee?: string | null;
}): DbStatement {
  return agentTaskInsertStatement({
    firmId: input.firmId,
    clientId: input.clientId,
    sourceType: "engagement_letter",
    sourceId: input.engagementId,
    agentName: "practice_coordinator",
    actionType: "engagement_letter_draft",
    autonomy: "approval_required",
    confidence: null,
    recommendation: {
      engagementId: input.engagementId,
      fee: input.fee ?? null,
      status: "draft",
      reason: "Engagement letter ready for professional review before sending to client via DocuSign.",
    },
  });
}
