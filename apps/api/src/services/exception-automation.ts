import type { Db, DbStatement } from "../db";
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

const ACTIVE_BANK_TXN_UNIQUE_CONSTRAINT = "uq_requests_active_bank_txn";

/**
 * Fully atomic, race-safe prepare: the work item, its audit event, the
 * client request (already referencing that work item), and the request's
 * audit event are all one db.transaction() call. If a concurrent call has
 * already claimed migration 0012's uq_requests_active_bank_txn partial
 * unique index for this transaction, the whole transaction - work item
 * included - rolls back atomically; there is no window where a work item
 * can be left behind without its request. Only a failure that is
 * specifically that unique-constraint conflict is treated as "lost the
 * race" and resolved by returning the existing active request; any other
 * database failure propagates unchanged.
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
  const requestId = newId("creq");
  const workItemId = newId("wi");

  const statements: DbStatement[] = [
    workItemInsertStatement(workItemId, {
      firmId,
      clientId: transaction.client_id,
      title,
      workType: "client_request",
      sourceType: "client_request",
      sourceId: requestId,
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
      query: `INSERT INTO client_requests
        (id, firm_id, client_id, work_item_id, request_type, title, description, status,
         source_type, source_id, related_bank_transaction_id, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', 'bank_exception', $8, $8, $9)`,
      params: [requestId, firmId, transaction.client_id, workItemId, requestType, title, description, transaction.id, actorUserId],
    },
    workAuditEventStatement({
      firmId,
      entityType: "client_request",
      entityId: requestId,
      action: "request_drafted",
      actorUserId,
      afterJson: { requestType, title, sourceType: "bank_exception" },
    }),
  ];

  try {
    await db.transaction(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(ACTIVE_BANK_TXN_UNIQUE_CONSTRAINT)) {
      throw error;
    }
    // Lost the race: another call already holds the active-request slot
    // for this transaction. The whole attempted transaction above,
    // including its work item insert, was rolled back by the database -
    // nothing here needs manual cleanup.
    const [existing] = await db.query<ClientRequestRow>(
      `SELECT * FROM client_requests WHERE related_bank_transaction_id = $1 AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1`,
      [transaction.id],
    );
    if (!existing) throw new Error("Exception request slot is claimed but no active request could be found");
    return existing;
  }

  const created = await getClientRequest(db, requestId, firmId);
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
