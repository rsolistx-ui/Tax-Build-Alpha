import type { Db, DbStatement } from "../db";
import { newId } from "../lib/id";

export type WorkAuditEventInput = {
  firmId: string;
  entityType: string;
  entityId: string;
  action: string;
  actorUserId: string | null;
  beforeJson?: unknown;
  afterJson?: unknown;
};

export function workAuditEventStatement(input: WorkAuditEventInput): DbStatement {
  return {
    query: `INSERT INTO work_audit_events
      (id, firm_id, entity_type, entity_id, action, actor_user_id, before_json, after_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
    params: [
      newId("wae"),
      input.firmId,
      input.entityType,
      input.entityId,
      input.action,
      input.actorUserId,
      input.beforeJson ?? null,
      input.afterJson ?? null,
    ],
  };
}

export async function insertWorkAuditEvent(db: Db, input: WorkAuditEventInput): Promise<void> {
  const statement = workAuditEventStatement(input);
  await db.query(statement.query, statement.params);
}
