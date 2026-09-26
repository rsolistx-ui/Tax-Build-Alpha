import { createDb, type Db } from "../db";
import type { Env } from "../env";
import { newId } from "../lib/id";
import { EmailDispatcherService, type RuleAlertPayload, type SupportContactPayload } from "./email-dispatcher";

export type OutboxOperationKind =
  | "support_client_confirmation"
  | "support_admin_alert"
  | "rule_client_confirmation"
  | "rule_admin_alert"
  | "rule_activation_confirmation";

type OutboxRow = {
  id: string;
  firm_id: string;
  operation_kind: OutboxOperationKind;
  payload: unknown;
  idempotency_key: string;
  attempt_count: number;
};

export type OutboxResult = { claimed: number; delivered: number; retried: number; deadLettered: number };

const MAX_ATTEMPTS = 8;
const STALE_CLAIM_MINUTES = 10;

export function retryDelaySeconds(attemptCount: number): number {
  return Math.min(60 * 60, 30 * 2 ** Math.max(0, attemptCount - 1));
}

export function enqueueOutboxStatements(input: {
  firmId: string;
  ticketNumber: string;
  operations: Array<{ kind: OutboxOperationKind; payload: unknown; key: string }>;
}) {
  return input.operations.map((operation) => ({
    query: `INSERT INTO operation_outbox (id, firm_id, operation_kind, payload, idempotency_key)
            VALUES ($1, $2, $3, $4::jsonb, $5)
            ON CONFLICT (idempotency_key) DO NOTHING`,
    params: [newId("outbox"), input.firmId, operation.kind, operation.payload, `${input.ticketNumber}:${operation.key}`],
  }));
}

export async function processDurableOutbox(env: Env, limit = 20): Promise<OutboxResult> {
  const db = createDb(env);
  const claimed = await claimDueOperations(db, limit);
  const result: OutboxResult = { claimed: claimed.length, delivered: 0, retried: 0, deadLettered: 0 };

  for (const operation of claimed) {
    try {
      const delivery = await deliverOperation(env, operation);
      if (!delivery.success) throw new Error(delivery.error || "Provider did not accept the operation");
      await db.query(
        `UPDATE operation_outbox
         SET status = 'delivered', delivered_at = NOW(), provider_message_id = $2,
             last_error = NULL, updated_at = NOW()
         WHERE id = $1 AND status = 'processing'`,
        [operation.id, delivery.messageId ?? null],
      );
      if (operation.operation_kind === "support_client_confirmation") {
        const ticketNumber = (operation.payload as { ticketNumber?: string }).ticketNumber;
        if (ticketNumber) {
          await db.query(
            `UPDATE support_tickets SET status = 'auto_responded', auto_responded_at = NOW()
             WHERE id = $1 AND firm_id = $2 AND status = 'pending_delivery'`,
            [ticketNumber, operation.firm_id],
          );
        }
      }
      result.delivered += 1;
    } catch (error) {
      const deadLetter = operation.attempt_count >= MAX_ATTEMPTS;
      const delay = retryDelaySeconds(operation.attempt_count);
      await db.query(
        `UPDATE operation_outbox
         SET status = $2, last_error = $3,
             next_attempt_at = CASE WHEN $2 = 'pending' THEN NOW() + ($4 * INTERVAL '1 second') ELSE next_attempt_at END,
             updated_at = NOW()
         WHERE id = $1 AND status = 'processing'`,
        [operation.id, deadLetter ? "dead_letter" : "pending", safeError(error), delay],
      );
      if (deadLetter) result.deadLettered += 1;
      else result.retried += 1;
    }
  }
  return result;
}

async function claimDueOperations(db: Db, limit: number): Promise<OutboxRow[]> {
  const rows = await db.query<OutboxRow>(
    `WITH recovered AS (
       UPDATE operation_outbox
       SET status = 'pending', claimed_at = NULL, next_attempt_at = NOW(), updated_at = NOW(),
           last_error = COALESCE(last_error, 'Recovered after stale worker claim')
       WHERE status = 'processing' AND claimed_at < NOW() - ($1 * INTERVAL '1 minute')
     ), due AS (
       SELECT id FROM operation_outbox
       WHERE status = 'pending' AND next_attempt_at <= NOW()
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     )
     UPDATE operation_outbox o
     SET status = 'processing', attempt_count = o.attempt_count + 1, claimed_at = NOW(), updated_at = NOW()
     FROM due WHERE o.id = due.id
     RETURNING o.id, o.firm_id, o.operation_kind, o.payload, o.idempotency_key, o.attempt_count`,
    [STALE_CLAIM_MINUTES, Math.max(1, Math.min(limit, 100))],
  );
  return rows;
}

async function deliverOperation(env: Env, operation: OutboxRow): Promise<{ success: boolean; error?: string; messageId?: string }> {
  const dispatcher = new EmailDispatcherService(env);
  const payload = { ...(operation.payload as Record<string, unknown>), idempotencyKey: operation.idempotency_key };
  let response;
  switch (operation.operation_kind) {
    case "support_client_confirmation": response = await dispatcher.sendClientAutoResponse(payload as unknown as SupportContactPayload); break;
    case "support_admin_alert": response = await dispatcher.notifyAdminOfSupportContact(payload as unknown as SupportContactPayload); break;
    case "rule_client_confirmation": response = await dispatcher.sendClientRuleRequestAutoResponse(payload as never); break;
    case "rule_admin_alert": response = await dispatcher.notifyAdminOfRuleRequest(payload as unknown as RuleAlertPayload); break;
    case "rule_activation_confirmation": response = await dispatcher.sendScopedRuleActivationConfirmation(payload as never); break;
  }
  // A mock is useful in local development, but it is not a delivered
  // customer notification. Keep it pending in production until a provider is
  // configured instead of turning an operational gap into a false success.
  return {
    success: response.success && response.delivered,
    error: response.simulated ? "Outbound email is not configured" : response.error,
    messageId: response.emailId,
  };
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
}
