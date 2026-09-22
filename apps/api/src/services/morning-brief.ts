import type { Db } from "../db";
import { agentTaskInsertStatement } from "./agent-supervisor";

export type MorningBriefResult = {
  clientsScanned: number;
  recommendationsCreated: number;
};

/**
 * Builds a concise, approval-only morning queue from records already in the
 * firm's books.  It does not invoke a model, alter accounting data, create a
 * client request, or send a message.  The professional sees recommendations
 * in the Agent Desk and decides what happens next.
 */
export async function prepareMorningBrief(db: Db, firmId: string): Promise<MorningBriefResult> {
  const clients = await db.query<{ id: string }>(`SELECT id FROM clients WHERE firm_id = $1`, [firmId]);
  let recommendationsCreated = 0;

  for (const client of clients) {
    const [unreadable] = await db.query<{ id: string; filename: string }>(
      `SELECT r.id, r.filename
       FROM receipts r
       WHERE r.client_id = $1
         AND (r.status IN ('review', 'failed') OR r.validation_status = 'fail')
         AND NOT EXISTS (
           SELECT 1 FROM agent_tasks at
           WHERE at.client_id = r.client_id AND at.source_type = 'receipt'
             AND at.source_id = r.id AND at.agent_name = 'practice_coordinator'
             AND at.action_type = 'receipt_review'
         )
       ORDER BY r.created_at ASC LIMIT 20`,
      [client.id],
    );
    if (unreadable) {
      const stmt = agentTaskInsertStatement({
        firmId,
        clientId: client.id,
        sourceType: "receipt",
        sourceId: unreadable.id,
        agentName: "practice_coordinator",
        actionType: "receipt_review",
        autonomy: "approval_required",
        confidence: null,
        recommendation: {
          filename: unreadable.filename,
          reason: "Receipt evidence needs a human check before it can be used in the books.",
        },
      });
      const inserted = await db.query<{ id: string }>(`${stmt.query} RETURNING id`, stmt.params);
      recommendationsCreated += inserted.length;
    }

    const missingEvidence = await db.query<{ id: string; description: string | null; amount: number | null }>(
      `SELECT bt.id, bt.description, bt.amount
       FROM bank_transactions bt
       WHERE bt.client_id = $1
         AND bt.triage IN ('unmatched', 'needs_review', 'likely_match', 'receipt_pending')
         AND NOT EXISTS (
           SELECT 1 FROM agent_tasks at
           WHERE at.client_id = bt.client_id AND at.source_type = 'bank_transaction'
             AND at.source_id = bt.id AND at.agent_name = 'practice_coordinator'
             AND at.action_type = 'missing_evidence_review'
         )
       ORDER BY bt.txn_date ASC NULLS LAST LIMIT 20`,
      [client.id],
    );
    for (const transaction of missingEvidence) {
      const stmt = agentTaskInsertStatement({
        firmId,
        clientId: client.id,
        sourceType: "bank_transaction",
        sourceId: transaction.id,
        agentName: "practice_coordinator",
        actionType: "missing_evidence_review",
        autonomy: "approval_required",
        confidence: 0.8,
        recommendation: {
          description: transaction.description,
          amount: transaction.amount,
          reason: "Bank activity has no linked evidence. Review before preparing a client request.",
        },
      });
      const inserted = await db.query<{ id: string }>(`${stmt.query} RETURNING id`, stmt.params);
      recommendationsCreated += inserted.length;
    }

    const extensions = await db.query<{ id: string; due_date: string; form_type: string }>(
      `SELECT id, due_date, form_type FROM tax_extensions
       WHERE client_id = $1 AND status = 'pending' AND due_date <= CURRENT_DATE + INTERVAL '7 days'
         AND NOT EXISTS (
           SELECT 1 FROM agent_tasks at
           WHERE at.client_id = tax_extensions.client_id AND at.source_type = 'extension'
             AND at.source_id = tax_extensions.id AND at.agent_name = 'practice_coordinator'
             AND at.action_type = 'extension_due_review'
         )`,
      [client.id],
    );
    for (const extension of extensions) {
      const stmt = agentTaskInsertStatement({
        firmId,
        clientId: client.id,
        sourceType: "extension",
        sourceId: extension.id,
        agentName: "practice_coordinator",
        actionType: "extension_due_review",
        autonomy: "approval_required",
        confidence: 0.95,
        recommendation: {
          formType: extension.form_type,
          dueDate: extension.due_date,
          reason: "A tax extension is due within seven days. Review the filing status.",
        },
      });
      const inserted = await db.query<{ id: string }>(`${stmt.query} RETURNING id`, stmt.params);
      recommendationsCreated += inserted.length;
    }
  }

  return { clientsScanned: clients.length, recommendationsCreated };
}
