import type { Db } from "../db";
import { createClientRequest, type ClientRequestRow } from "./client-requests";

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
 * Prepares (does not send) a client request for a bank transaction that
 * needs a receipt. Created in "draft" status: a professional must approve
 * it before the client ever sees it, per the milestone's explicit
 * approval-in-the-loop requirement. Idempotent per transaction: if a
 * non-cancelled request already exists for this transaction, it is
 * returned instead of creating a duplicate.
 */
export async function prepareMissingReceiptRequest(
  db: Db,
  firmId: string,
  actorUserId: string | null,
  transaction: BankExceptionRow,
): Promise<ClientRequestRow> {
  const [existing] = await db.query<ClientRequestRow>(
    `SELECT * FROM client_requests WHERE related_bank_transaction_id = $1 AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1`,
    [transaction.id],
  );
  if (existing) return existing;

  const description = transaction.description || "this transaction";
  const amount = transaction.amount ?? "";
  const date = transaction.txn_date ?? "";
  return createClientRequest(db, actorUserId, {
    firmId,
    clientId: transaction.client_id,
    requestType: "missing_receipt",
    title: `Receipt needed: ${description}`,
    description: `A receipt is needed for the ${date} transaction of ${amount} (${description}).`,
    status: "draft",
    sourceType: "bank_exception",
    sourceId: transaction.id,
    relatedBankTransactionId: transaction.id,
  });
}

/**
 * Prepares a request asking the client to explain an unclear transaction.
 * Same draft-then-approve pattern as the missing-receipt path. The
 * professional's response to what the client says is a separate, later
 * disposition action - a client's reply never sets accounting treatment by
 * itself.
 */
export async function prepareTransactionExplanationRequest(
  db: Db,
  firmId: string,
  actorUserId: string | null,
  transaction: BankExceptionRow,
): Promise<ClientRequestRow> {
  const [existing] = await db.query<ClientRequestRow>(
    `SELECT * FROM client_requests WHERE related_bank_transaction_id = $1 AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1`,
    [transaction.id],
  );
  if (existing) return existing;

  const description = transaction.description || "this transaction";
  const amount = transaction.amount ?? "";
  const date = transaction.txn_date ?? "";
  return createClientRequest(db, actorUserId, {
    firmId,
    clientId: transaction.client_id,
    requestType: "transaction_explanation",
    title: `Explanation needed: ${description}`,
    description: `Please explain the ${date} transaction of ${amount} (${description}) so it can be categorized correctly.`,
    status: "draft",
    sourceType: "bank_exception",
    sourceId: transaction.id,
    relatedBankTransactionId: transaction.id,
  });
}
