import type { Db, DbStatement } from "../db";
import { newId } from "../lib/id";
import { workAuditEventStatement } from "./work-audit";

export type WorkItemRow = {
  id: string;
  firm_id: string;
  client_id: string;
  engagement_id: string | null;
  title: string;
  description: string | null;
  work_type: string;
  status: string;
  priority: string;
  due_at: string | null;
  assigned_user_id: string | null;
  source_type: string;
  source_id: string | null;
  client_visible: boolean;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
};

export type WorkQueueFilter = {
  clientId?: string;
  engagementId?: string;
  assignedUserId?: string;
  status?: string;
  priority?: string;
  view?: "overdue" | "due_today" | "due_soon" | "waiting_on_client" | "professional_review" | "blocked" | "recently_completed";
  cursor?: string;
  limit?: number;
};

const MAX_PAGE_SIZE = 100;

export type CreateWorkItemInput = {
  firmId: string;
  clientId: string;
  engagementId?: string | null;
  title: string;
  description?: string | null;
  workType?: string;
  status?: string;
  priority?: string;
  dueAt?: string | null;
  assignedUserId?: string | null;
  sourceType?: string;
  sourceId?: string | null;
  clientVisible?: boolean;
};

/**
 * Pure statement builder, no I/O. Lets a caller (createWorkItem below, or
 * createClientRequest in client-requests.ts) fold a work-item insert into
 * its own larger db.transaction() call so a request and its work item are
 * never left half-created if the other insert fails.
 */
export function workItemInsertStatement(id: string, input: CreateWorkItemInput): DbStatement {
  return {
    query: `INSERT INTO work_items
      (id, firm_id, client_id, engagement_id, title, description, work_type, status, priority, due_at, assigned_user_id, source_type, source_id, client_visible)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    params: [
      id, input.firmId, input.clientId, input.engagementId ?? null, input.title, input.description ?? null,
      input.workType ?? "general", input.status ?? "open", input.priority ?? "normal", input.dueAt ?? null,
      input.assignedUserId ?? null, input.sourceType ?? "manual", input.sourceId ?? null, input.clientVisible ?? false,
    ],
  };
}

export async function createWorkItem(
  db: Db,
  actorUserId: string | null,
  input: CreateWorkItemInput,
): Promise<WorkItemRow> {
  const id = newId("wi");
  await db.transaction([
    workItemInsertStatement(id, input),
    workAuditEventStatement({
      firmId: input.firmId,
      entityType: "work_item",
      entityId: id,
      action: "work_item_created",
      actorUserId,
      afterJson: { title: input.title, sourceType: input.sourceType ?? "manual" },
    }),
  ]);
  const [row] = await db.query<WorkItemRow>(`SELECT * FROM work_items WHERE id = $1`, [id]);
  if (!row) throw new Error("Work item was not created");
  return row;
}

export async function getWorkItem(db: Db, workItemId: string, firmId: string): Promise<WorkItemRow | undefined> {
  const [row] = await db.query<WorkItemRow>(
    `SELECT * FROM work_items WHERE id = $1 AND firm_id = $2`,
    [workItemId, firmId],
  );
  return row;
}

/**
 * Pure statement builder (update + audit, 2 statements), no I/O. Lets a
 * caller such as satisfyRequest/cancelRequest in client-requests.ts fold a
 * work-item status change into its own larger db.transaction() call so the
 * request transition and the work-item transition (and both of their audit
 * events) commit as a single atomic unit instead of two separate
 * round-trips.
 */
export function workItemStatusUpdateStatements(
  current: Pick<WorkItemRow, "status">,
  workItemId: string,
  firmId: string,
  actorUserId: string | null,
  status: string,
): DbStatement[] {
  const completedAtClause = status === "complete" ? "NOW()" : "NULL";
  return [
    {
      query: `UPDATE work_items SET status = $1, completed_at = ${completedAtClause}, updated_at = NOW() WHERE id = $2 AND firm_id = $3`,
      params: [status, workItemId, firmId],
    },
    workAuditEventStatement({
      firmId,
      entityType: "work_item",
      entityId: workItemId,
      action: "work_item_status_changed",
      actorUserId,
      beforeJson: { status: current.status },
      afterJson: { status },
    }),
  ];
}

export async function updateWorkItemStatus(
  db: Db,
  workItemId: string,
  firmId: string,
  actorUserId: string | null,
  status: string,
): Promise<WorkItemRow | undefined> {
  const current = await getWorkItem(db, workItemId, firmId);
  if (!current) return undefined;

  await db.transaction(workItemStatusUpdateStatements(current, workItemId, firmId, actorUserId, status));
  return getWorkItem(db, workItemId, firmId);
}

/**
 * Firm-wide work queue with cursor pagination (created_at + id as the
 * cursor tuple) so no query ever loads a firm's entire work-item history.
 * View filters map to the practice-wide lenses required by the milestone:
 * overdue, due today, due soon, waiting on client, professional review,
 * blocked, recently completed.
 */
export async function queryWorkQueue(db: Db, firmId: string, filter: WorkQueueFilter) {
  const conditions: string[] = ["firm_id = $1"];
  const params: unknown[] = [firmId];

  function addCondition(column: string, value: unknown) {
    params.push(value);
    conditions.push(`${column} = $${params.length}`);
  }

  if (filter.clientId) addCondition("client_id", filter.clientId);
  if (filter.engagementId) addCondition("engagement_id", filter.engagementId);
  if (filter.assignedUserId) addCondition("assigned_user_id", filter.assignedUserId);
  if (filter.status) addCondition("status", filter.status);
  if (filter.priority) addCondition("priority", filter.priority);

  switch (filter.view) {
    case "overdue":
      conditions.push(`status NOT IN ('complete', 'cancelled') AND due_at IS NOT NULL AND due_at < NOW()`);
      break;
    case "due_today":
      conditions.push(`status NOT IN ('complete', 'cancelled') AND due_at IS NOT NULL AND due_at::date = CURRENT_DATE`);
      break;
    case "due_soon":
      conditions.push(`status NOT IN ('complete', 'cancelled') AND due_at IS NOT NULL AND due_at > NOW() AND due_at <= NOW() + INTERVAL '7 days'`);
      break;
    case "waiting_on_client":
      conditions.push(`status = 'waiting_on_client'`);
      break;
    case "professional_review":
      conditions.push(`work_type = 'review' AND status NOT IN ('complete', 'cancelled')`);
      break;
    case "blocked":
      conditions.push(`status = 'blocked'`);
      break;
    case "recently_completed":
      conditions.push(`status = 'complete' AND completed_at IS NOT NULL AND completed_at > NOW() - INTERVAL '14 days'`);
      break;
    default:
      // "All open" default: no view and no explicit status means open
      // work only. A caller that explicitly asks for a status (including
      // complete/cancelled) is respected instead - this default never
      // overrides an explicit status filter.
      if (!filter.status) {
        conditions.push(`status NOT IN ('complete', 'cancelled')`);
      }
      break;
  }

  if (filter.cursor) {
    const [createdAt, id] = filter.cursor.split("|");
    if (createdAt && id) {
      params.push(createdAt, id);
      const createdAtIndex = params.length - 1;
      const idIndex = params.length;
      conditions.push(`(created_at, id) < ($${createdAtIndex}::timestamptz, $${idIndex})`);
    }
  }

  const limit = Math.min(filter.limit ?? 50, MAX_PAGE_SIZE);
  const sql = `SELECT * FROM work_items WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`;
  const rows = await db.query<WorkItemRow>(sql, params);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? `${page[page.length - 1].created_at}|${page[page.length - 1].id}` : null;

  return { items: page, nextCursor };
}
