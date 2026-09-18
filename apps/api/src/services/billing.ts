import type { Db } from "../db";
import { newId } from "../lib/id";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { FolioNativeAccountingProvider } from "./folio-native-accounting";

export interface Invoice {
  id: string;
  firmId: string;
  clientId: string;
  engagementId: string | null;
  number: string;
  status: 'draft' | 'sent' | 'paid' | 'void' | 'overdue';
  issueDate: string;
  dueDate: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  notes: string | null;
  memo: string | null;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
  paidAt: Date | null;
  lines?: InvoiceLine[];
}

export interface InvoiceLine {
  id: string;
  invoiceId: string;
  accountId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  sortOrder: number;
}

export interface Payment {
  id: string;
  firmId: string;
  clientId: string;
  invoiceId: string | null;
  amount: number;
  method: 'cash' | 'check' | 'ach' | 'wire' | 'credit_card' | 'other';
  reference: string | null;
  receivedDate: string;
  depositedDate: string | null;
  notes: string | null;
  createdAt: Date;
}

export interface BillingRate {
  id: string;
  firmId: string;
  clientId: string | null;
  serviceType: string | null;
  name: string;
  rateType: 'hourly' | 'fixed' | 'retainer';
  rate: number;
  currency: string;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface CreateInvoiceInput {
  clientId: string;
  engagementId?: string | null;
  issueDate: string;
  dueDate: string;
  lines: Omit<InvoiceLine, 'id' | 'invoiceId' | 'lineTotal' | 'sortOrder'>[];
  notes?: string;
  memo?: string;
}

export interface UpdateInvoiceInput {
  dueDate?: string;
  status?: 'draft' | 'sent' | 'void';
  notes?: string;
  memo?: string;
}

export interface CreatePaymentInput {
  clientId: string;
  invoiceId?: string | null;
  amount: number;
  method: 'cash' | 'check' | 'ach' | 'wire' | 'credit_card' | 'other';
  reference?: string;
  receivedDate: string;
  depositedDate?: string;
  notes?: string;
}

function mapInvoice(row: any): Invoice {
  return {
    id: row.id,
    firmId: row.firm_id,
    clientId: row.client_id,
    engagementId: row.engagement_id,
    number: row.number,
    status: row.status,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    subtotal: Number(row.subtotal),
    taxAmount: Number(row.tax_amount),
    total: Number(row.total),
    amountPaid: Number(row.amount_paid),
    balanceDue: Number(row.balance_due),
    notes: row.notes,
    memo: row.memo,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    sentAt: row.sent_at ? new Date(row.sent_at) : null,
    paidAt: row.paid_at ? new Date(row.paid_at) : null,
  };
}

function mapInvoiceLine(row: any): InvoiceLine {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    accountId: row.account_id,
    description: row.description,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    lineTotal: Number(row.line_total),
    sortOrder: row.sort_order,
  };
}

function mapPayment(row: any): Payment {
  return {
    id: row.id,
    firmId: row.firm_id,
    clientId: row.client_id,
    invoiceId: row.invoice_id,
    amount: Number(row.amount),
    method: row.method,
    reference: row.reference,
    receivedDate: row.received_date,
    depositedDate: row.deposited_date,
    notes: row.notes,
    createdAt: new Date(row.created_at),
  };
}

export class BillingService {
  private db: Db;
  private accounting: FolioNativeAccountingProvider;

  constructor(db: Db) {
    this.db = db;
    this.accounting = new FolioNativeAccountingProvider(db);
  }

  private async getARControlAccount(firmId: string): Promise<string | null> {
    const account = await this.accounting.getSystemAccount(firmId, 'ar_control');
    return account?.id ?? null;
  }

  private async getCashAccount(firmId: string): Promise<string | null> {
    const account = await this.accounting.getSystemAccount(firmId, 'cash_undeposited_funds');
    return account?.id ?? null;
  }

  private async getDefaultRevenueAccount(firmId: string): Promise<string | null> {
    const accounts = await this.accounting.listAccounts(firmId, 'revenue');
    return accounts[0]?.id ?? null;
  }

  private async createARJournalForInvoice(firmId: string, clientId: string, invoiceId: string, total: number, revenueAccountId: string | null): Promise<void> {
    const arAccountId = await this.getARControlAccount(firmId);
    const revenueId = revenueAccountId ?? await this.getDefaultRevenueAccount(firmId);
    if (!arAccountId || !revenueId) return;

    const periodEnd = new Date().toISOString().split('T')[0];
    await this.accounting.createJournal(firmId, {
      firmId,
      clientId,
      sourceType: 'invoice',
      sourceId: invoiceId,
      memo: `Invoice revenue recognition`,
      periodStart: new Date(periodEnd),
      periodEnd: new Date(periodEnd),
      status: 'draft',
      lines: [
        { accountId: arAccountId, description: `AR - Invoice`, debit: total, credit: 0, currency: 'USD', exchangeRate: 1 },
        { accountId: revenueId, description: `Revenue - Invoice`, debit: 0, credit: total, currency: 'USD', exchangeRate: 1 },
      ],
    });
  }

  private async createCashReceiptJournal(firmId: string, clientId: string, paymentId: string, amount: number, method: string, reference: string | null): Promise<void> {
    const cashAccountId = await this.getCashAccount(firmId);
    const arAccountId = await this.getARControlAccount(firmId);
    if (!cashAccountId || !arAccountId) return;

    const periodEnd = new Date().toISOString().split('T')[0];
    await this.accounting.createJournal(firmId, {
      firmId,
      clientId,
      sourceType: 'payment',
      sourceId: paymentId,
      memo: `Payment received${reference ? ` (${reference})` : ''} via ${method}`,
      periodStart: new Date(periodEnd),
      periodEnd: new Date(periodEnd),
      status: 'draft',
      lines: [
        { accountId: cashAccountId, description: `Cash - ${method}`, debit: amount, credit: 0, currency: 'USD', exchangeRate: 1 },
        { accountId: arAccountId, description: `AR - Payment received`, debit: 0, credit: amount, currency: 'USD', exchangeRate: 1 },
      ],
    });
  }

  async getNextInvoiceNumber(firmId: string): Promise<string> {
    const [row] = await this.db.query<{ max_num: string | null }>(
      `SELECT MAX(number) as max_num FROM invoices WHERE firm_id = $1 AND number ~ '^INV-\\d+$'`,
      [firmId],
    );
    let nextNum = 1;
    if (row?.max_num) {
      const match = row.max_num.match(/INV-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    return `INV-${String(nextNum).padStart(6, '0')}`;
  }

  async createInvoice(firmId: string, input: CreateInvoiceInput): Promise<Invoice> {
    const number = await this.getNextInvoiceNumber(firmId);
    const id = newId("inv");

    const subtotal = input.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
    const total = subtotal;

    await this.db.query(
      `INSERT INTO invoices (id, firm_id, client_id, engagement_id, number, status, issue_date, due_date, subtotal, tax_amount, total, amount_paid, notes, memo)
       VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8,0,$9,0,$10,$11)`,
      [id, firmId, input.clientId, input.engagementId ?? null, number, input.issueDate, input.dueDate, subtotal, total, input.notes ?? null, input.memo ?? null],
    );

    for (let i = 0; i < input.lines.length; i++) {
      const line = input.lines[i];
      await this.db.query(
        `INSERT INTO invoice_lines (id, invoice_id, account_id, description, quantity, unit_price, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [newId("iln"), id, line.accountId ?? null, line.description, line.quantity, line.unitPrice, i],
      );
    }

    const inv = await this.getInvoice(id);
    if (!inv) throw new Error("Invoice not found after creation");
    return inv;
  }

  async getInvoice(id: string): Promise<Invoice | null> {
    const [row] = await this.db.query<any>(`SELECT * FROM invoices WHERE id = $1`, [id]);
    if (!row) return null;
    const invoice = mapInvoice(row);
    const lines = await this.db.query<any>(`SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY sort_order`, [id]);
    return { ...invoice, lines: lines.map(mapInvoiceLine) } as any;
  }

  async getInvoicesByClient(clientId: string): Promise<Invoice[]> {
    const rows = await this.db.query<any>(`SELECT * FROM invoices WHERE client_id = $1 ORDER BY issue_date DESC`, [clientId]);
    return rows.map(mapInvoice);
  }

  async getInvoicesByFirm(firmId: string, options?: { status?: string; limit?: number }): Promise<Invoice[]> {
    let sql = `SELECT * FROM invoices WHERE firm_id = $1`;
    const params: any[] = [firmId];
    let idx = 2;
    if (options?.status) { sql += ` AND status = $${idx++}`; params.push(options.status); }
    sql += ` ORDER BY issue_date DESC`;
    if (options?.limit) { sql += ` LIMIT $${idx}`; params.push(options.limit); }
    const rows = await this.db.query<any>(sql, params);
    return rows.map(mapInvoice);
  }

  async updateInvoice(id: string, patch: UpdateInvoiceInput): Promise<Invoice | null> {
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
    if (sets.length === 0) return this.getInvoice(id);
    sets.push(`updated_at = NOW()`);
    await this.db.query(`UPDATE invoices SET ${sets.join(', ')} WHERE id = $1`, params);
    return this.getInvoice(id);
  }

  async sendInvoice(id: string): Promise<Invoice | null> {
    const [row] = await this.db.query<any>(`SELECT * FROM invoices WHERE id = $1`, [id]);
    if (!row || row.status !== 'draft') return null;
    await this.db.query(
      `UPDATE invoices SET status = 'sent', sent_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id],
    );

    const invoice = await this.getInvoice(id);
    if (invoice) {
      const firstLine = invoice.lines?.[0];
      const revenueAccountId = firstLine?.accountId ?? null;
      await this.createARJournalForInvoice(row.firm_id, row.client_id, id, invoice.total, revenueAccountId);
    }

    return this.getInvoice(id);
  }

  async voidInvoice(id: string): Promise<Invoice | null> {
    const [row] = await this.db.query<any>(`SELECT * FROM invoices WHERE id = $1`, [id]);
    if (!row || row.status === 'paid') return null;
    await this.db.query(
      `UPDATE invoices SET status = 'void', updated_at = NOW() WHERE id = $1`,
      [id],
    );
    return this.getInvoice(id);
  }

  async deleteInvoice(id: string): Promise<void> {
    await this.db.query(`DELETE FROM invoices WHERE id = $1`, [id]);
  }

  async applyPayment(payment: Payment): Promise<void> {
    if (payment.invoiceId) {
      await this.db.query(
        `UPDATE invoices SET amount_paid = amount_paid + $1, updated_at = NOW(),
          status = CASE WHEN amount_paid + $1 >= total THEN 'paid' ELSE status END,
          paid_at = CASE WHEN amount_paid + $1 >= total THEN NOW() ELSE paid_at END
         WHERE id = $2`,
        [payment.amount, payment.invoiceId],
      );
    }
  }

  async createPayment(firmId: string, input: CreatePaymentInput): Promise<Payment> {
    const id = newId("pay");
    await this.db.query(
      `INSERT INTO payments (id, firm_id, client_id, invoice_id, amount, method, reference, received_date, deposited_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, firmId, input.clientId, input.invoiceId ?? null, input.amount, input.method, input.reference ?? null, input.receivedDate, input.depositedDate ?? null, input.notes ?? null],
    );
    const payment = (await this.getPayment(id))!;
    if (input.invoiceId) {
      await this.applyPayment(payment);
      await this.createCashReceiptJournal(firmId, input.clientId, id, input.amount, input.method, input.reference ?? null);
    }
    return payment;
  }

  async getPayment(id: string): Promise<Payment | null> {
    const [row] = await this.db.query<any>(`SELECT * FROM payments WHERE id = $1`, [id]);
    return row ? mapPayment(row) : null;
  }

  async getPaymentsByClient(clientId: string): Promise<Payment[]> {
    const rows = await this.db.query<any>(`SELECT * FROM payments WHERE client_id = $1 ORDER BY received_date DESC`, [clientId]);
    return rows.map(mapPayment);
  }

  async getPaymentsByInvoice(invoiceId: string): Promise<Payment[]> {
    const rows = await this.db.query<any>(`SELECT * FROM payments WHERE invoice_id = $1 ORDER BY received_date`, [invoiceId]);
    return rows.map(mapPayment);
  }

  async getClientBalance(clientId: string): Promise<{ totalInvoiced: number; totalPaid: number; balanceDue: number }> {
    const [invRow] = await this.db.query<any>(
      `SELECT COALESCE(SUM(total),0) as total_invoiced, COALESCE(SUM(amount_paid),0) as total_paid
       FROM invoices WHERE client_id = $1 AND status NOT IN ('draft', 'void')`,
      [clientId],
    );
    return {
      totalInvoiced: Number(invRow?.total_invoiced ?? 0),
      totalPaid: Number(invRow?.total_paid ?? 0),
      balanceDue: Number(invRow?.total_invoiced ?? 0) - Number(invRow?.total_paid ?? 0),
    };
  }

  async getAgingReport(firmId: string): Promise<Array<{
    clientId: string;
    clientName: string;
    current: number;
    days30: number;
    days60: number;
    days90: number;
    over90: number;
    totalDue: number;
  }>> {
    const today = new Date().toISOString().split('T')[0];
    const rows = await this.db.query<any>(`
      SELECT i.client_id, c.name as client_name,
        COALESCE(SUM(CASE WHEN i.balance_due > 0 AND i.due_date >= $1 THEN i.balance_due ELSE 0 END),0) as current,
        COALESCE(SUM(CASE WHEN i.balance_due > 0 AND i.due_date < $1 AND i.due_date >= $1 - INTERVAL '30 days' THEN i.balance_due ELSE 0 END),0) as days30,
        COALESCE(SUM(CASE WHEN i.balance_due > 0 AND i.due_date < $1 - INTERVAL '30 days' AND i.due_date >= $1 - INTERVAL '60 days' THEN i.balance_due ELSE 0 END),0) as days60,
        COALESCE(SUM(CASE WHEN i.balance_due > 0 AND i.due_date < $1 - INTERVAL '60 days' AND i.due_date >= $1 - INTERVAL '90 days' THEN i.balance_due ELSE 0 END),0) as days90,
        COALESCE(SUM(CASE WHEN i.balance_due > 0 AND i.due_date < $1 - INTERVAL '90 days' THEN i.balance_due ELSE 0 END),0) as over90,
        COALESCE(SUM(CASE WHEN i.balance_due > 0 THEN i.balance_due ELSE 0 END),0) as total_due
      FROM invoices i
      JOIN clients c ON c.id = i.client_id
      WHERE i.firm_id = $2 AND i.status IN ('sent', 'overdue') AND i.balance_due > 0
      GROUP BY i.client_id, c.name
      ORDER BY total_due DESC
    `, [today, firmId]);

    return rows.map(r => ({
      clientId: r.client_id,
      clientName: r.client_name,
      current: Number(r.current),
      days30: Number(r.days30),
      days60: Number(r.days60),
      days90: Number(r.days90),
      over90: Number(r.over90),
      totalDue: Number(r.total_due),
    }));
  }
}

export async function buildInvoicePdf(input: {
  firmName: string;
  clientName: string;
  clientEmail: string;
  invoice: Invoice & { lines: InvoiceLine[] };
  payments: Payment[];
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const margin = 72;
  let y = 792 - margin;

  const drawLine = (text: string, options: { size?: number; useBold?: boolean; gap?: number; x?: number } = {}) => {
    const size = options.size ?? 11;
    page.drawText(text, {
      x: options.x ?? margin,
      y,
      size,
      font: options.useBold ? bold : font,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= options.gap ?? size + 8;
  };

  const drawRight = (text: string, options: { size?: number; useBold?: boolean } = {}) => {
    const size = options.size ?? 11;
    const width = page.getWidth() - margin * 2;
    page.drawText(text, {
      x: page.getWidth() - margin - 200,
      y,
      size,
      font: options.useBold ? bold : font,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= size + 8;
  };

  // Header
  drawLine(input.firmName, { size: 16, useBold: true, gap: 4 });
  drawLine("INVOICE", { size: 14, useBold: true, gap: 20 });

  // Invoice meta
  const metaX = page.getWidth() - margin - 200;
  y = 792 - margin - 30;
  page.drawText(`Invoice #: ${input.invoice.number}`, { x: metaX, y, size: 10, font: bold, color: rgb(0.1, 0.1, 0.1) });
  y -= 16;
  page.drawText(`Date: ${new Date(input.invoice.issueDate).toLocaleDateString()}`, { x: metaX, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
  y -= 16;
  page.drawText(`Due: ${new Date(input.invoice.dueDate).toLocaleDateString()}`, { x: metaX, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
  y -= 16;
  const statusColor = input.invoice.status === 'paid' ? rgb(0, 0.6, 0) : input.invoice.status === 'overdue' ? rgb(0.8, 0, 0) : rgb(0.3, 0.3, 0.3);
  page.drawText(`Status: ${input.invoice.status.toUpperCase()}`, { x: metaX, y, size: 10, font: bold, color: statusColor });

  y = 792 - margin - 60;
  // Bill to
  drawLine("Bill To:", { useBold: true, gap: 14 });
  drawLine(input.clientName);
  drawLine(input.clientEmail);

  y -= 20;

  // Line items header
  const colDesc = margin;
  const colQty = 360;
  const colPrice = 430;
  const colTotal = 510;

  drawLine("Description", { x: colDesc, useBold: true, size: 10, gap: 0 });
  drawLine("Qty", { x: colQty, useBold: true, size: 10, gap: 0 });
  drawLine("Unit Price", { x: colPrice, useBold: true, size: 10, gap: 0 });
  drawLine("Total", { x: colTotal, useBold: true, size: 10, gap: 14 });

  // Horizontal rule
  page.drawLine({
    start: { x: margin, y },
    end: { x: page.getWidth() - margin, y },
    thickness: 1,
    color: rgb(0.7, 0.7, 0.7),
  });
  y -= 16;

  // Line items
  for (const line of input.invoice.lines) {
    if (y < 100) {
      doc.addPage([612, 792]);
      y = 792 - margin;
    }
    drawLine(line.description.substring(0, 55), { x: colDesc, size: 10, gap: 0 });
    drawLine(String(line.quantity), { x: colQty, size: 10, gap: 0 });
    drawLine(`$${line.unitPrice.toFixed(2)}`, { x: colPrice, size: 10, gap: 0 });
    drawLine(`$${line.lineTotal.toFixed(2)}`, { x: colTotal, size: 10, gap: 16 });
  }

  y -= 8;
  page.drawLine({
    start: { x: margin, y },
    end: { x: page.getWidth() - margin, y },
    thickness: 1,
    color: rgb(0.7, 0.7, 0.7),
  });
  y -= 16;

  // Totals
  const rightX = page.getWidth() - margin - 100;
  drawLine("Subtotal:", { x: rightX - 80, useBold: false, size: 10, gap: 0 });
  drawLine(`$${input.invoice.subtotal.toFixed(2)}`, { x: rightX, useBold: false, size: 10, gap: 14 });

  if (input.invoice.taxAmount > 0) {
    drawLine("Tax:", { x: rightX - 80, useBold: false, size: 10, gap: 0 });
    drawLine(`$${input.invoice.taxAmount.toFixed(2)}`, { x: rightX, useBold: false, size: 10, gap: 14 });
  }

  page.drawLine({
    start: { x: rightX - 80, y },
    end: { x: rightX + 80, y },
    thickness: 1,
    color: rgb(0.3, 0.3, 0.3),
  });
  y -= 16;

  drawLine("TOTAL:", { x: rightX - 80, useBold: true, size: 12, gap: 0 });
  drawLine(`$${input.invoice.total.toFixed(2)}`, { x: rightX, useBold: true, size: 12, gap: 14 });

  // Payments applied
  if (input.payments.length > 0) {
    y -= 10;
    drawLine("Payments Applied:", { useBold: true, gap: 12 });
    for (const p of input.payments) {
      drawLine(`${new Date(p.receivedDate).toLocaleDateString()} — ${p.method.toUpperCase()} — $${p.amount.toFixed(2)}${p.reference ? ` (${p.reference})` : ''}`, { size: 10, gap: 14 });
    }
    drawLine(`Amount Paid: $${input.invoice.amountPaid.toFixed(2)}`, { x: rightX - 80, useBold: true, size: 10, gap: 0 });
    drawLine(`Balance Due: $${input.invoice.balanceDue.toFixed(2)}`, { x: rightX, useBold: true, size: 10, gap: 14 });
  }

  // Notes
  if (input.invoice.notes) {
    y -= 20;
    drawLine("Notes:", { useBold: true, gap: 10 });
    const words = input.invoice.notes.split(" ");
    let line = "";
    for (const word of words) {
      if ((line + " " + word).length > 90) {
        drawLine(line, { size: 10 });
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) drawLine(line, { size: 10 });
  }

  return doc.save();
}

export async function buildStatementPdf(input: {
  firmName: string;
  clientName: string;
  clientEmail: string;
  invoices: (Invoice & { lines: InvoiceLine[] })[];
  payments: Payment[];
  balanceDue: number;
  asOfDate: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const margin = 72;
  let y = 792 - margin;

  const drawLine = (text: string, options: { size?: number; useBold?: boolean; gap?: number; x?: number } = {}) => {
    const size = options.size ?? 11;
    page.drawText(text, {
      x: options.x ?? margin,
      y,
      size,
      font: options.useBold ? bold : font,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= options.gap ?? size + 8;
  };

  drawLine(input.firmName, { size: 16, useBold: true, gap: 4 });
  drawLine("STATEMENT OF ACCOUNT", { size: 14, useBold: true, gap: 8 });
  drawLine(`As of ${new Date(input.asOfDate).toLocaleDateString()}`, { gap: 20 });
  drawLine(input.clientName);
  drawLine(input.clientEmail);

  y -= 10;
  page.drawLine({ start: { x: margin, y }, end: { x: page.getWidth() - margin, y }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
  y -= 16;

  const colDate = margin;
  const colDesc = 150;
  const colInv = 350;
  const colAmt = 430;
  const colBal = 510;

  drawLine("Date", { x: colDate, useBold: true, size: 10, gap: 0 });
  drawLine("Description", { x: colDesc, useBold: true, size: 10, gap: 0 });
  drawLine("Invoice", { x: colInv, useBold: true, size: 10, gap: 0 });
  drawLine("Amount", { x: colAmt, useBold: true, size: 10, gap: 0 });
  drawLine("Balance", { x: colBal, useBold: true, size: 10, gap: 14 });

  y -= 4;
  page.drawLine({ start: { x: margin, y }, end: { x: page.getWidth() - margin, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  y -= 12;

  let runningBalance = 0;
  const sorted = [...input.invoices].sort((a, b) => a.issueDate.localeCompare(b.issueDate));
  for (const inv of sorted) {
    if (y < 100) { doc.addPage([612, 792]); y = 792 - margin; }
    runningBalance += inv.total;
    drawLine(new Date(inv.issueDate).toLocaleDateString(), { x: colDate, size: 10, gap: 0 });
    drawLine(`Invoice ${inv.number}`, { x: colDesc, size: 10, gap: 0 });
    drawLine(inv.number, { x: colInv, size: 10, gap: 0 });
    drawLine(`$${inv.total.toFixed(2)}`, { x: colAmt, size: 10, gap: 0 });
    drawLine(`$${runningBalance.toFixed(2)}`, { x: colBal, size: 10, gap: 14 });
  }

  for (const pay of input.payments.sort((a, b) => a.receivedDate.localeCompare(b.receivedDate))) {
    if (y < 100) { doc.addPage([612, 792]); y = 792 - margin; }
    runningBalance -= pay.amount;
    drawLine(new Date(pay.receivedDate).toLocaleDateString(), { x: colDate, size: 10, gap: 0 });
    drawLine(`Payment (${pay.method.toUpperCase()})`, { x: colDesc, size: 10, gap: 0 });
    drawLine('', { x: colInv, size: 10, gap: 0 });
    drawLine(`-$${pay.amount.toFixed(2)}`, { x: colAmt, size: 10, gap: 0 });
    drawLine(`$${runningBalance.toFixed(2)}`, { x: colBal, size: 10, gap: 14 });
  }

  y -= 10;
  page.drawLine({ start: { x: margin, y }, end: { x: page.getWidth() - margin, y }, thickness: 1, color: rgb(0.3, 0.3, 0.3) });
  y -= 16;
  drawLine("BALANCE DUE:", { x: colDesc, useBold: true, size: 12, gap: 0 });
  drawLine(`$${input.balanceDue.toFixed(2)}`, { x: colBal, useBold: true, size: 12, gap: 14 });

  return doc.save();
}