import type { Db } from "../db";
import { newId } from "../lib/id";
import Stripe from "stripe";

export interface StripeConfig {
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
  connectClientId?: string;
}

export interface StripeCustomer {
  id: string;
  firmId: string;
  clientId: string;
  stripeCustomerId: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface StripePaymentMethod {
  id: string;
  firmId: string;
  clientId: string;
  stripeCustomerId: string;
  stripePaymentMethodId: string;
  type: 'card' | 'us_bank_account' | 'acss_debit' | 'link';
  cardBrand: string | null;
  cardLast4: string | null;
  cardExpMonth: number | null;
  cardExpYear: number | null;
  bankName: string | null;
  bankLast4: string | null;
  isDefault: boolean;
  billingDetails: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface StripeWebhookEvent {
  id: string;
  firmId: string;
  stripeEventId: string;
  eventType: string;
  payload: any;
  processed: boolean;
  processingError: string | null;
  attempts: number;
  lastAttemptAt: Date | null;
  createdAt: Date;
  processedAt: Date | null;
}

export interface InvoiceSchedule {
  id: string;
  firmId: string;
  clientId: string;
  engagementId: string | null;
  name: string;
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  intervalCount: number;
  startDate: string;
  endDate: string | null;
  nextRunDate: string;
  lastRunDate: string | null;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  template: any;
  autoSend: boolean;
  createdAt: Date;
  updatedAt: Date;
  runCount: number;
}

export interface PaymentReminder {
  id: string;
  firmId: string;
  invoiceId: string;
  reminderType: 'due_soon' | 'due_today' | 'overdue_1' | 'overdue_7' | 'overdue_30' | 'custom';
  daysOffset: number;
  status: 'pending' | 'sent' | 'skipped' | 'failed';
  sentAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StripeConnectAccount {
  id: string;
  firmId: string;
  stripeAccountId: string;
  accountType: 'standard' | 'express' | 'custom';
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirements: any;
  capabilities: any;
  businessType: string | null;
  businessProfile: any;
  createdAt: Date;
  updatedAt: Date;
}

export class StripeService {
  private db: Db;
  private config: StripeConfig;
  private stripe: Stripe;

  constructor(db: Db, config: StripeConfig) {
    this.db = db;
    this.config = config;
    this.stripe = new Stripe(this.config.secretKey, {
      apiVersion: '2026-08-26.dahlia',
      typescript: true,
    });
  }

  // ========== Customer Management ==========

  async getOrCreateCustomer(firmId: string, clientId: string, clientData: { email: string; name: string; phone?: string }): Promise<StripeCustomer> {
    // Check local DB first
    const [existing] = await this.db.query<any>(
      `SELECT * FROM stripe_customers WHERE firm_id = $1 AND client_id = $2`,
      [firmId, clientId],
    );

    if (existing) {
      // Sync with Stripe to ensure it exists
      try {
        await this.stripe.customers.retrieve(existing.stripe_customer_id);
        return this.mapCustomer(existing);
      } catch (e) {
        // Customer deleted in Stripe, recreate
      }
    }

    // Create in Stripe
    const stripeCustomer = await this.stripe.customers.create({
      email: clientData.email,
      name: clientData.name,
      phone: clientData.phone,
      metadata: {
        folio_firm_id: firmId,
        folio_client_id: clientId,
      },
    });

    // Store locally
    const id = newId("strc");
    await this.db.query(
      `INSERT INTO stripe_customers (id, firm_id, client_id, stripe_customer_id, email, name, phone, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, firmId, clientId, stripeCustomer.id, clientData.email, clientData.name, clientData.phone ?? null, JSON.stringify({ folio_firm_id: firmId, folio_client_id: clientId })],
    );

    return {
      id,
      firmId,
      clientId,
      stripeCustomerId: stripeCustomer.id,
      email: clientData.email,
      name: clientData.name,
      phone: clientData.phone ?? null,
      metadata: { folio_firm_id: firmId, folio_client_id: clientId },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async getCustomer(firmId: string, clientId: string): Promise<StripeCustomer | null> {
    const [row] = await this.db.query<any>(
      `SELECT * FROM stripe_customers WHERE firm_id = $1 AND client_id = $2`,
      [firmId, clientId],
    );
    return row ? this.mapCustomer(row) : null;
  }

  async syncPaymentMethodsFromStripe(firmId: string, clientId: string): Promise<StripePaymentMethod[]> {
    const customer = await this.getCustomer(firmId, clientId);
    if (!customer) return [];

    
    const paymentMethods = await this.stripe.paymentMethods.list({
      customer: customer.stripeCustomerId,
      type: 'card', // Start with cards, can expand
    });

    const results: StripePaymentMethod[] = [];
    for (const pm of paymentMethods.data) {
      const saved = await this.savePaymentMethod({
        firmId,
        clientId,
        stripeCustomerId: customer.stripeCustomerId,
        stripePaymentMethodId: pm.id,
        type: pm.type as any,
        cardBrand: pm.card?.brand ?? null,
        cardLast4: pm.card?.last4 ?? null,
        cardExpMonth: pm.card?.exp_month ?? null,
        cardExpYear: pm.card?.exp_year ?? null,
        bankName: null,
        bankLast4: null,
        isDefault: false,
        billingDetails: pm.billing_details ?? {},
      });
      results.push(saved);
    }
    return results;
  }

  async savePaymentMethod(input: {
    firmId: string;
    clientId: string;
    stripeCustomerId: string;
    stripePaymentMethodId: string;
    type: 'card' | 'us_bank_account' | 'acss_debit' | 'link';
    cardBrand: string | null;
    cardLast4: string | null;
    cardExpMonth: number | null;
    cardExpYear: number | null;
    bankName: string | null;
    bankLast4: string | null;
    isDefault: boolean;
    billingDetails: Record<string, any>;
  }): Promise<StripePaymentMethod> {
    // If this is default, unset other defaults
    if (input.isDefault) {
      await this.db.query(
        `UPDATE stripe_payment_methods SET is_default = FALSE WHERE client_id = $1 AND firm_id = $2`,
        [input.clientId, input.firmId],
      );
    }

    await this.db.query(
      `INSERT INTO stripe_payment_methods (id, firm_id, client_id, stripe_customer_id, stripe_payment_method_id, type, card_brand, card_last4, card_exp_month, card_exp_year, bank_name, bank_last4, is_default, billing_details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (stripe_payment_method_id) DO UPDATE SET
         type = EXCLUDED.type,
         card_brand = EXCLUDED.card_brand,
         card_last4 = EXCLUDED.card_last4,
         card_exp_month = EXCLUDED.card_exp_month,
         card_exp_year = EXCLUDED.card_exp_year,
         bank_name = EXCLUDED.bank_name,
         bank_last4 = EXCLUDED.bank_last4,
         is_default = EXCLUDED.is_default,
         billing_details = EXCLUDED.billing_details,
         updated_at = NOW()`,
      [newId("strpm"), input.firmId, input.clientId, input.stripeCustomerId, input.stripePaymentMethodId,
       input.type, input.cardBrand, input.cardLast4, input.cardExpMonth, input.cardExpYear,
       input.bankName, input.bankLast4, input.isDefault, JSON.stringify(input.billingDetails)],
    );

    const [row] = await this.db.query<any>(
      `SELECT * FROM stripe_payment_methods WHERE stripe_payment_method_id = $1`,
      [input.stripePaymentMethodId],
    );
    return this.mapPaymentMethod(row);
  }

  async getPaymentMethods(firmId: string, clientId: string): Promise<StripePaymentMethod[]> {
    const rows = await this.db.query<any>(
      `SELECT * FROM stripe_payment_methods WHERE firm_id = $1 AND client_id = $2 ORDER BY is_default DESC, created_at DESC`,
      [firmId, clientId],
    );
    return rows.map(this.mapPaymentMethod);
  }

  async setDefaultPaymentMethod(firmId: string, clientId: string, paymentMethodId: string): Promise<void> {
    await this.db.query(
      `UPDATE stripe_payment_methods SET is_default = FALSE WHERE client_id = $1 AND firm_id = $2`,
      [clientId, firmId],
    );
    await this.db.query(
      `UPDATE stripe_payment_methods SET is_default = TRUE WHERE id = $1 AND client_id = $2 AND firm_id = $3`,
      [paymentMethodId, clientId, firmId],
    );
  }

  // ========== Payment Intents ==========

  async createPaymentIntent(input: {
    amount: number; // in cents
    currency: string;
    customerId: string;
    invoiceId?: string;
    paymentMethodId?: string;
    description?: string;
    metadata?: Record<string, string>;
    confirm?: boolean;
    automaticPaymentMethods?: { enabled: boolean; allow_redirects?: 'never' | 'always' };
  }): Promise<any> {
    
    const params: any = {
      amount: input.amount,
      currency: input.currency,
      customer: input.customerId,
      description: input.description,
      metadata: input.metadata ?? {},
      automatic_payment_methods: input.automaticPaymentMethods ?? { enabled: true, allow_redirects: 'never' },
    };
    if (input.paymentMethodId) {
      params.payment_method = input.paymentMethodId;
    }
    if (input.confirm) {
      params.confirm = true;
    }
    return this.stripe.paymentIntents.create(params);
  }

  async confirmPaymentIntent(paymentIntentId: string, paymentMethodId?: string): Promise<any> {
    
    const params: any = {};
    if (paymentMethodId) params.payment_method = paymentMethodId;
    return this.stripe.paymentIntents.confirm(paymentIntentId, params);
  }

  async retrievePaymentIntent(paymentIntentId: string): Promise<any> {
    
    return this.stripe.paymentIntents.retrieve(paymentIntentId);
  }

  // ========== Webhooks ==========

  async logWebhookEvent(input: {
    firmId: string;
    stripeEventId: string;
    eventType: string;
    payload: any;
  }): Promise<StripeWebhookEvent> {
    const id = newId("strwe");
    await this.db.query(
      `INSERT INTO stripe_webhook_events (id, firm_id, stripe_event_id, event_type, payload)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (stripe_event_id) DO UPDATE SET
         payload = EXCLUDED.payload,
         attempts = stripe_webhook_events.attempts + 1,
         last_attempt_at = NOW()`,
      [id, input.firmId, input.stripeEventId, input.eventType, JSON.stringify(input.payload)],
    );
    const [row] = await this.db.query<any>(
      `SELECT * FROM stripe_webhook_events WHERE id = $1`,
      [id],
    );
    return this.mapWebhookEvent(row);
  }

  async markWebhookProcessed(eventId: string, error?: string): Promise<void> {
    await this.db.query(
      `UPDATE stripe_webhook_events
       SET processed = TRUE, processing_error = $1, processed_at = NOW()
       WHERE id = $2`,
      [error ?? null, eventId],
    );
  }

  async getUnprocessedWebhooks(firmId: string, limit = 100): Promise<StripeWebhookEvent[]> {
    const rows = await this.db.query<any>(
      `SELECT * FROM stripe_webhook_events
       WHERE firm_id = $1 AND processed = FALSE
       ORDER BY created_at ASC
       LIMIT $2`,
      [firmId, limit],
    );
    return rows.map(this.mapWebhookEvent);
  }

  async retryFailedWebhooks(firmId: string, maxAttempts = 3): Promise<number> {
    const rows = await this.db.query<any>(
      `SELECT * FROM stripe_webhook_events
       WHERE firm_id = $1 AND processed = FALSE AND attempts < $2
       ORDER BY created_at ASC`,
      [firmId, maxAttempts],
    );
    let retried = 0;
    for (const row of rows) {
      await this.db.query(
        `UPDATE stripe_webhook_events SET attempts = attempts + 1, last_attempt_at = NOW() WHERE id = $1`,
        [row.id],
      );
      retried++;
    }
    return retried;
  }

  // ========== Invoice Schedules ==========

  async createInvoiceSchedule(input: {
    firmId: string;
    clientId: string;
    engagementId?: string | null;
    name: string;
    frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
    intervalCount: number;
    startDate: string;
    endDate?: string | null;
    template: any;
    autoSend: boolean;
  }): Promise<InvoiceSchedule> {
    const nextRunDate = this.calculateNextRunDate(input.startDate, input.frequency, input.intervalCount);
    const id = newId("insc");
    await this.db.query(
      `INSERT INTO invoice_schedules (id, firm_id, client_id, engagement_id, name, frequency, interval_count, start_date, end_date, next_run_date, status, template, auto_send)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$12)`,
      [id, input.firmId, input.clientId, input.engagementId ?? null, input.name, input.frequency, input.intervalCount,
       input.startDate, input.endDate ?? null, nextRunDate, JSON.stringify(input.template), input.autoSend],
    );
    const schedule = await this.getInvoiceSchedule(id);
    if (!schedule) throw new Error(`Invoice schedule ${id} not found`);
    return schedule;
  }

  async getInvoiceSchedule(id: string): Promise<InvoiceSchedule | null> {
    const [row] = await this.db.query<any>(`SELECT * FROM invoice_schedules WHERE id = $1`, [id]);
    return row ? this.mapInvoiceSchedule(row) : null;
  }

  async getInvoiceSchedulesByFirm(firmId: string, status?: string): Promise<InvoiceSchedule[]> {
    let sql = `SELECT * FROM invoice_schedules WHERE firm_id = $1`;
    const params: any[] = [firmId];
    if (status) { sql += ` AND status = $2`; params.push(status); }
    sql += ` ORDER BY next_run_date ASC`;
    const rows = await this.db.query<any>(sql, params);
    return rows.map(this.mapInvoiceSchedule);
  }

  async getDueInvoiceSchedules(firmId: string): Promise<InvoiceSchedule[]> {
    const today = new Date().toISOString().split('T')[0];
    const rows = await this.db.query<any>(
      `SELECT * FROM invoice_schedules WHERE firm_id = $1 AND status = 'active' AND next_run_date <= $2`,
      [firmId, today],
    );
    return rows.map(this.mapInvoiceSchedule);
  }

  async processInvoiceSchedule(scheduleId: string, billingService: any): Promise<{ invoice: any; schedule: InvoiceSchedule } | null> {
    const schedule = await this.getInvoiceSchedule(scheduleId);
    if (!schedule || schedule.status !== 'active') return null;

    // Generate invoice from template
    const template = schedule.template;
    const invoice = await billingService.createInvoice(schedule.firmId, {
      clientId: schedule.clientId,
      engagementId: schedule.engagementId,
      issueDate: new Date().toISOString().split('T')[0],
      dueDate: this.calculateDueDate(new Date().toISOString().split('T')[0], template.dueDays ?? 30),
      lines: template.lines,
      notes: template.notes,
      memo: template.memo,
    });

    if (schedule.autoSend) {
      await billingService.sendInvoice(invoice.id);
    }

    // Update schedule
    const nextRunDate = this.calculateNextRunDate(schedule.nextRunDate, schedule.frequency, schedule.intervalCount);
    const endReached = schedule.endDate && nextRunDate > schedule.endDate;
    const newStatus = endReached ? 'completed' : 'active';

    await this.db.query(
      `UPDATE invoice_schedules SET last_run_date = $1, next_run_date = $2, status = $3, run_count = run_count + 1, updated_at = NOW() WHERE id = $4`,
      [schedule.nextRunDate, nextRunDate, newStatus, schedule.id],
    );

    // Create payment reminders for this invoice
    await this.createPaymentRemindersForInvoice(schedule.firmId, invoice.id);

    const updatedSchedule = await this.getInvoiceSchedule(scheduleId);
    if (!updatedSchedule) throw new Error(`Invoice schedule ${scheduleId} not found after processing`);
    return { invoice, schedule: updatedSchedule };
  }

  async pauseSchedule(id: string): Promise<void> {
    await this.db.query(`UPDATE invoice_schedules SET status = 'paused', updated_at = NOW() WHERE id = $1`, [id]);
  }

  async resumeSchedule(id: string): Promise<void> {
    const schedule = await this.getInvoiceSchedule(id);
    if (!schedule) return;
    const nextRunDate = this.calculateNextRunDate(new Date().toISOString().split('T')[0], schedule.frequency, schedule.intervalCount);
    await this.db.query(`UPDATE invoice_schedules SET status = 'active', next_run_date = $1, updated_at = NOW() WHERE id = $2`, [nextRunDate, id]);
  }

  async cancelSchedule(id: string): Promise<void> {
    await this.db.query(`UPDATE invoice_schedules SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [id]);
  }

  // ========== Payment Reminders ==========

  async createPaymentRemindersForInvoice(firmId: string, invoiceId: string): Promise<PaymentReminder[]> {
    const [invoice] = await this.db.query<any>(
      `SELECT due_date FROM invoices WHERE id = $1`,
      [invoiceId],
    );
    if (!invoice) return [];

    const dueDate = new Date(invoice.due_date);
    const reminders: Array<{ type: PaymentReminder['reminderType']; daysOffset: number }> = [
      { type: 'due_soon', daysOffset: -7 },
      { type: 'due_today', daysOffset: 0 },
      { type: 'overdue_1', daysOffset: 1 },
      { type: 'overdue_7', daysOffset: 7 },
      { type: 'overdue_30', daysOffset: 30 },
    ];

    const created: PaymentReminder[] = [];
    for (const r of reminders) {
      const id = newId("prm");
      await this.db.query(
        `INSERT INTO payment_reminders (id, firm_id, invoice_id, reminder_type, days_offset, status)
         VALUES ($1,$2,$3,$4,$5,'pending')
         ON CONFLICT (invoice_id, reminder_type) DO NOTHING`,
        [id, firmId, invoiceId, r.type, r.daysOffset],
      );
      const [row] = await this.db.query<any>(`SELECT * FROM payment_reminders WHERE id = $1`, [id]);
      if (row) created.push(this.mapPaymentReminder(row));
    }
    return created;
  }

  async getPendingReminders(firmId: string): Promise<PaymentReminder[]> {
    const today = new Date().toISOString().split('T')[0];
    const rows = await this.db.query<any>(
      `SELECT pr.*, i.due_date
       FROM payment_reminders pr
       JOIN invoices i ON i.id = pr.invoice_id
       WHERE pr.firm_id = $1 AND pr.status = 'pending'
         AND i.due_date + (pr.days_offset || 0)::int * INTERVAL '1 day' <= $2::date`,
      [firmId, today],
    );
    return rows.map(r => ({ ...this.mapPaymentReminder(r), dueDate: r.due_date }));
  }

  async sendReminder(reminderId: string, emailService: any): Promise<void> {
    const [row] = await this.db.query<any>(
      `SELECT pr.*, i.number as invoice_number, i.total, i.due_date, i.balance_due, c.email, c.name
       FROM payment_reminders pr
       JOIN invoices i ON i.id = pr.invoice_id
       JOIN clients c ON c.id = i.client_id
       WHERE pr.id = $1`,
      [reminderId],
    );
    if (!row) throw new Error("Reminder not found");

    const template = this.getReminderTemplate(row.reminder_type);
    await emailService.send({
      to: row.email,
      subject: template.subject.replace('{invoice_number}', row.invoice_number),
      html: template.html
        .replace('{client_name}', row.name)
        .replace('{invoice_number}', row.invoice_number)
        .replace('{amount}', `$${Number(row.balance_due).toFixed(2)}`)
        .replace('{due_date}', new Date(row.due_date).toLocaleDateString()),
    });

    await this.db.query(
      `UPDATE payment_reminders SET status = 'sent', sent_at = NOW() WHERE id = $1`,
      [reminderId],
    );
  }

  async markReminderFailed(reminderId: string, error: string): Promise<void> {
    await this.db.query(
      `UPDATE payment_reminders SET status = 'failed', error_message = $1 WHERE id = $2`,
      [error, reminderId],
    );
  }

  // ========== Stripe Connect ==========

  async createConnectAccount(firmId: string, type: 'standard' | 'express' = 'express'): Promise<StripeConnectAccount> {
    
    const stripeAccount = await this.stripe.accounts.create({
      type,
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      business_type: 'company',
    });

    const id = newId("strca");
    await this.db.query(
      `INSERT INTO stripe_connect_accounts (id, firm_id, stripe_account_id, account_type, charges_enabled, payouts_enabled, details_submitted, requirements, capabilities)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (firm_id) DO UPDATE SET
         stripe_account_id = EXCLUDED.stripe_account_id,
         account_type = EXCLUDED.account_type,
         updated_at = NOW()`,
      [id, firmId, stripeAccount.id, type, stripeAccount.charges_enabled, stripeAccount.payouts_enabled, stripeAccount.details_submitted, JSON.stringify(stripeAccount.requirements), JSON.stringify(stripeAccount.capabilities)],
    );

    const account = await this.getConnectAccount(firmId);
    if (!account) throw new Error(`Connect account for firm ${firmId} not found`);
    return account;
  }

  async getConnectAccount(firmId: string): Promise<StripeConnectAccount | null> {
    const [row] = await this.db.query<any>(`SELECT * FROM stripe_connect_accounts WHERE firm_id = $1`, [firmId]);
    return row ? this.mapConnectAccount(row) : null;
  }

  async createAccountLink(firmId: string, refreshUrl: string, returnUrl: string): Promise<string> {
    const account = await this.getConnectAccount(firmId);
    if (!account) throw new Error("Connect account not found");

    
    const accountLink = await this.stripe.accountLinks.create({
      account: account.stripeAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
    return accountLink.url;
  }

  async syncConnectAccount(firmId: string): Promise<void> {
    const account = await this.getConnectAccount(firmId);
    if (!account) return;

    
    const stripeAccount = await this.stripe.accounts.retrieve(account.stripeAccountId);
    await this.db.query(
      `UPDATE stripe_connect_accounts SET
         charges_enabled = $1, payouts_enabled = $2, details_submitted = $3,
         requirements = $4, capabilities = $5, business_type = $6, business_profile = $7, updated_at = NOW()
       WHERE firm_id = $8`,
      [stripeAccount.charges_enabled, stripeAccount.payouts_enabled, stripeAccount.details_submitted,
       JSON.stringify(stripeAccount.requirements), JSON.stringify(stripeAccount.capabilities),
       stripeAccount.business_type ?? null, JSON.stringify(stripeAccount.business_profile ?? {}), firmId],
    );
  }

  // ========== Helpers ==========

  private calculateNextRunDate(fromDate: string, frequency: string, intervalCount: number): string {
    const date = new Date(fromDate);
    switch (frequency) {
      case 'weekly': date.setDate(date.getDate() + 7 * intervalCount); break;
      case 'monthly': date.setMonth(date.getMonth() + intervalCount); break;
      case 'quarterly': date.setMonth(date.getMonth() + 3 * intervalCount); break;
      case 'yearly': date.setFullYear(date.getFullYear() + intervalCount); break;
    }
    return date.toISOString().split('T')[0];
  }

  private calculateDueDate(fromDate: string, dueDays: number): string {
    const date = new Date(fromDate);
    date.setDate(date.getDate() + dueDays);
    return date.toISOString().split('T')[0];
  }

  private getReminderTemplate(type: string): { subject: string; html: string } {
    const templates: Record<string, { subject: string; html: string }> = {
      due_soon: {
        subject: 'Upcoming Payment Due: Invoice {invoice_number}',
        html: '<p>Hi {client_name},</p><p>This is a friendly reminder that invoice <strong>{invoice_number}</strong> for <strong>{amount}</strong> is due on {due_date}.</p><p>You can pay securely online via the link in the original invoice email.</p><p>Thank you!</p>',
      },
      due_today: {
        subject: 'Payment Due Today: Invoice {invoice_number}',
        html: '<p>Hi {client_name},</p><p>Invoice <strong>{invoice_number}</strong> for <strong>{amount}</strong> is due today.</p><p>Please submit payment at your earliest convenience.</p><p>Thank you!</p>',
      },
      overdue_1: {
        subject: 'Past Due: Invoice {invoice_number}',
        html: '<p>Hi {client_name},</p><p>Invoice <strong>{invoice_number}</strong> for <strong>{amount}</strong> was due on {due_date} and is now past due.</p><p>Please remit payment as soon as possible to avoid further action.</p><p>Thank you!</p>',
      },
      overdue_7: {
        subject: 'Second Notice: Invoice {invoice_number} is 7 Days Overdue',
        html: '<p>Hi {client_name},</p><p>This is a second notice that invoice <strong>{invoice_number}</strong> for <strong>{amount}</strong> is now 7 days overdue (due {due_date}).</p><p>Please contact us immediately to resolve this balance.</p><p>Thank you!</p>',
      },
      overdue_30: {
        subject: 'Final Notice: Invoice {invoice_number} is 30 Days Overdue',
        html: '<p>Hi {client_name},</p><p>Invoice <strong>{invoice_number}</strong> for <strong>{amount}</strong> is now 30 days overdue (due {due_date}).</p><p>This matter may be escalated to collections if not resolved promptly.</p><p>Thank you!</p>',
      },
    };
    return templates[type] || templates.due_soon;
  }

  // ========== Mappers ==========

  private mapCustomer(row: any): StripeCustomer {
    return {
      id: row.id,
      firmId: row.firm_id,
      clientId: row.client_id,
      stripeCustomerId: row.stripe_customer_id,
      email: row.email,
      name: row.name,
      phone: row.phone,
      metadata: row.metadata,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapPaymentMethod(row: any): StripePaymentMethod {
    return {
      id: row.id,
      firmId: row.firm_id,
      clientId: row.client_id,
      stripeCustomerId: row.stripe_customer_id,
      stripePaymentMethodId: row.stripe_payment_method_id,
      type: row.type,
      cardBrand: row.card_brand,
      cardLast4: row.card_last4,
      cardExpMonth: row.card_exp_month,
      cardExpYear: row.card_exp_year,
      bankName: row.bank_name,
      bankLast4: row.bank_last4,
      isDefault: row.is_default,
      billingDetails: row.billing_details,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapWebhookEvent(row: any): StripeWebhookEvent {
    return {
      id: row.id,
      firmId: row.firm_id,
      stripeEventId: row.stripe_event_id,
      eventType: row.event_type,
      payload: row.payload,
      processed: row.processed,
      processingError: row.processing_error,
      attempts: row.attempts,
      lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at) : null,
      createdAt: new Date(row.created_at),
      processedAt: row.processed_at ? new Date(row.processed_at) : null,
    };
  }

  private mapInvoiceSchedule(row: any): InvoiceSchedule {
    return {
      id: row.id,
      firmId: row.firm_id,
      clientId: row.client_id,
      engagementId: row.engagement_id,
      name: row.name,
      frequency: row.frequency,
      intervalCount: row.interval_count,
      startDate: row.start_date,
      endDate: row.end_date,
      nextRunDate: row.next_run_date,
      lastRunDate: row.last_run_date,
      status: row.status,
      template: row.template,
      autoSend: row.auto_send,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      runCount: row.run_count,
    };
  }

  private mapPaymentReminder(row: any): PaymentReminder {
    return {
      id: row.id,
      firmId: row.firm_id,
      invoiceId: row.invoice_id,
      reminderType: row.reminder_type,
      daysOffset: row.days_offset,
      status: row.status,
      sentAt: row.sent_at ? new Date(row.sent_at) : null,
      errorMessage: row.error_message,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapConnectAccount(row: any): StripeConnectAccount {
    return {
      id: row.id,
      firmId: row.firm_id,
      stripeAccountId: row.stripe_account_id,
      accountType: row.account_type,
      chargesEnabled: row.charges_enabled,
      payoutsEnabled: row.payouts_enabled,
      detailsSubmitted: row.details_submitted,
      requirements: row.requirements,
      capabilities: row.capabilities,
      businessType: row.business_type,
      businessProfile: row.business_profile,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}