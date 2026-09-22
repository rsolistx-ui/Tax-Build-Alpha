import type { Db } from "../db";
import { newId } from "../lib/id";
import { BillingService, type Invoice } from "./billing";

export interface TimeEntry {
  id: string;
  firmId: string;
  clientId: string;
  engagementId: string | null;
  billingRateId: string | null;
  description: string;
  startedAt: Date;
  endedAt: Date | null;
  durationMinutes: number | null;
  isBillable: boolean;
  invoiceId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StartTimerInput {
  engagementId?: string | null;
  billingRateId?: string | null;
  description: string;
  isBillable?: boolean;
}

export interface LogManualEntryInput {
  engagementId?: string | null;
  billingRateId?: string | null;
  description: string;
  startedAt: string;
  endedAt: string;
  isBillable?: boolean;
}

export interface UpdateTimeEntryInput {
  description?: string;
  engagementId?: string | null;
  billingRateId?: string | null;
  isBillable?: boolean;
}

export class TimeEntryConflictError extends Error {}
export class TimeEntryInvoicedError extends Error {}
export class TimeEntryMissingRateError extends Error {
  constructor(public entryIds: string[]) {
    super(`Entries missing a billing rate: ${entryIds.join(", ")}`);
  }
}

function mapTimeEntry(row: any): TimeEntry {
  return {
    id: row.id,
    firmId: row.firm_id,
    clientId: row.client_id,
    engagementId: row.engagement_id,
    billingRateId: row.billing_rate_id,
    description: row.description,
    startedAt: new Date(row.started_at),
    endedAt: row.ended_at ? new Date(row.ended_at) : null,
    durationMinutes: row.duration_minutes === null ? null : Number(row.duration_minutes),
    isBillable: row.is_billable,
    invoiceId: row.invoice_id,
    createdByUserId: row.created_by_user_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function minutesBetween(start: Date, end: Date): number {
  return Math.round(((end.getTime() - start.getTime()) / 60000) * 100) / 100;
}

export class TimeTrackingService {
  private db: Db;
  private billing: BillingService;

  constructor(db: Db) {
    this.db = db;
    this.billing = new BillingService(db);
  }

  async getRunningTimer(clientId: string): Promise<TimeEntry | null> {
    const [row] = await this.db.query<any>(
      `SELECT * FROM time_entries WHERE client_id = $1 AND ended_at IS NULL`,
      [clientId],
    );
    return row ? mapTimeEntry(row) : null;
  }

  async startTimer(firmId: string, clientId: string, input: StartTimerInput, actorUserId: string | null): Promise<TimeEntry> {
    const running = await this.getRunningTimer(clientId);
    if (running) {
      throw new TimeEntryConflictError(`A timer is already running for this client (entry ${running.id})`);
    }
    const id = newId("tme");
    await this.db.query(
      `INSERT INTO time_entries (id, firm_id, client_id, engagement_id, billing_rate_id, description, started_at, is_billable, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,$8)`,
      [id, firmId, clientId, input.engagementId ?? null, input.billingRateId ?? null, input.description,
       input.isBillable ?? true, actorUserId],
    );
    const entry = await this.getEntry(id);
    if (!entry) throw new Error("Time entry not found after creation");
    return entry;
  }

  async stopTimer(id: string): Promise<TimeEntry | null> {
    const entry = await this.getEntry(id);
    if (!entry) return null;
    if (entry.endedAt) return entry;
    const endedAt = new Date();
    const duration = minutesBetween(entry.startedAt, endedAt);
    await this.db.query(
      `UPDATE time_entries SET ended_at = $2, duration_minutes = $3, updated_at = NOW() WHERE id = $1`,
      [id, endedAt.toISOString(), duration],
    );
    return this.getEntry(id);
  }

  async logManualEntry(firmId: string, clientId: string, input: LogManualEntryInput, actorUserId: string | null): Promise<TimeEntry> {
    const startedAt = new Date(input.startedAt);
    const endedAt = new Date(input.endedAt);
    const id = newId("tme");
    await this.db.query(
      `INSERT INTO time_entries (id, firm_id, client_id, engagement_id, billing_rate_id, description, started_at, ended_at, duration_minutes, is_billable, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, firmId, clientId, input.engagementId ?? null, input.billingRateId ?? null, input.description,
       startedAt.toISOString(), endedAt.toISOString(), minutesBetween(startedAt, endedAt),
       input.isBillable ?? true, actorUserId],
    );
    const entry = await this.getEntry(id);
    if (!entry) throw new Error("Time entry not found after creation");
    return entry;
  }

  async getEntry(id: string): Promise<TimeEntry | null> {
    const [row] = await this.db.query<any>(`SELECT * FROM time_entries WHERE id = $1`, [id]);
    return row ? mapTimeEntry(row) : null;
  }

  async listByClient(clientId: string, options?: { unbilledOnly?: boolean }): Promise<TimeEntry[]> {
    let sql = `SELECT * FROM time_entries WHERE client_id = $1`;
    if (options?.unbilledOnly) {
      sql += ` AND invoice_id IS NULL AND ended_at IS NOT NULL AND is_billable = TRUE`;
    }
    sql += ` ORDER BY started_at DESC`;
    const rows = await this.db.query<any>(sql, [clientId]);
    return rows.map(mapTimeEntry);
  }

  async updateEntry(id: string, patch: UpdateTimeEntryInput): Promise<TimeEntry | null> {
    const entry = await this.getEntry(id);
    if (!entry) return null;
    if (entry.invoiceId) throw new TimeEntryInvoicedError("Cannot edit a time entry already applied to an invoice");

    const sets: string[] = [];
    const params: any[] = [id];
    let idx = 2;
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        sets.push(`${col} = $${idx++}`);
        params.push(value);
      }
    }
    if (sets.length === 0) return entry;
    sets.push(`updated_at = NOW()`);
    await this.db.query(`UPDATE time_entries SET ${sets.join(', ')} WHERE id = $1`, params);
    return this.getEntry(id);
  }

  async deleteEntry(id: string): Promise<void> {
    const entry = await this.getEntry(id);
    if (!entry) return;
    if (entry.invoiceId) throw new TimeEntryInvoicedError("Cannot delete a time entry already applied to an invoice");
    await this.db.query(`DELETE FROM time_entries WHERE id = $1`, [id]);
  }

  /**
   * Converts a set of unbilled, stopped time entries into one draft invoice.
   * Hourly rates bill duration; fixed/retainer rates bill the flat rate once
   * per entry while still preserving the logged duration for the record.
   */
  async convertToInvoice(
    firmId: string,
    clientId: string,
    entryIds: string[],
    input: { engagementId?: string | null; issueDate: string; dueDate: string; notes?: string },
  ): Promise<Invoice> {
    const entries: TimeEntry[] = [];
    for (const id of entryIds) {
      const entry = await this.getEntry(id);
      if (!entry || entry.clientId !== clientId) throw new Error(`Time entry ${id} not found for this client`);
      if (entry.invoiceId) throw new TimeEntryInvoicedError(`Entry ${id} is already invoiced`);
      if (!entry.endedAt) throw new Error(`Entry ${id} is still running`);
      entries.push(entry);
    }

    const missingRate = entries.filter((e) => !e.billingRateId).map((e) => e.id);
    if (missingRate.length > 0) throw new TimeEntryMissingRateError(missingRate);

    const lines = [];
    for (const entry of entries) {
      const rate = await this.billing.getBillingRate(entry.billingRateId!);
      if (!rate) throw new TimeEntryMissingRateError([entry.id]);
      const quantity = rate.rateType === 'hourly'
        ? Math.round(((entry.durationMinutes ?? 0) / 60) * 100) / 100
        : 1;
      lines.push({
        description: entry.description,
        quantity,
        unitPrice: rate.rate,
        accountId: null,
      });
    }

    const invoice = await this.billing.createInvoice(firmId, {
      clientId,
      engagementId: input.engagementId ?? null,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      lines,
      notes: input.notes,
    });

    await this.db.query(
      `UPDATE time_entries SET invoice_id = $1, updated_at = NOW() WHERE id = ANY($2::text[])`,
      [invoice.id, entryIds],
    );

    return invoice;
  }
}
