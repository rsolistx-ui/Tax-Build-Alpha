import { createDb, type Db, type DbStatement } from "../db";
import type { Env } from "../env";
import { newId } from "../lib/id";
import { EmailDispatcherService, type RuleAlertPayload, type SupportContactPayload } from "./email-dispatcher";
import { TelegramNotifierService } from "./telegram-notifier";
import { prepareSigningAccessLink } from "./signature-access";
import {
  decryptOutboxDeliverySecret,
  encryptOutboxDeliverySecret,
  LEGACY_OUTBOX_DELIVERY_KEY_VERSION,
  OUTBOX_DELIVERY_KEY_VERSION,
  outboxDeliveryKeyForVersion,
} from "./outbox-delivery-secret";

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

export type OutboxRow = {
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
  await purgeExpiredOutboxDeliverySecrets(db);
  const claimed = await claimDueOperations(db, limit);
  const result: OutboxResult = { claimed: claimed.length, delivered: 0, retried: 0, deadLettered: 0 };

  for (const operation of claimed) {
    try {
      const delivery = await deliverOperation(env, db, operation);
      if (!delivery.success) throw new Error(delivery.error || "Provider did not accept the operation");
      const completed = await markOperationDelivered(db, operation, delivery.messageId ?? null);
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
      let [stored] = await db.query<{ ciphertext: string; iv: string; key_version: string }>(`SELECT ciphertext, iv, key_version FROM outbox_delivery_secrets WHERE outbox_id = $1`, [operation.id]);
      let token: string;
      if (stored) {
        token = await decryptOutboxDeliverySecret(stored.ciphertext, stored.iv, outboxDeliveryKeyForVersion(env, stored.key_version), operation.id, stored.key_version);
        // Opportunistically move pre-V1 rows off the session-secret-derived
        // key while the old secret is still available. A planned auth-secret
        // rotation retains OUTBOX_DELIVERY_LEGACY_AUTH_KEY until this drains.
        if (stored.key_version === LEGACY_OUTBOX_DELIVERY_KEY_VERSION && env.OUTBOX_DELIVERY_KEY_V1) {
          const upgraded = await encryptOutboxDeliverySecret(token, env.OUTBOX_DELIVERY_KEY_V1, operation.id, OUTBOX_DELIVERY_KEY_VERSION);
          await db.query(
            `UPDATE outbox_delivery_secrets SET ciphertext=$2, iv=$3, key_version=$4
             WHERE outbox_id=$1 AND key_version=$5`,
            [operation.id, upgraded.ciphertext, upgraded.iv, OUTBOX_DELIVERY_KEY_VERSION, LEGACY_OUTBOX_DELIVERY_KEY_VERSION],
          );
        }
      } else {
        // Do not revoke the previous link yet. An unavailable provider must
        // never strand a recipient whose earlier link is still usable.
        const link = await prepareSigningAccessLink({ firmId: input.firmId, clientId: input.clientId, requestId: input.requestId, recipientEmail: input.taxpayerEmail, recipientName: input.taxpayerName, issuedByUserId: "system:signature-reminder", revokeExisting: false });
        const encrypted = await encryptOutboxDeliverySecret(link.token, outboxDeliveryKeyForVersion(env, OUTBOX_DELIVERY_KEY_VERSION), operation.id, OUTBOX_DELIVERY_KEY_VERSION);
        try {
          const stage = signatureReminderStageStatement(link.statements[0], operation, encrypted);
          const staged = await db.query<{ outbox_id: string }>(stage.query, stage.params);
          if (!staged.length) throw new Error("Signature reminder was superseded before its signing link could be staged");
          token = link.token;
        } catch (error) {
          [stored] = await db.query<{ ciphertext: string; iv: string; key_version: string }>(`SELECT ciphertext, iv, key_version FROM outbox_delivery_secrets WHERE outbox_id = $1`, [operation.id]);
          if (!stored) throw error;
          token = await decryptOutboxDeliverySecret(stored.ciphertext, stored.iv, outboxDeliveryKeyForVersion(env, stored.key_version), operation.id, stored.key_version);
        }
      }
      const url = `${env.APP_ORIGIN || env.BETTER_AUTH_URL}/sign#token=${encodeURIComponent(token)}`;
      const subject = `${input.firmName}: your Form ${input.formType} for ${input.taxYear} is waiting for your signature`;
      const text = `Hello ${input.taxpayerName},\n\nYour Form ${input.formType} for tax year ${input.taxYear} still needs your signature before your return can be filed. Download it, sign and date it by hand, and upload a photo:\n\n${url}\n\nThis new link replaces earlier ones and expires in 7 days.\n\n${input.firmName}`;
      const html = `<p>Hello ${escapeTelegramHtml(input.taxpayerName)},</p><p>Your Form ${escapeTelegramHtml(input.formType)} for tax year ${input.taxYear} still needs your signature before your return can be filed.</p><p><a href="${escapeTelegramHtml(url)}">Sign your form</a></p><p>${escapeTelegramHtml(input.firmName)}</p>`;
      if (!(await outboxClaimIsCurrent(db, operation))) throw new Error("Signature reminder was superseded before email delivery");
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

export function signatureReminderStageStatement(
  linkInsert: DbStatement,
  operation: OutboxRow,
  encrypted: { ciphertext: string; iv: string },
): DbStatement {
  return {
    query: `WITH claimed AS (
       SELECT id FROM operation_outbox
       WHERE id=$10 AND status='processing' AND claim_token=$11
       FOR UPDATE
     ), link AS (
       INSERT INTO signature_access_links
         (id,firm_id,client_id,signature_request_id,recipient_email,recipient_name,token_hash,expires_at,issued_by_user_id)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 FROM claimed
       RETURNING id
     )
     INSERT INTO outbox_delivery_secrets (outbox_id, ciphertext, iv, signing_link_id, key_version)
     SELECT $10, $12, $13, link.id, $14 FROM link
     RETURNING outbox_id`,
    params: [...(linkInsert.params ?? []), operation.id, operation.claim_token, encrypted.ciphertext, encrypted.iv, OUTBOX_DELIVERY_KEY_VERSION],
  };
}

async function outboxClaimIsCurrent(db: Db, operation: OutboxRow): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM operation_outbox WHERE id=$1 AND status='processing' AND claim_token=$2`,
    [operation.id, operation.claim_token],
  );
  return rows.length === 1;
}

/** Retain a staged-link marker until its 7-day signing link expires, then erase the encrypted bearer capability. */
async function purgeExpiredOutboxDeliverySecrets(db: Db): Promise<void> {
  await db.query(
    `DELETE FROM outbox_delivery_secrets s
     USING signature_access_links sal
     WHERE sal.id=s.signing_link_id AND sal.expires_at <= NOW()`,
  );
}

/**
 * Records delivery and retires the predecessor signing links in one database
 * transaction. The recipient always has either the old link or the newly
 * delivered link; there is no outage window where neither works.
 */
async function markOperationDelivered(db: Db, operation: OutboxRow, messageId: string | null): Promise<{ id: string }[]> {
  if (operation.operation_kind !== "signature_reminder") {
    return db.query<{ id: string }>(
      `UPDATE operation_outbox
       SET status = 'delivered', delivered_at = NOW(), provider_message_id = $2,
           last_error = NULL, updated_at = NOW()
       WHERE id = $1 AND status = 'processing' AND claim_token = $3
       RETURNING id`,
      [operation.id, messageId, operation.claim_token],
    );
  }

  const statement = signatureReminderCompletionStatement(operation, messageId);
  return db.query<{ id: string }>(statement.query, statement.params);
}

export function signatureReminderCompletionStatement(operation: OutboxRow, messageId: string | null) {
  const input = operation.payload as { requestId: string; taxpayerEmail: string };
  return {
    query: `WITH completed AS (
       UPDATE operation_outbox
       SET status = 'delivered', delivered_at = NOW(), provider_message_id = $2,
           last_error = NULL, updated_at = NOW()
       WHERE id = $1 AND status = 'processing' AND claim_token = $3
       RETURNING id
     ), replacement AS (
       SELECT s.signing_link_id, replacement_link.created_at
       FROM outbox_delivery_secrets s
       JOIN completed c ON c.id = s.outbox_id
       JOIN signature_access_links replacement_link ON replacement_link.id = s.signing_link_id
     ), retired AS (
       UPDATE signature_access_links sal
       SET revoked_at = NOW()
       FROM replacement r
       WHERE sal.signature_request_id = $4
         AND LOWER(sal.recipient_email) = LOWER($5)
         AND sal.id <> r.signing_link_id
         AND sal.created_at < r.created_at
         AND sal.revoked_at IS NULL
         AND sal.consumed_at IS NULL
     ), purged AS (
       DELETE FROM outbox_delivery_secrets s
       USING completed c
       WHERE s.outbox_id = c.id
     )
     SELECT id FROM completed`,
    params: [operation.id, messageId, operation.claim_token, input.requestId, input.taxpayerEmail],
  };
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
}

function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
