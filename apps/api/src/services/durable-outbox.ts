import { createDb, type Db } from "../db";
import type { Env } from "../env";
import { newId } from "../lib/id";
import { EmailDispatcherService, type RuleAlertPayload, type SupportContactPayload } from "./email-dispatcher";
import { TelegramNotifierService } from "./telegram-notifier";
import { issueSigningAccessLink } from "./signature-access";

export type OutboxOperationKind =
  | "support_client_confirmation"
  | "support_admin_alert"
  | "support_admin_telegram"
  | "rule_client_confirmation"
  | "rule_admin_alert"
  | "rule_admin_telegram"
  | "rule_activation_confirmation"
  | "prepared_email"
  | "signature_reminder";

type OutboxRow = {
  id: string;
  firm_id: string;
  operation_kind: OutboxOperationKind;
  payload: unknown;
  idempotency_key: string;
  attempt_count: number;
  claim_token: string;
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
      const delivery = await deliverOperation(env, db, operation);
      if (!delivery.success) throw new Error(delivery.error || "Provider did not accept the operation");
      const completed = await db.query<{ id: string }>(
        `UPDATE operation_outbox
         SET status = 'delivered', delivered_at = NOW(), provider_message_id = $2,
             last_error = NULL, updated_at = NOW()
         WHERE id = $1 AND status = 'processing' AND claim_token = $3
         RETURNING id`,
        [operation.id, delivery.messageId ?? null, operation.claim_token],
      );
      if (!completed.length) continue;
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
      const released = await db.query<{ id: string }>(
        `UPDATE operation_outbox
         SET status = $2, last_error = $3,
             next_attempt_at = CASE WHEN $2 = 'pending' THEN NOW() + ($4 * INTERVAL '1 second') ELSE next_attempt_at END,
             updated_at = NOW()
         WHERE id = $1 AND status = 'processing' AND claim_token = $5
         RETURNING id`,
        [operation.id, deadLetter ? "dead_letter" : "pending", safeError(error), delay, operation.claim_token],
      );
      if (!released.length) continue;
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
       SET status = 'pending', claimed_at = NULL, claim_token = NULL, next_attempt_at = NOW(), updated_at = NOW(),
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
     SET status = 'processing', attempt_count = o.attempt_count + 1, claimed_at = NOW(),
         claim_token = md5(o.id || clock_timestamp()::text || random()::text), updated_at = NOW()
     FROM due WHERE o.id = due.id
     RETURNING o.id, o.firm_id, o.operation_kind, o.payload, o.idempotency_key, o.attempt_count, o.claim_token`,
    [STALE_CLAIM_MINUTES, Math.max(1, Math.min(limit, 100))],
  );
  return rows;
}

export function isDeliveryAccepted(result: { success: boolean; delivered: boolean; simulated: boolean }): boolean {
  return result.success && result.delivered && !result.simulated;
}

async function deliverOperation(env: Env, db: Db, operation: OutboxRow): Promise<{ success: boolean; error?: string; messageId?: string }> {
  const dispatcher = new EmailDispatcherService(env);
  const payload = { ...(operation.payload as Record<string, unknown>), idempotencyKey: operation.idempotency_key };
  let response;
  switch (operation.operation_kind) {
    case "support_client_confirmation": response = await dispatcher.sendClientAutoResponse(payload as unknown as SupportContactPayload); break;
    case "support_admin_alert": response = await dispatcher.notifyAdminOfSupportContact(payload as unknown as SupportContactPayload); break;
    case "support_admin_telegram": {
      const input = payload as unknown as SupportContactPayload;
      const telegram = await new TelegramNotifierService(env).sendMessage(
        `💬 <b>Truepost Concierge Support Request</b>\n\n<b>From:</b> ${escapeTelegramHtml(input.userName)} (${escapeTelegramHtml(input.userEmail)})\n<b>Subject:</b> ${escapeTelegramHtml(input.subject)}\n<b>Message:</b>\n<i>${escapeTelegramHtml(input.message)}</i>`,
      );
      return { success: telegram.success && !telegram.simulated, error: telegram.error, messageId: telegram.messageId?.toString() };
    }
    case "rule_client_confirmation": response = await dispatcher.sendClientRuleRequestAutoResponse(payload as never); break;
    case "rule_admin_alert": response = await dispatcher.notifyAdminOfRuleRequest(payload as unknown as RuleAlertPayload); break;
    case "rule_admin_telegram": {
      const input = payload as unknown as RuleAlertPayload;
      const telegram = await new TelegramNotifierService(env).notifyRuleDirective({
        userName: input.userName, title: input.ruleTitle, directiveText: input.directiveText, clientName: input.clientName,
      });
      return { success: telegram.success && !telegram.simulated, error: telegram.error, messageId: telegram.messageId?.toString() };
    }
    case "rule_activation_confirmation": response = await dispatcher.sendScopedRuleActivationConfirmation(payload as never); break;
    case "prepared_email": response = await dispatcher.sendPreparedEmail(payload as never); break;
    case "signature_reminder": {
      const input = payload as unknown as { authorizationId: string; firmId: string; clientId: string; requestId: string; taxpayerName: string; taxpayerEmail: string; firmName: string; formType: string; taxYear: number };
      const link = await issueSigningAccessLink(db, { firmId: input.firmId, clientId: input.clientId, requestId: input.requestId, recipientEmail: input.taxpayerEmail, recipientName: input.taxpayerName, issuedByUserId: "system:signature-reminder" });
      const url = `${env.APP_ORIGIN || env.BETTER_AUTH_URL}/sign#token=${encodeURIComponent(link.token)}`;
      const subject = `${input.firmName}: your Form ${input.formType} for ${input.taxYear} is waiting for your signature`;
      const text = `Hello ${input.taxpayerName},\n\nYour Form ${input.formType} for tax year ${input.taxYear} still needs your signature before your return can be filed. Download it, sign and date it by hand, and upload a photo:\n\n${url}\n\nThis new link replaces earlier ones and expires in 7 days.\n\n${input.firmName}`;
      const html = `<p>Hello ${escapeTelegramHtml(input.taxpayerName)},</p><p>Your Form ${escapeTelegramHtml(input.formType)} for tax year ${input.taxYear} still needs your signature before your return can be filed.</p><p><a href="${escapeTelegramHtml(url)}">Sign your form</a></p><p>${escapeTelegramHtml(input.firmName)}</p>`;
      response = await dispatcher.sendPreparedEmail({ to: input.taxpayerEmail, subject, text, html, ticketNumber: `signature-reminder:${input.authorizationId}`, idempotencyKey: operation.idempotency_key });
      break;
    }
  }
  // A mock is useful in local development, but it is not a delivered
  // customer notification. Keep it pending in production until a provider is
  // configured instead of turning an operational gap into a false success.
  return {
    success: isDeliveryAccepted(response),
    error: response.simulated ? "Outbound email is not configured" : response.error,
    messageId: response.emailId,
  };
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
}

function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
