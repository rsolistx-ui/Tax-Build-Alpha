import type { Db } from "../db";
import { newId } from "../lib/id";
import { workAuditEventStatement } from "./work-audit";
import { createWorkItem, updateWorkItemStatus } from "./work-items";

export type ClientRequestRow = {
  id: string;
  firm_id: string;
  client_id: string;
  work_item_id: string | null;
  request_type: string;
  title: string;
  description: string | null;
  status: string;
  source_type: string;
  source_id: string | null;
  related_bank_transaction_id: string | null;
  created_by_user_id: string | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
  viewed_at: string | null;
  responded_at: string | null;
  satisfied_at: string | null;
  next_reminder_at: string | null;
  reminder_count: number;
  last_reminded_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function listRequestsDueForReminder(db: Db, firmId: string, asOf: Date = new Date()): Promise<ClientRequestRow[]> {
  return db.query<ClientRequestRow>(
    `SELECT * FROM client_requests WHERE firm_id = $1 AND status IN ('requested', 'viewed') AND next_reminder_at IS NOT NULL AND next_reminder_at <= $2 ORDER BY next_reminder_at ASC`,
    [firmId, asOf.toISOString()],
  );
}

export async function listClientRequests(db: Db, firmId: string, clientId?: string): Promise<ClientRequestRow[]> {
  if (clientId) {
    return db.query<ClientRequestRow>(
      `SELECT * FROM client_requests WHERE firm_id = $1 AND client_id = $2 ORDER BY created_at DESC`,
      [firmId, clientId],
    );
  }
  return db.query<ClientRequestRow>(
    `SELECT * FROM client_requests WHERE firm_id = $1 ORDER BY created_at DESC`,
    [firmId],
  );
}

export async function getClientRequest(db: Db, requestId: string, firmId: string): Promise<ClientRequestRow | undefined> {
  const [row] = await db.query<ClientRequestRow>(
    `SELECT * FROM client_requests WHERE id = $1 AND firm_id = $2`,
    [requestId, firmId],
  );
  return row;
}

/**
 * Creates a request already in "requested" status, tied to a work item that
 * tracks it on the practice work queue. Used both for manually created
 * requests (professional supplies everything) and for exception-prepared
 * requests that a professional then approves via approveDraftRequest.
 */
export async function createClientRequest(
  db: Db,
  actorUserId: string | null,
  input: {
    firmId: string;
    clientId: string;
    requestType: string;
    title: string;
    description?: string | null;
    status?: "draft" | "requested";
    sourceType?: string;
    sourceId?: string | null;
    relatedBankTransactionId?: string | null;
  },
): Promise<ClientRequestRow> {
  const id = newId("creq");
  const status = input.status ?? "requested";

  const workItem = await createWorkItem(db, actorUserId, {
    firmId: input.firmId,
    clientId: input.clientId,
    title: input.title,
    workType: "client_request",
    sourceType: "client_request",
    sourceId: id,
    clientVisible: true,
  });

  await db.transaction([
    {
      query: `INSERT INTO client_requests
        (id, firm_id, client_id, work_item_id, request_type, title, description, status,
         source_type, source_id, related_bank_transaction_id, created_by_user_id,
         approved_by_user_id, approved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      params: [
        id, input.firmId, input.clientId, workItem.id, input.requestType, input.title, input.description ?? null,
        status, input.sourceType ?? "manual", input.sourceId ?? null, input.relatedBankTransactionId ?? null,
        actorUserId, status === "requested" ? actorUserId : null, status === "requested" ? new Date().toISOString() : null,
      ],
    },
    workAuditEventStatement({
      firmId: input.firmId,
      entityType: "client_request",
      entityId: id,
      action: status === "draft" ? "request_drafted" : "request_created",
      actorUserId,
      afterJson: { requestType: input.requestType, title: input.title, sourceType: input.sourceType ?? "manual" },
    }),
  ]);

  const created = await getClientRequest(db, id, input.firmId);
  if (!created) throw new Error("Client request was not created");
  return created;
}

export async function approveDraftRequest(
  db: Db,
  requestId: string,
  firmId: string,
  actorUserId: string,
): Promise<ClientRequestRow | undefined> {
  const current = await getClientRequest(db, requestId, firmId);
  if (!current || current.status !== "draft") return current;

  await db.transaction([
    {
      query: `UPDATE client_requests SET status = 'requested', approved_by_user_id = $1, approved_at = NOW(), updated_at = NOW() WHERE id = $2 AND firm_id = $3`,
      params: [actorUserId, requestId, firmId],
    },
    workAuditEventStatement({
      firmId,
      entityType: "client_request",
      entityId: requestId,
      action: "request_approved",
      actorUserId,
      beforeJson: { status: "draft" },
      afterJson: { status: "requested" },
    }),
  ]);
  return getClientRequest(db, requestId, firmId);
}

export async function markRequestViewed(db: Db, requestId: string, firmId: string): Promise<void> {
  await db.query(
    `UPDATE client_requests SET status = CASE WHEN status = 'requested' THEN 'viewed' ELSE status END, viewed_at = COALESCE(viewed_at, NOW()), updated_at = NOW() WHERE id = $1 AND firm_id = $2`,
    [requestId, firmId],
  );
}

export async function respondToRequest(db: Db, requestId: string, firmId: string): Promise<void> {
  await db.transaction([
    {
      query: `UPDATE client_requests SET status = 'responded', responded_at = NOW(), updated_at = NOW() WHERE id = $1 AND firm_id = $2`,
      params: [requestId, firmId],
    },
    workAuditEventStatement({
      firmId,
      entityType: "client_request",
      entityId: requestId,
      action: "request_responded",
      actorUserId: null,
    }),
  ]);
}

/**
 * The professional's final disposition. Marking satisfied never happens
 * automatically from a client response alone - a client upload or reply
 * only moves a request to "responded"; only a professional action reaches
 * "satisfied", per the rule that client input never silently sets
 * accounting treatment. Completing the linked work item is part of the
 * same transaction so the audit chain and queue state move together.
 */
export async function satisfyRequest(
  db: Db,
  requestId: string,
  firmId: string,
  actorUserId: string,
): Promise<ClientRequestRow | undefined> {
  const current = await getClientRequest(db, requestId, firmId);
  if (!current) return undefined;

  await db.transaction([
    {
      query: `UPDATE client_requests SET status = 'satisfied', satisfied_at = NOW(), updated_at = NOW() WHERE id = $1 AND firm_id = $2`,
      params: [requestId, firmId],
    },
    workAuditEventStatement({
      firmId,
      entityType: "client_request",
      entityId: requestId,
      action: "request_satisfied",
      actorUserId,
      beforeJson: { status: current.status },
      afterJson: { status: "satisfied" },
    }),
  ]);

  if (current.work_item_id) {
    await updateWorkItemStatus(db, current.work_item_id, firmId, actorUserId, "complete");
  }

  return getClientRequest(db, requestId, firmId);
}
