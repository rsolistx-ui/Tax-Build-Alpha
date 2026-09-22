import type { Db } from "../db";
import type { Env } from "../env";
import { newId } from "../lib/id";

export interface SmsReceiptDropResult {
  success: boolean;
  clientId: string;
  clientName: string;
  receiptId: string;
  matchedBankTransactionId?: string | null;
  satisfiedRequestId?: string | null;
  r2Key: string;
  message: string;
}

export function normalizePhoneNumber(raw: string): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return digits;
  return digits;
}

export class SmsReceiptIntakeService {
  constructor(private db: Db, private env: Env) {}

  /**
   * Identifies a client entity by sender phone number.
   */
  async findClientByPhone(senderPhone: string): Promise<{ id: string; firm_id: string; name: string } | null> {
    const normalized = normalizePhoneNumber(senderPhone);
    if (!normalized) return null;

    // Search clients by phone suffix or formatted number
    const clients = await this.db.query<{ id: string; firm_id: string; name: string; phone: string | null }>(
      `SELECT id, firm_id, name, phone FROM clients WHERE phone IS NOT NULL AND phone <> ''`
    );

    for (const c of clients) {
      if (normalizePhoneNumber(c.phone || "") === normalized) {
        return { id: c.id, firm_id: c.firm_id, name: c.name };
      }
    }

    return null;
  }

  /**
   * Finds the best matching open missing receipt request or bank exception for the client.
   */
  async findPendingException(
    clientId: string,
    amountHint?: number
  ): Promise<{ bankTxnId?: string; requestId?: string; description?: string } | null> {
    // 1. Look for an open client request for a missing receipt
    const openRequests = await this.db.query<{
      id: string;
      related_bank_transaction_id: string | null;
      title: string;
    }>(
      `SELECT id, related_bank_transaction_id, title
       FROM client_requests
       WHERE client_id = $1 AND status IN ('requested', 'viewed', 'prepared', 'draft')
       ORDER BY created_at ASC`,
      [clientId]
    );

    if (openRequests.length > 0) {
      const first = openRequests[0];
      return {
        requestId: first.id,
        bankTxnId: first.related_bank_transaction_id || undefined,
        description: first.title,
      };
    }

    // 2. Fallback: Look for the oldest bank transaction without a receipt
    const openTxns = await this.db.query<{ id: string; description: string; amount: number }>(
      `SELECT id, description, amount
       FROM bank_transactions
       WHERE client_id = $1 AND triage IN ('needs_review', 'unmatched', 'likely_match') AND matched_receipt_id IS NULL
       ORDER BY txn_date DESC
       LIMIT 5`,
      [clientId]
    );

    if (openTxns.length > 0) {
      // If an amount hint was parsed from SMS body (e.g. "$45.50"), pick closest match
      if (amountHint !== undefined && amountHint > 0) {
        const closest = openTxns.find((t) => Math.abs(Math.abs(Number(t.amount)) - amountHint) < 1.0);
        if (closest) return { bankTxnId: closest.id, description: closest.description };
      }
      return { bankTxnId: openTxns[0].id, description: openTxns[0].description };
    }

    return null;
  }

  /**
   * Stores an inbound receipt as evidence awaiting professional review.
   *
   * A sender phone number and an amount hint are not enough evidence to
   * silently satisfy a client request or change a bank transaction. The
   * reviewer can make that link after the image is read and verified.
   */
  async ingestSmsReceipt(params: {
    clientId: string;
    firmId: string;
    clientName: string;
    fileBytes: Uint8Array;
    filename: string;
    mimeType: string;
    senderPhone: string;
    smsBody?: string;
    amountHint?: number;
  }): Promise<SmsReceiptDropResult> {
    const receiptId = newId("rcp");
    const r2Key = `receipts/${params.clientId}/${receiptId}_${params.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

    // 1. Put file in Cloudflare R2
    if (this.env.RECEIPTS && typeof this.env.RECEIPTS.put === "function") {
      await this.env.RECEIPTS.put(r2Key, params.fileBytes, {
        httpMetadata: { contentType: params.mimeType },
      });
    }

    const statements: { query: string; params: unknown[] }[] = [];

    // Insert receipt record
    statements.push({
      query: `INSERT INTO receipts (
                id, firm_id, client_id, filename, r2_key, mime_type, file_size, status,
                extracted_merchant, extracted_total, source, notes, validation_status, created_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'review', $8, $9, 'sms_drop', $10, 'manual_review_required', NOW(), NOW())`,
      params: [
        receiptId,
        params.firmId,
        params.clientId,
        params.filename,
        r2Key,
        params.mimeType,
        params.fileBytes.byteLength,
        params.smsBody ? params.smsBody.slice(0, 100) : "SMS Mobile Drop",
        params.amountHint || null,
        `Received via SMS from ${params.senderPhone}`,
      ],
    });

    // Log immutable audit event
    const auditId = newId("audit");
    statements.push({
      query: `INSERT INTO audit_events (
                id, firm_id, client_id, actor_id, actor_name, event_type, details, created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      params: [
        auditId,
        params.firmId,
        params.clientId,
        "system_sms",
        `SMS (${params.senderPhone})`,
        "sms_receipt_received",
        JSON.stringify({
          receiptId,
          r2Key,
          filename: params.filename,
          fileSize: params.fileBytes.byteLength,
          matchedBankTxnId: null,
          satisfiedRequestId: null,
          senderPhone: params.senderPhone,
        }),
      ],
    });

    await this.db.transaction(statements);

    const message = `Receipt saved to the review queue for ${params.clientName}. A professional will verify and file it.`;

    return {
      success: true,
      clientId: params.clientId,
      clientName: params.clientName,
      receiptId,
      matchedBankTransactionId: null,
      satisfiedRequestId: null,
      r2Key,
      message,
    };
  }
}
