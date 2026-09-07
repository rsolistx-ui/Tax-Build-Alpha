import type { Db, DbStatement } from "../db";
import { newId } from "../lib/id";

export type BetaAccessEventInput = {
  action: string;
  actorUserId: string | null;
  affectedUserId: string | null;
  affectedEmail: string | null;
  beforeJson?: unknown;
  afterJson?: unknown;
  reason?: string | null;
};

/** Never pass a plaintext invitation token into beforeJson/afterJson/reason here. */
export function betaAccessEventStatement(input: BetaAccessEventInput): DbStatement {
  return {
    query: `INSERT INTO beta_access_events
      (id, action, actor_user_id, affected_user_id, affected_email, before_json, after_json, reason)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
    params: [
      newId("bae"),
      input.action,
      input.actorUserId,
      input.affectedUserId,
      input.affectedEmail,
      input.beforeJson ?? null,
      input.afterJson ?? null,
      input.reason ?? null,
    ],
  };
}

export async function insertBetaAccessEvent(db: Db, input: BetaAccessEventInput): Promise<void> {
  const statement = betaAccessEventStatement(input);
  await db.query(statement.query, statement.params);
}
