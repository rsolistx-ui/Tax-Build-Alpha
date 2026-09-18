import type { Db } from "../db";
import { newId } from "../lib/id";
import { BillingService } from "./billing";
import { sha256Hex } from "../services/documents";
import { createVersion } from "./doc-versioning";

export interface Estimate {
  id: string;
  firmId: string;
  clientId: string;
  engagementId: string | null;
  number: string;
  title: string;
  description: string | null;
  status: 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired' | 'converted';
  issueDate: string;
  expiryDate: string | null;
  acceptedDate: string | null;
  convertedInvoiceId: string | null;
  subtotal: number;
  taxAmount: number;
  total: number;
  terms: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
}

export interface EstimateLine {
  id: string;
  estimateId: string;
  accountId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  sortOrder: number;
}

export interface EstimateWithLines extends Estimate {
  lines: EstimateLine[];
}

export interface CreateEstimateInput {
  clientId: string;
  engagementId?: string | null;
  title: string;
  description?: string;
  issueDate: string;
  expiryDate?: string | null;
  lines: Omit<EstimateLine, 'id' | 'estimateId' | 'lineTotal' | 'sortOrder'>[];
  terms?: string;
  notes?: string;
}

export interface UpdateEstimateInput {
  title?: string;
  description?: string;
  expiryDate?: string | null;
  status?: 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired';
  terms?: string;
  notes?: string;
}

export interface EstimateAcceptanceInput {
  token: string;
}

export class EstimatesService {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async getNextEstimateNumber(firmId: string): Promise<string> {
    const [row] = await this.db.query<{ max_num: string | null }>(
      `SELECT MAX(number) as max_num FROM estimates WHERE firm_id = $1 AND number ~ '^EST-\\d+$'`,
      [firmId],
    );
    let nextNum = 1;
    if (row?.max_num) {
      const match = row.max_num.match(/EST-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    return `EST-${String(nextNum).padStart(6, '0')}`;
  }

  async createEstimate(firmId: string, input: CreateEstimateInput): Promise<EstimateWithLines> {
    const number = await this.getNextEstimateNumber(firmId);
    const id = newId("est");

    const subtotal = input.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
    const total = subtotal;

    await this.db.query(
      `INSERT INTO estimates (id, firm_id, client_id, engagement_id, number, title, description, status, issue_date, expiry_date, subtotal, tax_amount, total, terms, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,0,$11,$12,$13)`,
      [id, firmId, input.clientId, input.engagementId ?? null, number, input.title, input.description ?? null,
       input.issueDate, input.expiryDate ?? null, subtotal, total, input.terms ?? null, input.notes ?? null],
    );

    for (let i = 0; i < input.lines.length; i++) {
      const line = input.lines[i];
      await this.db.query(
        `INSERT INTO estimate_lines (id, estimate_id, account_id, description, quantity, unit_price, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [newId("eln"), id, line.accountId ?? null, line.description, line.quantity, line.unitPrice, i],
      );
    }

    const estimate = await this.getEstimateWithLines(id);
    if (!estimate) throw new Error("Failed to create estimate");
    return estimate;
  }

  async getEstimateWithLines(id: string): Promise<EstimateWithLines | null> {
    const [estimateRow] = await this.db.query<any>(`SELECT * FROM estimates WHERE id = $1`, [id]);
    if (!estimateRow) return null;

    const estimate = this.mapEstimate(estimateRow);
    const lines = await this.db.query<any>(`SELECT * FROM estimate_lines WHERE estimate_id = $1 ORDER BY sort_order`, [id]);
    return { ...estimate, lines: lines.map(this.mapLine) };
  }

  async getEstimate(id: string): Promise<Estimate | null> {
    const [row] = await this.db.query<any>(`SELECT * FROM estimates WHERE id = $1`, [id]);
    return row ? this.mapEstimate(row) : null;
  }

  async getEstimatesByClient(clientId: string): Promise<Estimate[]> {
    const rows = await this.db.query<any>(`SELECT * FROM estimates WHERE client_id = $1 ORDER BY issue_date DESC`, [clientId]);
    return rows.map(this.mapEstimate);
  }

  async getEstimatesByFirm(firmId: string, options?: { status?: string; limit?: number }): Promise<Estimate[]> {
    let sql = `SELECT * FROM estimates WHERE firm_id = $1`;
    const params: any[] = [firmId];
    let idx = 2;
    if (options?.status) { sql += ` AND status = $${idx++}`; params.push(options.status); }
    sql += ` ORDER BY issue_date DESC`;
    if (options?.limit) { sql += ` LIMIT $${idx}`; params.push(options.limit); }
    const rows = await this.db.query<any>(sql, params);
    return rows.map(this.mapEstimate);
  }

  async updateEstimate(id: string, patch: UpdateEstimateInput): Promise<Estimate | null> {
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
    if (sets.length === 0) return this.getEstimate(id);
    sets.push(`updated_at = NOW()`);
    await this.db.query(`UPDATE estimates SET ${sets.join(', ')} WHERE id = $1`, params);
    return this.getEstimate(id);
  }

  async sendEstimate(id: string): Promise<Estimate | null> {
    const [row] = await this.db.query<any>(`SELECT * FROM estimates WHERE id = $1`, [id]);
    if (!row || row.status !== 'draft') return null;
    await this.db.query(
      `UPDATE estimates SET status = 'sent', sent_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id],
    );
    return this.getEstimate(id);
  }

  async viewEstimate(id: string): Promise<Estimate | null> {
    const [row] = await this.db.query<any>(`SELECT * FROM estimates WHERE id = $1`, [id]);
    if (!row) return null;
    if (row.status === 'sent') {
      await this.db.query(`UPDATE estimates SET status = 'viewed', updated_at = NOW() WHERE id = $1`, [id]);
      return this.getEstimate(id);
    }
    return this.mapEstimate(row);
  }

  async acceptEstimate(token: string): Promise<{ estimate: Estimate; invoice?: any } | null> {
    const [tokenRow] = await this.db.query<any>(
      `SELECT * FROM estimate_acceptance_tokens WHERE token = $1 AND expires_at > NOW() AND used_at IS NULL`,
      [token],
    );
    if (!tokenRow) return null;

    const [estimate] = await this.db.query<any>(`SELECT * FROM estimates WHERE id = $1`, [tokenRow.estimate_id]);
    if (!estimate || estimate.status !== 'sent' && estimate.status !== 'viewed') {
      return null;
    }

    // Mark token as used
    await this.db.query(
      `UPDATE estimate_acceptance_tokens SET used_at = NOW() WHERE id = $1`,
      [tokenRow.id],
    );

    // Update estimate status
    await this.db.query(
      `UPDATE estimates SET status = 'accepted', accepted_date = NOW(), updated_at = NOW() WHERE id = $1`,
      [tokenRow.estimate_id],
    );

    // Create invoice from estimate
    const billingService = new BillingService(this.db);
    const invoice = await billingService.createInvoice(estimate.firm_id, {
      clientId: estimate.client_id,
      engagementId: estimate.engagement_id,
      issueDate: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      lines: await this.getEstimateLines(tokenRow.estimate_id),
      notes: estimate.notes,
      memo: estimate.notes,
    });

    // Link invoice to estimate
    await this.db.query(
      `UPDATE estimates SET status = 'converted', converted_invoice_id = $1, updated_at = NOW() WHERE id = $2`,
      [invoice.id, tokenRow.estimate_id],
    );

    const estimateWithLines = await this.getEstimateWithLines(tokenRow.estimate_id);
    if (!estimateWithLines) throw new Error("Estimate not found after acceptance");
    return { estimate: estimateWithLines, invoice };
  }

  async createAcceptanceToken(estimateId: string, expiresInDays = 30): Promise<string> {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const id = newId("eat");

    await this.db.query(
      `INSERT INTO estimate_acceptance_tokens (id, estimate_id, token, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (estimate_id) DO UPDATE SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at, used_at = NULL`,
      [id, estimateId, token, expiresAt],
    );

    return token;
  }

  async getEstimateLines(estimateId: string): Promise<Omit<EstimateLine, 'id' | 'estimateId' | 'lineTotal' | 'sortOrder'>[]> {
    const rows = await this.db.query<any>(`SELECT * FROM estimate_lines WHERE estimate_id = $1 ORDER BY sort_order`, [estimateId]);
    return rows.map(r => ({
      accountId: r.account_id,
      description: r.description,
      quantity: Number(r.quantity),
      unitPrice: Number(r.unit_price),
    }));
  }

  async deleteEstimate(id: string): Promise<void> {
    await this.db.query(`DELETE FROM estimates WHERE id = $1`, [id]);
  }

  private mapEstimate(row: any): Estimate {
    return {
      id: row.id,
      firmId: row.firm_id,
      clientId: row.client_id,
      engagementId: row.engagement_id,
      number: row.number,
      title: row.title,
      description: row.description,
      status: row.status,
      issueDate: row.issue_date,
      expiryDate: row.expiry_date,
      acceptedDate: row.accepted_date,
      convertedInvoiceId: row.converted_invoice_id,
      subtotal: Number(row.subtotal),
      taxAmount: Number(row.tax_amount),
      total: Number(row.total),
      terms: row.terms,
      notes: row.notes,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      sentAt: row.sent_at ? new Date(row.sent_at) : null,
    };
  }

  private mapLine(row: any): EstimateLine {
    return {
      id: row.id,
      estimateId: row.estimate_id,
      accountId: row.account_id,
      description: row.description,
      quantity: Number(row.quantity),
      unitPrice: Number(row.unit_price),
      lineTotal: Number(row.line_total),
      sortOrder: row.sort_order,
    };
  }
}