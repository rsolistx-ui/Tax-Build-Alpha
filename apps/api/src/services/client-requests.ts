import type { Db, DbStatement } from "../db";
import { newId } from "../lib/id";
import { workAuditEventStatement } from "./work-audit";
import { getWorkItem, workItemInsertStatement, workItemStatusUpdateStatements, type CreateWorkItemInput } from "./work-items";

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
  due_at: string | null;
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

const DEFAULT_REMINDER_DELAY_DAYS = 5;

export function nextReminderAfterSend(from: Date = new Date()): Date {
  return new Date(from.getTime() + DEFAULT_REMINDER_DELAY_DAYS * 24 * 60 * 60 * 1000);
}

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

export type CreateClientRequestInput = {
  firmId: string;
  clientId: string;
  requestType: string;
  title: string;
  description?: string | null;
  status?: "draft" | "requested";
  sourceType?: string;
  sourceId?: string | null;
  relatedBankTransactionId?: string | null;
  dueAt?: string | null;
};

/**
 * actorUserId is the real professional (or null for a genuine system-
 * originated request) - created_by_user_id always records who actually
 * created the row, and approved_by_user_id is only ever that same real
 * actor when the request is already "requested" at creation time, never
 * a literal "system" placeholder string.
 */
export function clientRequestInsertStatement(
  id: string,
  workItemId: string,
  actorUserId: string | null,
  input: CreateClientRequestInput,
): DbStatement {
  const status = input.status ?? "requested";
  const now = new Date();
  const approvedAt = status === "requested" ? now.toISOString() : null;
  const approvedByUserId = status === "requested" ? actorUserId : null;
  const nextReminderAt = status === "requested" ? nextReminderAfterSend(now).toISOString() : null;

  return {
    query: `INSERT INTO client_requests
      (id, firm_id, client_id, work_item_id, request_type, title, description, status,
       source_type, source_id, related_bank_transaction_id, due_at, created_by_user_id,
       approved_by_user_id, approved_at, next_reminder_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    params: [
      id, input.firmId, input.clientId, workItemId, input.requestType, input.title, input.description ?? null,
      status, input.sourceType ?? "manual", input.sourceId ?? null, input.relatedBankTransactionId ?? null,
      input.dueAt ?? null, actorUserId, approvedByUserId, approvedAt, nextReminderAt,
    ],
  };
}

/**
 * Creates the linked work item and the client request as a single atomic
 * transaction, so a failure creating one never leaves the other orphaned -
 * closes the audit finding that a request-creation failure could strand a
 * work item with no request. Used both for manually created requests
 * (professional supplies everything) and for exception-prepared requests
 * that a professional then approves via approveDraftRequest.
 */
export async function createClientRequest(
  db: Db,
  actorUserId: string | null,
  input: CreateClientRequestInput,
): Promise<ClientRequestRow> {
  const id = newId("creq");
  const workItemId = newId("wi");
  const status = input.status ?? "requested";

  // A request created already-"requested" (manual send, or an approved
  // draft folded into this same insert path) puts its work item straight
  // into waiting_on_client, matching the required state chain. A draft's
  // work item stays "open" and actionable for the professional until
  // approveDraftRequest sends it.
  const workItemInput: CreateWorkItemInput = {
    firmId: input.firmId,
    clientId: input.clientId,
    title: input.title,
    workType: "client_request",
    status: status === "requested" ? "waiting_on_client" : "open",
    sourceType: "client_request",
    sourceId: id,
    clientVisible: true,
    dueAt: input.dueAt ?? null,
  };

  const statements: DbStatement[] = [
    workItemInsertStatement(workItemId, workItemInput),
    workAuditEventStatement({
      firmId: input.firmId,
      entityType: "work_item",
      entityId: workItemId,
      action: "work_item_created",
      actorUserId,
      afterJson: { title: input.title, sourceType: "client_request" },
    }),
    clientRequestInsertStatement(id, workItemId, actorUserId, input),
    workAuditEventStatement({
      firmId: input.firmId,
      entityType: "client_request",
      entityId: id,
      action: status === "draft" ? "request_drafted" : "request_created",
      actorUserId,
      afterJson: { requestType: input.requestType, title: input.title, sourceType: input.sourceType ?? "manual" },
    }),
  ];

  await db.transaction(statements);

  const created = await getClientRequest(db, id, input.firmId);
  if (!created) throw new Error("Client request was not created");
  return created;
}

/**
 * draft -> requested. Moves the linked work item to waiting_on_client in
 * the same transaction (it was "open" while still a draft) and schedules
 * the first reminder, closing the audit finding that approval never
 * touched work-item state.
 */
export async function approveDraftRequest(
  db: Db,
  requestId: string,
  firmId: string,
  actorUserId: string,
): Promise<ClientRequestRow | undefined> {
  const current = await getClientRequest(db, requestId, firmId);
  if (!current || current.status !== "draft") return current;

  const nextReminderAt = nextReminderAfterSend().toISOString();
  const statements: DbStatement[] = [
    {
      query: `UPDATE client_requests SET status = 'requested', approved_by_user_id = $1, approved_at = NOW(), next_reminder_at = $2, updated_at = NOW() WHERE id = $3 AND firm_id = $4`,
      params: [actorUserId, nextReminderAt, requestId, firmId],
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
  ];
  if (current.work_item_id) {
    statements.push(
      {
        query: `UPDATE work_items SET status = 'waiting_on_client', updated_at = NOW() WHERE id = $1 AND firm_id = $2`,
        params: [current.work_item_id, firmId],
      },
      workAuditEventStatement({
        firmId,
        entityType: "work_item",
        entityId: current.work_item_id,
        action: "work_item_status_changed",
        actorUserId,
        beforeJson: { status: "open" },
        afterJson: { status: "waiting_on_client" },
      }),
    );
  }

  await db.transaction(statements);
  return getClientRequest(db, requestId, firmId);
}

/**
 * requested -> viewed. The linked work item stays waiting_on_client: a
 * client opening a request is not yet a response. The UPDATE only
 * matches (and only then does the audit event fire) when status is
 * actually 'requested' - opening an already-viewed request repeatedly
 * produces no further transition and no duplicate audit event.
 */
export async function markRequestViewed(db: Db, requestId: string, firmId: string): Promise<void> {
  // A single CTE-chained statement, not two separate queries: the audit
  // INSERT only runs (via the SELECT ... FROM updated) when the UPDATE
  // actually matched a row, and both happen as one atomic Postgres
  // statement - a mid-failure can never leave a real transition with no
  // audit trail, and repeatedly viewing an already-viewed request writes
  // nothing at all.
  await db.query(
    `WITH updated AS (
       UPDATE client_requests SET status = 'viewed', viewed_at = COALESCE(viewed_at, NOW()), updated_at = NOW()
       WHERE id = $1 AND firm_id = $2 AND status = 'requested'
       RETURNING id
     )
     INSERT INTO work_audit_events (id, firm_id, entity_type, entity_id, action, actor_user_id, before_json, after_json)
     SELECT $3, $2, 'client_request', $1, 'request_viewed', NULL, $4::jsonb, $5::jsonb
     FROM updated`,
    [requestId, firmId, newId("wae"), { status: "requested" }, { status: "viewed" }],
  );
}

/**
 * Client reply or evidence upload -> responded. The linked work item moves
 * from waiting_on_client back to in_progress so it lands on the
 * professional's queue for action - work_items has no "professional_review"
 * status value, so in_progress is the schema-valid stand-in for "back with
 * the professional." Never sets accounting treatment: only satisfyRequest,
 * a professional action, can close the request.
 */
export async function respondToRequest(db: Db, requestId: string, firmId: string): Promise<void> {
  const current = await getClientRequest(db, requestId, firmId);
  // A closed request (satisfied or cancelled) never reopens from a client
  // message or evidence upload - only a professional action can undo a
  // terminal state, and no such action exists today.
  if (!current || current.status === "satisfied" || current.status === "cancelled") return;

  const statements: DbStatement[] = [
    {
      query: `UPDATE client_requests SET status = 'responded', responded_at = NOW(), next_reminder_at = NULL, updated_at = NOW() WHERE id = $1 AND firm_id = $2`,
      params: [requestId, firmId],
    },
    workAuditEventStatement({
      firmId,
      entityType: "client_request",
      entityId: requestId,
      action: "request_responded",
      actorUserId: null,
    }),
  ];
  if (current.work_item_id) {
    const workItem = await getWorkItem(db, current.work_item_id, firmId);
    if (workItem && workItem.status !== "complete") {
      statements.push(...workItemStatusUpdateStatements(workItem, current.work_item_id, firmId, null, "in_progress"));
    }
  }
  await db.transaction(statements);
}

/**
 * The professional's final disposition. Marking satisfied never happens
 * automatically from a client response alone - only a professional action
 * reaches "satisfied", per the rule that client input never silently sets
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
  // A cancelled request can never be resurrected as satisfied - mirrors
  // cancelRequest's own no-op guard on the reverse transition.
  if (!current || current.status === "satisfied" || current.status === "cancelled") return current;

  const statements: DbStatement[] = [
    {
      query: `UPDATE client_requests SET status = 'satisfied', satisfied_at = NOW(), next_reminder_at = NULL, updated_at = NOW() WHERE id = $1 AND firm_id = $2`,
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
  ];

  if (current.work_item_id) {
    const workItem = await getWorkItem(db, current.work_item_id, firmId);
    if (workItem) {
      statements.push(...workItemStatusUpdateStatements(workItem, current.work_item_id, firmId, actorUserId, "complete"));
    }
  }

  await db.transaction(statements);
  return getClientRequest(db, requestId, firmId);
}

/**
 * Cancels a request that no longer needs a client response. The linked
 * work item is cancelled too (unless it already completed some other way)
 * so cancelling a request never leaves stale "waiting on client" work
 * sitting on the queue. Clearing next_reminder_at stops a cancelled
 * request from ever being selected by listRequestsDueForReminder. A
 * cancelled request does not hold the exception-idempotency slot (see
 * migration 0012's uq_requests_active_bank_txn), so a fresh request can
 * always be prepared afterward for the same transaction.
 */
export async function cancelRequest(
  db: Db,
  requestId: string,
  firmId: string,
  actorUserId: string,
): Promise<ClientRequestRow | undefined> {
  const current = await getClientRequest(db, requestId, firmId);
  if (!current || current.status === "satisfied" || current.status === "cancelled") return current;

  const statements: DbStatement[] = [
    {
      query: `UPDATE client_requests SET status = 'cancelled', next_reminder_at = NULL, updated_at = NOW() WHERE id = $1 AND firm_id = $2`,
      params: [requestId, firmId],
    },
    workAuditEventStatement({
      firmId,
      entityType: "client_request",
      entityId: requestId,
      action: "request_cancelled",
      actorUserId,
      beforeJson: { status: current.status },
      afterJson: { status: "cancelled" },
    }),
  ];

  if (current.work_item_id) {
    const workItem = await getWorkItem(db, current.work_item_id, firmId);
    if (workItem && workItem.status !== "complete") {
      statements.push(...workItemStatusUpdateStatements(workItem, current.work_item_id, firmId, actorUserId, "cancelled"));
    }
  }

  await db.transaction(statements);
  return getClientRequest(db, requestId, firmId);
}
