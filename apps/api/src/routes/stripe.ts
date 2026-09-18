import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { getEngagement } from "../services/engagements";
import { StripeService } from "../services/stripe";
import { BillingService } from "../services/billing";
import { newId } from "../lib/id";
import Stripe from "stripe";

export const stripeRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
stripeRoutes.use("*", requireSession);
stripeRoutes.use("*", requireActiveBeta);

// ========== Stripe Connect Onboarding ==========

stripeRoutes.get("/connect/status", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const stripeService = new StripeService(db, {
    secretKey: c.env.STRIPE_SECRET_KEY!,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY!,
    webhookSecret: c.env.STRIPE_WEBHOOK_SECRET!,
    connectClientId: c.env.STRIPE_CONNECT_CLIENT_ID,
  });

  const account = await stripeService.getConnectAccount(firm.id);
  if (!account) {
    return c.json({ connected: false });
  }

  await stripeService.syncConnectAccount(firm.id);
  const updated = await stripeService.getConnectAccount(firm.id);

  return c.json({
    connected: true,
    chargesEnabled: updated?.chargesEnabled,
    payoutsEnabled: updated?.payoutsEnabled,
    detailsSubmitted: updated?.detailsSubmitted,
    requirements: updated?.requirements,
  });
});

stripeRoutes.post("/connect/create", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const body = z.object({
    type: z.enum(['standard', 'express']).default('express'),
  }).parse(await c.req.json().catch(() => ({})));

  const stripeService = new StripeService(db, {
    secretKey: c.env.STRIPE_SECRET_KEY!,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY!,
    webhookSecret: c.env.STRIPE_WEBHOOK_SECRET!,
    connectClientId: c.env.STRIPE_CONNECT_CLIENT_ID,
  });

  const account = await stripeService.createConnectAccount(firm.id, body.type);
  return c.json({ account });
});

stripeRoutes.post("/connect/link", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const body = z.object({
    refreshUrl: z.string().url(),
    returnUrl: z.string().url(),
  }).parse(await c.req.json());

  const stripeService = new StripeService(db, {
    secretKey: c.env.STRIPE_SECRET_KEY!,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY!,
    webhookSecret: c.env.STRIPE_WEBHOOK_SECRET!,
    connectClientId: c.env.STRIPE_CONNECT_CLIENT_ID,
  });

  const account = await stripeService.getConnectAccount(firm.id);
  if (!account) {
    return c.json({ error: "Stripe Connect not set up. Create account first." }, 400);
  }

  const link = await stripeService.createAccountLink(firm.id, body.refreshUrl, body.returnUrl);
  return c.json({ url: link });
});

stripeRoutes.post("/connect/disconnect", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  await db.query(`DELETE FROM stripe_connect_accounts WHERE firm_id = $1`, [firm.id]);

  return c.json({ ok: true });
});

// ========== Customer & Payment Methods ==========

stripeRoutes.post("/customers/sync", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const body = z.object({ clientId: z.string() }).parse(await c.req.json());
  const client = await getClient(db, body.clientId, firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const stripeService = new StripeService(db, {
    secretKey: c.env.STRIPE_SECRET_KEY!,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY!,
    webhookSecret: c.env.STRIPE_WEBHOOK_SECRET!,
  });

  const customer = await stripeService.getOrCreateCustomer(firm.id, client.id, {
    email: client.email ?? "",
    name: client.name,
    phone: undefined,
  });

  const paymentMethods = await stripeService.syncPaymentMethodsFromStripe(firm.id, client.id);

  return c.json({ customer, paymentMethods });
});

stripeRoutes.get("/customers/:clientId/payment-methods", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const stripeService = new StripeService(db, {
    secretKey: c.env.STRIPE_SECRET_KEY!,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY!,
    webhookSecret: c.env.STRIPE_WEBHOOK_SECRET!,
  });

  const paymentMethods = await stripeService.getPaymentMethods(firm.id, client.id);
  return c.json({ paymentMethods });
});

stripeRoutes.post("/customers/:clientId/payment-methods/default", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = z.object({ paymentMethodId: z.string() }).parse(await c.req.json());

  const stripeService = new StripeService(db, {
    secretKey: c.env.STRIPE_SECRET_KEY!,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY!,
    webhookSecret: c.env.STRIPE_WEBHOOK_SECRET!,
  });

  await stripeService.setDefaultPaymentMethod(firm.id, client.id, body.paymentMethodId);
  return c.json({ ok: true });
});

// ========== Payment Intents for Invoices ==========

stripeRoutes.post("/invoices/:invoiceId/payment-intent", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const body = z.object({
    paymentMethodId: z.string().optional(),
    confirm: z.boolean().default(false),
    automaticPaymentMethods: z.object({
      enabled: z.boolean().default(true),
      allowRedirects: z.enum(['never', 'always']).default('never'),
    }).optional(),
  }).parse(await c.req.json());

  const billingService = new BillingService(db);
  const invoice = await billingService.getInvoice(c.req.param("invoiceId"));
  if (!invoice || invoice.firmId !== firm.id) {
    return c.json({ error: "Invoice not found" }, 404);
  }
  if (invoice.status === 'paid' || invoice.status === 'void') {
    return c.json({ error: "Invoice cannot be paid" }, 409);
  }

  const client = await getClient(db, invoice.clientId, firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const stripeService = new StripeService(db, {
    secretKey: c.env.STRIPE_SECRET_KEY!,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY!,
    webhookSecret: c.env.STRIPE_WEBHOOK_SECRET!,
  });

  // Ensure customer exists
  const customer = await stripeService.getOrCreateCustomer(firm.id, client.id, {
    email: client.email ?? "",
    name: client.name,
  });

  // Get default payment method
  const paymentMethods = await stripeService.getPaymentMethods(firm.id, client.id);
  const defaultPm = paymentMethods.find(pm => pm.isDefault);

  const amountCents = Math.round(invoice.balanceDue * 100);

  const paymentIntent = await stripeService.createPaymentIntent({
    amount: amountCents,
    currency: 'usd',
    customerId: customer.stripeCustomerId,
    invoiceId: invoice.id,
    paymentMethodId: body.paymentMethodId ?? defaultPm?.stripePaymentMethodId,
    description: `Invoice ${invoice.number}`,
    metadata: { invoiceId: invoice.id, firmId: firm.id },
    confirm: body.confirm,
    automaticPaymentMethods: body.automaticPaymentMethods,
  });

  return c.json({
    paymentIntentId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret,
    status: paymentIntent.status,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
  });
});

stripeRoutes.post("/invoices/:invoiceId/confirm-payment", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const body = z.object({
    paymentIntentId: z.string(),
    paymentMethodId: z.string().optional(),
  }).parse(await c.req.json());

  const billingService = new BillingService(db);
  const invoice = await billingService.getInvoice(c.req.param("invoiceId"));
  if (!invoice || invoice.firmId !== firm.id) {
    return c.json({ error: "Invoice not found" }, 404);
  }

  const stripeService = new StripeService(db, {
    secretKey: c.env.STRIPE_SECRET_KEY!,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY!,
    webhookSecret: c.env.STRIPE_WEBHOOK_SECRET!,
  });

  const confirmed = await stripeService.confirmPaymentIntent(body.paymentIntentId, body.paymentMethodId);

  if (confirmed.status === 'succeeded') {
    const billing = new BillingService(db);
    await billing.createPayment(firm.id, {
      clientId: invoice.clientId,
      invoiceId: invoice.id,
      amount: confirmed.amount / 100,
      method: 'credit_card',
      reference: `pi_${confirmed.id}`,
      receivedDate: new Date().toISOString().split('T')[0],
    });

    // Refresh invoice
    const updatedInvoice = await billingService.getInvoice(invoice.id);
    return c.json({ invoice: updatedInvoice, paymentIntent: confirmed });
  }

  return c.json({ paymentIntent: confirmed });
});

// ========== Webhook Endpoint (public, no auth) ==========

stripeRoutes.post("/webhook", async (c) => {
  const db = createDb(c.env);
  const stripeSecretKey = c.env.STRIPE_SECRET_KEY!;

  const signature = c.req.header('stripe-signature');
  if (!signature) {
    return c.json({ error: "Missing stripe-signature header" }, 400);
  }

  const body = await c.req.text();
  const webhookSecret = c.env.STRIPE_WEBHOOK_SECRET!;

  let event: any;
  try {
    const stripeInstance = new Stripe(stripeSecretKey, { apiVersion: '2026-08-26.dahlia' });
    event = stripeInstance.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err);
    return c.json({ error: "Webhook signature verification failed" }, 400);
  }

  // Find firm from event metadata or customer
  let firmId: string | null = null;
  if (event.data.object.customer) {
    const customer = (await db.query(
      `SELECT firm_id FROM stripe_customers WHERE stripe_customer_id = $1`,
      [event.data.object.customer],
    ))[0] as { firm_id: string } | undefined;
    if (customer) firmId = customer.firm_id;
  } else if (event.data.object.metadata?.firmId) {
    firmId = event.data.object.metadata.firmId;
  }

  if (!firmId) {
    // Try to find from invoice_id in metadata
    if (event.data.object.metadata?.invoiceId) {
      const inv = (await db.query(
        `SELECT firm_id FROM invoices WHERE id = $1`,
        [event.data.object.metadata.invoiceId],
      ))[0] as { firm_id: string } | undefined;
      if (inv) firmId = inv.firm_id;
    }
  }

  if (!firmId) {
    // Log but don't fail - some events don't have firm context
    console.warn('Stripe webhook: could not determine firm', { eventType: event.type, eventId: event.id });
    return c.json({ received: true });
  }

  const stripeService = new StripeService(db, {
    secretKey: stripeSecretKey,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY!,
    webhookSecret: c.env.STRIPE_WEBHOOK_SECRET!,
  });

  // Log event
  const webhookEvent = await stripeService.logWebhookEvent({
    firmId,
    stripeEventId: event.id,
    eventType: event.type,
    payload: event.data.object,
  });

  try {
    // Handle specific event types
    await handleStripeEvent(db, stripeService, event, firmId, stripeSecretKey);
    await stripeService.markWebhookProcessed(webhookEvent.id);
  } catch (err) {
    await stripeService.markWebhookProcessed(webhookEvent.id, err instanceof Error ? err.message : String(err));
    console.error('Stripe webhook processing failed:', err);
    // Don't throw - we want Stripe to retry
  }

  return c.json({ received: true });
});

async function handleStripeEvent(db: any, stripeService: any, event: any, firmId: string, stripeSecretKey: string) {
  const billingService = new (await import("../services/billing")).BillingService(db);

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      const invoiceId = pi.metadata?.invoiceId;
      if (invoiceId) {
        const amount = pi.amount / 100;
        await billingService.createPayment(firmId, {
          clientId: '', // Will be filled from invoice
          invoiceId: invoiceId,
          amount: pi.amount / 100,
          method: 'credit_card',
          reference: `pi_${pi.id}`,
          receivedDate: new Date().toISOString().split('T')[0],
        });
      }
      break;
    }

    case 'payment_intent.payment_failed': {
      // Could notify client or create agent task
      console.log('Payment failed:', event.data.object.id);
      break;
    }

    case 'invoice.paid': {
      // Stripe invoice paid (if using Stripe Invoicing)
      break;
    }

    case 'customer.payment_method.attached': {
      // Sync payment method
      const pm = event.data.object;
      const customerId = pm.customer;
      const localCustomer = (await db.query(
        `SELECT client_id, firm_id FROM stripe_customers WHERE stripe_customer_id = $1`,
        [customerId],
      ))[0] as { client_id: string; firm_id: string } | undefined;
      if (localCustomer) {
        const ss = new StripeService(db, {
          secretKey: stripeSecretKey,
          publishableKey: '',
          webhookSecret: '',
        });
        await ss.syncPaymentMethodsFromStripe(localCustomer.firm_id, localCustomer.client_id);
      }
      break;
    }

    case 'account.updated': {
      // Stripe Connect account updated
      const account = event.data.object;
      const connect = (await db.query(
        `SELECT firm_id FROM stripe_connect_accounts WHERE stripe_account_id = $1`,
        [account.id],
      ))[0] as { firm_id: string } | undefined;
      if (connect) {
        const ss = new StripeService(db, {
          secretKey: stripeSecretKey,
          publishableKey: '',
          webhookSecret: '',
        });
        await ss.syncConnectAccount(connect.firm_id);
      }
      break;
    }
  }
}

// ========== Invoice Schedules (Recurring) ==========

const scheduleSchema = z.object({
  clientId: z.string(),
  engagementId: z.string().optional(),
  name: z.string().min(1).max(200),
  frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
  intervalCount: z.number().int().positive().default(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  template: z.object({
    lines: z.array(z.object({
      description: z.string().min(1).max(500),
      quantity: z.number().positive().default(1),
      unitPrice: z.number().min(0),
      accountId: z.string().optional(),
    })).min(1),
    notes: z.string().max(2000).optional(),
    memo: z.string().max(500).optional(),
    dueDays: z.number().int().positive().default(30),
  }),
  autoSend: z.boolean().default(false),
});

stripeRoutes.post("/schedules", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  if (!clientId) return c.json({ error: "Client ID required" }, 400);
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = scheduleSchema.parse(await c.req.json());

  if (body.engagementId) {
    const engagement = await getEngagement(db, body.engagementId, firm.id);
    if (!engagement || engagement.client_id !== client.id) {
      return c.json({ error: "Engagement not found for this client" }, 404);
    }
  }

  const stripeService = new StripeService(db, {
    secretKey: c.env.STRIPE_SECRET_KEY!,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY!,
    webhookSecret: c.env.STRIPE_WEBHOOK_SECRET!,
  });

  const schedule = await stripeService.createInvoiceSchedule({
    firmId: firm.id,
    clientId: client.id,
    engagementId: body.engagementId ?? null,
    name: body.name,
    frequency: body.frequency,
    intervalCount: body.intervalCount,
    startDate: body.startDate,
    endDate: body.endDate ?? null,
    template: body.template,
    autoSend: body.autoSend,
  });

  return c.json({ schedule }, 201);
});

stripeRoutes.get("/schedules", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const stripeService = new StripeService(db, {
    secretKey: c.env.STRIPE_SECRET_KEY!,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY!,
    webhookSecret: c.env.STRIPE_WEBHOOK_SECRET!,
  });

  const status = c.req.query("status");
  const schedules = await stripeService.getInvoiceSchedulesByFirm(firm.id, status);
  return c.json({ schedules });
});

stripeRoutes.get("/schedules/:scheduleId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const stripeService = new StripeService(db, {
    secretKey: c.env.STRIPE_SECRET_KEY!,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY!,
    webhookSecret: c.env.STRIPE_WEBHOOK_SECRET!,
  });

  const schedule = await stripeService.getInvoiceSchedule(c.req.param("scheduleId"));
  if (!schedule || schedule.firmId !== firm.id) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json({ schedule });
});

stripeRoutes.patch("/schedules/:scheduleId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const body = z.object({
    name: z.string().min(1).max(200).optional(),
    frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).optional(),
    intervalCount: z.number().int().positive().optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    status: z.enum(['active', 'paused', 'cancelled']).optional(),
    template: z.object({
      lines: z.array(z.object({
        description: z.string().min(1).max(500),
        quantity: z.number().positive().default(1),
        unitPrice: z.number().min(0),
        accountId: z.string().optional(),
      })).min(1).optional(),
      notes: z.string().max(2000).optional(),
      memo: z.string().max(500).optional(),
      dueDays: z.number().int().positive().default(30).optional(),
    }).optional(),
    autoSend: z.boolean().optional(),
  }).parse(await c.req.json());

  const stripeService = new StripeService(db, {
    secretKey: c.env.STRIPE_SECRET_KEY!,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY!,
    webhookSecret: c.env.STRIPE_WEBHOOK_SECRET!,
  });

  const schedule = await stripeService.getInvoiceSchedule(c.req.param("scheduleId"));
  if (!schedule || schedule.firmId !== firm.id) {
    return c.json({ error: "Not found" }, 404);
  }

  // For simplicity, we'll just update allowed fields
  const sets: string[] = [];
  const params: any[] = [c.req.param("scheduleId")];
  let idx = 2;
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && key !== 'template') {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      sets.push(`${col} = $${idx++}`);
      params.push(value);
    }
  }
  if (body.template) {
    sets.push(`template = $${idx++}`);
    params.push(JSON.stringify(body.template));
  }
  if (sets.length > 0) {
    sets.push(`updated_at = NOW()`);
    await db.query(`UPDATE invoice_schedules SET ${sets.join(', ')} WHERE id = $1`, params);
  }

  const updated = await stripeService.getInvoiceSchedule(c.req.param("scheduleId"));
  return c.json({ schedule: updated });
});

stripeRoutes.post("/schedules/:scheduleId/pause", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const stripeService = new StripeService(db, {
    secretKey: c.env.STRIPE_SECRET_KEY!,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY!,
    webhookSecret: c.env.STRIPE_WEBHOOK_SECRET!,
  });

  const schedule = await stripeService.getInvoiceSchedule(c.req.param("scheduleId"));
  if (!schedule || schedule.firmId !== firm.id) {
    return c.json({ error: "Not found" }, 404);
  }

  await stripeService.pauseSchedule(schedule.id);
  const updated = await stripeService.getInvoiceSchedule(schedule.id);
  return c.json({ schedule: updated });
});

stripeRoutes.post("/schedules/:scheduleId/resume", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const stripeService = new StripeService(db, {
    secretKey: c.env.STRIPE_SECRET_KEY!,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY!,
    webhookSecret: c.env.STRIPE_WEBHOOK_SECRET!,
  });

  const schedule = await stripeService.getInvoiceSchedule(c.req.param("scheduleId"));
  if (!schedule || schedule.firmId !== firm.id) {
    return c.json({ error: "Not found" }, 404);
  }

  await stripeService.resumeSchedule(schedule.id);
  const updated = await stripeService.getInvoiceSchedule(schedule.id);
  return c.json({ schedule: updated });
});

stripeRoutes.post("/schedules/:scheduleId/cancel", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const stripeService = new StripeService(db, {
    secretKey: c.env.STRIPE_SECRET_KEY!,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY!,
    webhookSecret: c.env.STRIPE_WEBHOOK_SECRET!,
  });

  const schedule = await stripeService.getInvoiceSchedule(c.req.param("scheduleId"));
  if (!schedule || schedule.firmId !== firm.id) {
    return c.json({ error: "Not found" }, 404);
  }

  await stripeService.cancelSchedule(schedule.id);
  const updated = await stripeService.getInvoiceSchedule(schedule.id);
  return c.json({ schedule: updated });
});

// Manual trigger for schedule processing (for cron/testing)
stripeRoutes.post("/schedules/process-due", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const body = z.object({ scheduleIds: z.array(z.string()).optional() }).parse(await c.req.json().catch(() => ({})));

  const stripeService = new StripeService(db, {
    secretKey: c.env.STRIPE_SECRET_KEY!,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY!,
    webhookSecret: c.env.STRIPE_WEBHOOK_SECRET!,
  });

  const billingService = new BillingService(db);
  let schedules: any[];

  if (body.scheduleIds?.length) {
    schedules = await Promise.all(body.scheduleIds.map(id => stripeService.getInvoiceSchedule(id)));
  } else {
    schedules = await stripeService.getDueInvoiceSchedules(firm.id);
  }

  const results = [];
  for (const schedule of schedules) {
    if (!schedule || schedule.firmId !== firm.id) continue;
    const result = await stripeService.processInvoiceSchedule(schedule.id, billingService);
    if (result) results.push(result);
  }

  return c.json({ processed: results.length, results });
});

// ========== Payment Reminders ==========

stripeRoutes.post("/reminders/process", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const stripeService = new StripeService(db, {
    secretKey: c.env.STRIPE_SECRET_KEY!,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY!,
    webhookSecret: c.env.STRIPE_WEBHOOK_SECRET!,
  });

  const reminders = await stripeService.getPendingReminders(firm.id);
  let sent = 0;
  let failed = 0;

  // This would integrate with your email service
  // For now, just mark as sent
  for (const reminder of reminders) {
    try {
      await stripeService.sendReminder(reminder.id, {
        send: async ({ to, subject, html }: { to: string; subject: string; html: string }) => {
          console.log(`Email to ${to}: ${subject}`);
          // TODO: Integrate with actual email service
        },
      });
      sent++;
    } catch (err) {
      await stripeService.markReminderFailed(reminder.id, err instanceof Error ? err.message : String(err));
      failed++;
    }
  }

  return c.json({ processed: reminders.length, sent, failed });
});

// ========== Publishable Key ==========

stripeRoutes.get("/publishable-key", async (c) => {
  return c.json({ publishableKey: c.env.STRIPE_PUBLISHABLE_KEY! });
});