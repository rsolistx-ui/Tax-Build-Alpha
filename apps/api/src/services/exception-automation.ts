import type { Db } from "../db";
import { newId } from "../lib/id";
import { workAuditEventStatement } from "./work-audit";
import { workItemInsertStatement } from "./work-items";
import { getClientRequest, type ClientRequestRow } from "./client-requests";

export type BankExceptionRow = {
  id: string;
  client_id: string;
  txn_date: string | null;
  description: string | null;
  amount: string | null;
  triage: string | null;
  pending_receipt_id: string | null;
};

/**
 * Race-safe, two-phase prepare: phase 1 claims the "one active request per
 * bank transaction" slot with a single INSERT ... ON CONFLICT DO NOTHING
 * against migration 0012's uq_requests_active_bank_txn partial unique
 * index, so two concurrent prepare calls for the same transaction cannot
 * both succeed - the database rejects the second insert outright, this is
 * not a SELECT-then-INSERT check that merely makes duplicates unlikely.
 * Only if phase 1 actually claimed the slot does phase 2 atomically create
 * the linked work item, its audit event, the request's audit event, and
 * attach the work item to the request. Draft status: a professional must
 * approve before the client ever sees it.
 */
async function prepareDraftRequest(
  db: Db,
  firmId: string,
  actorUserId: string | null,
  transaction: BankExceptionRow,
  requestType: "missing_receipt" | "transaction_explanation",
  title: string,
  description: string,
): Promise<ClientRequestRow> {
  const id = newId("creq");

  const claim = await db.query<{ id: string }>(
    `INSERT INTO client_requests
      (id, firm_id, client_id, work_item_id, request_type, title, description, status,
       source_type, source_id, related_bank_transaction_id, created_by_user_id)
     VALUES ($1, $2, $3, NULL, $4, $5, $6, 'draft', 'bank_exception', $7, $7, $8)
     ON CONFLICT (related_bank_transaction_id) WHERE related_bank_transaction_id IS NOT NULL AND status != 'cancelled'
     DO NOTHING
     RETURNING id`,
    [id, firmId, transaction.client_id, requestType, title, description, transaction.id, actorUserId],
  );

  if (claim.length === 0) {
    // Another call already holds the active-request slot for this
    // transaction (or won the race a moment ago); return that row instead
    // of creating a duplicate.
    const [existing] = await db.query<ClientRequestRow>(
      `SELECT * FROM client_requests WHERE related_bank_transaction_id = $1 AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1`,
      [transaction.id],
    );
    if (!existing) throw new Error("Exception request slot claimed but no row could be found");
    return existing;
  }

  const workItemId = newId("wi");
  await db.transaction([
    workItemInsertStatement(workItemId, {
      firmId,
      clientId: transaction.client_id,
      title,
      workType: "client_request",
      sourceType: "client_request",
      sourceId: id,
      clientVisible: true,
    }),
    workAuditEventStatement({
      firmId,
      entityType: "work_item",
      entityId: workItemId,
      action: "work_item_created",
      actorUserId,
      afterJson: { title, sourceType: "client_request" },
    }),
    {
      query: `UPDATE client_requests SET work_item_id = $1, updated_at = NOW() WHERE id = $2`,
      params: [workItemId, id],
    },
    workAuditEventStatement({
      firmId,
      entityType: "client_request",
      entityId: id,
      action: "request_drafted",
      actorUserId,
      afterJson: { requestType, title, sourceType: "bank_exception" },
    }),
  ]);

  const created = await getClientRequest(db, id, firmId);
  if (!created) throw new Error("Client request was not created");
  return created;
}

export async function prepareMissingReceiptRequest(
  db: Db,
  firmId: string,
  actorUserId: string | null,
  transaction: BankExceptionRow,
): Promise<ClientRequestRow> {
  const description = transaction.description || "this transaction";
  const amount = transaction.amount ?? "";
  const date = transaction.txn_date ?? "";
  return prepareDraftRequest(
    db,
    firmId,
    actorUserId,
    transaction,
    "missing_receipt",
    `Receipt needed: ${description}`,
    `A receipt is needed for the ${date} transaction of ${amount} (${description}).`,
  );
}

export async function prepareTransactionExplanationRequest(
  db: Db,
  firmId: string,
  actorUserId: string | null,
  transaction: BankExceptionRow,
): Promise<ClientRequestRow> {
  const description = transaction.description || "this transaction";
  const amount = transaction.amount ?? "";
  const date = transaction.txn_date ?? "";
  return prepareDraftRequest(
    db,
    firmId,
    actorUserId,
    transaction,
    "transaction_explanation",
    `Explanation needed: ${description}`,
    `Please explain the ${date} transaction of ${amount} (${description}) so it can be categorized correctly.`,
  );
}
