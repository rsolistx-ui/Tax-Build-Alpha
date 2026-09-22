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
import { BillingService, buildInvoicePdf, buildStatementPdf, type CreateInvoiceInput, type CreatePaymentInput } from "../services/billing";
import { newId } from "../lib/id";
import { sha256Hex } from "../services/documents";
import { createVersion } from "../services/doc-versioning";

export const billingRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
billingRoutes.use("*", requireSession);
billingRoutes.use("*", requireActiveBeta);

const lineSchema = z.object({
  accountId: z.string().optional(),
  description: z.string().min(1).max(500),
  quantity: z.number().positive().default(1),
  unitPrice: z.number().min(0),
});

const createInvoiceSchema = z.object({
  engagementId: z.string().optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z.array(lineSchema).min(1),
  notes: z.string().max(2000).optional(),
  memo: z.string().max(500).optional(),
});

const updateInvoiceSchema = z.object({
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['draft', 'sent', 'void']).optional(),
  notes: z.string().max(2000).optional(),
  memo: z.string().max(500).optional(),
});

const createBillingRateSchema = z.object({
  clientId: z.string().optional(),
  serviceType: z.string().max(100).optional(),
  name: z.string().min(1).max(200),
  rateType: z.enum(['hourly', 'fixed', 'retainer']),
  rate: z.number().min(0),
  currency: z.string().length(3).optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const createPaymentSchema = z.object({
  invoiceId: z.string().optional(),
  amount: z.number().positive(),
  method: z.enum(['cash', 'check', 'ach', 'wire', 'credit_card', 'other']),
  reference: z.string().max(100).optional(),
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  depositedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(500).optional(),
});

// Create invoice
billingRoutes.post("/:clientId/invoices", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = createInvoiceSchema.parse(await c.req.json());

  if (body.engagementId) {
    const engagement = await getEngagement(db, body.engagementId, firm.id);
    if (!engagement || engagement.client_id !== client.id) {
      return c.json({ error: "Engagement not found for this client" }, 404);
    }
  }

  const service = new BillingService(db);
  const invoice = await service.createInvoice(firm.id, {
    clientId: client.id,
    engagementId: body.engagementId ?? null,
    issueDate: body.issueDate,
    dueDate: body.dueDate,
    lines: body.lines.map(l => ({ ...l, accountId: l.accountId ?? null })),
    notes: body.notes,
    memo: body.memo,
  });

  await db.query(
    `INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at)
     VALUES ($1,$2,$3,'invoice_created',$4,$5::jsonb,NOW())`,
    [newId("aud"), firm.id, client.id, c.get("userId"), JSON.stringify({ invoiceId: invoice.id, engagementId: body.engagementId ?? null })],
  );

  return c.json({ invoice }, 201);
});

// List invoices for a client
billingRoutes.get("/:clientId/invoices", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new BillingService(db);
  const invoices = await service.getInvoicesByClient(client.id);

  return c.json({ invoices });
});

// Get single invoice with lines
billingRoutes.get("/:clientId/invoices/:invoiceId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new BillingService(db);
  const invoice = await service.getInvoice(c.req.param("invoiceId"));
  if (!invoice || invoice.clientId !== client.id) {
    return c.json({ error: "Invoice not found" }, 404);
  }

  const lines = await db.query<any>(`SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY sort_order`, [invoice.id]);
  const payments = await service.getPaymentsByInvoice(invoice.id);

  return c.json({ invoice: { ...invoice, lines }, payments });
});

// Update invoice (draft only)
billingRoutes.patch("/:clientId/invoices/:invoiceId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = updateInvoiceSchema.parse(await c.req.json());

  const service = new BillingService(db);
  const invoice = await service.getInvoice(c.req.param("invoiceId"));
  if (!invoice || invoice.clientId !== client.id) {
    return c.json({ error: "Invoice not found" }, 404);
  }
  if (invoice.status !== 'draft') {
    return c.json({ error: "Only draft invoices can be updated" }, 409);
  }

  const updated = await service.updateInvoice(invoice.id, body);
  return c.json({ invoice: updated });
});

// Send invoice (draft -> sent)
billingRoutes.post("/:clientId/invoices/:invoiceId/send", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new BillingService(db);
  const invoice = await service.getInvoice(c.req.param("invoiceId"));
  if (!invoice || invoice.clientId !== client.id) {
    return c.json({ error: "Invoice not found" }, 404);
  }
  if (invoice.status !== 'draft') {
    return c.json({ error: "Only draft invoices can be sent" }, 409);
  }

  const sent = await service.sendInvoice(invoice.id);

  await db.query(
    `INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at)
     VALUES ($1,$2,$3,'invoice_sent',$4,$5::jsonb,NOW())`,
    [newId("aud"), firm.id, client.id, c.get("userId"), JSON.stringify({ invoiceId: invoice.id })],
  );

  return c.json({ invoice: sent });
});

// Void invoice
billingRoutes.post("/:clientId/invoices/:invoiceId/void", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new BillingService(db);
  const invoice = await service.getInvoice(c.req.param("invoiceId"));
  if (!invoice || invoice.clientId !== client.id) {
    return c.json({ error: "Invoice not found" }, 404);
  }
  if (invoice.status === 'paid') {
    return c.json({ error: "Paid invoices cannot be voided" }, 409);
  }

  const voided = await service.voidInvoice(invoice.id);

  await db.query(
    `INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at)
     VALUES ($1,$2,$3,'invoice_voided',$4,$5::jsonb,NOW())`,
    [newId("aud"), firm.id, client.id, c.get("userId"), JSON.stringify({ invoiceId: invoice.id })],
  );

  return c.json({ invoice: voided });
});

// Delete invoice (draft only)
billingRoutes.delete("/:clientId/invoices/:invoiceId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new BillingService(db);
  const invoice = await service.getInvoice(c.req.param("invoiceId"));
  if (!invoice || invoice.clientId !== client.id) {
    return c.json({ error: "Invoice not found" }, 404);
  }
  if (invoice.status !== 'draft') {
    return c.json({ error: "Only draft invoices can be deleted" }, 409);
  }

  await service.deleteInvoice(invoice.id);

  await db.query(
    `INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at)
     VALUES ($1,$2,$3,'invoice_deleted',$4,$5::jsonb,NOW())`,
    [newId("aud"), firm.id, client.id, c.get("userId"), JSON.stringify({ invoiceId: invoice.id })],
  );

  return c.json({ ok: true });
});

// Generate invoice PDF
billingRoutes.get("/:clientId/invoices/:invoiceId/pdf", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new BillingService(db);
  const invoice = await service.getInvoice(c.req.param("invoiceId"));
  if (!invoice || invoice.clientId !== client.id) {
    return c.json({ error: "Invoice not found" }, 404);
  }

  const lines = await db.query<any>(`SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY sort_order`, [invoice.id]);
  const payments = await service.getPaymentsByInvoice(invoice.id);

  const pdfBytes = await buildInvoicePdf({
    firmName: firm.name,
    clientName: client.name,
    clientEmail: client.email ?? "",
    invoice: { ...invoice, lines: lines.map(l => ({ ...l, lineTotal: Number(l.line_total) })) },
    payments,
  });

  return c.body(new Uint8Array(pdfBytes), 200, { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="invoice-${invoice.number}.pdf"` });
});

// Create payment
billingRoutes.post("/:clientId/payments", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = createPaymentSchema.parse(await c.req.json());

  if (body.invoiceId) {
    const service = new BillingService(db);
    const invoice = await service.getInvoice(body.invoiceId);
    if (!invoice || invoice.clientId !== client.id) {
      return c.json({ error: "Invoice not found for this client" }, 404);
    }
    if (invoice.status === 'void') {
      return c.json({ error: "Cannot apply payment to voided invoice" }, 409);
    }
  }

  const service = new BillingService(db);
  const payment = await service.createPayment(firm.id, {
    clientId: client.id,
    invoiceId: body.invoiceId ?? null,
    amount: body.amount,
    method: body.method,
    reference: body.reference,
    receivedDate: body.receivedDate,
    depositedDate: body.depositedDate,
    notes: body.notes,
  });

  await db.query(
    `INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at)
     VALUES ($1,$2,$3,'payment_recorded',$4,$5::jsonb,NOW())`,
    [newId("aud"), firm.id, client.id, c.get("userId"), JSON.stringify({ paymentId: payment.id, invoiceId: body.invoiceId ?? null })],
  );

  return c.json({ payment }, 201);
});

// List payments for a client
billingRoutes.get("/:clientId/payments", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new BillingService(db);
  const payments = await service.getPaymentsByClient(client.id);

  return c.json({ payments });
});

// Client balance summary
billingRoutes.get("/:clientId/balance", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new BillingService(db);
  const balance = await service.getClientBalance(client.id);

  return c.json({ balance });
});

// Aging report (firm-wide)
billingRoutes.get("/aging", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const service = new BillingService(db);
  const aging = await service.getAgingReport(firm.id);

  return c.json({ aging });
});

// Create a billing rate (firm-wide when clientId is omitted, client-specific otherwise)
billingRoutes.post("/billing-rates", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const body = createBillingRateSchema.parse(await c.req.json());
  if (body.clientId) {
    const client = await getClient(db, body.clientId, firm.id);
    if (!client) return c.json({ error: "Client not found" }, 404);
  }

  const service = new BillingService(db);
  const rate = await service.createBillingRate(firm.id, body);
  return c.json({ rate }, 201);
});

// List active billing rates (firm-wide plus any rates for ?clientId=)
billingRoutes.get("/billing-rates", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const service = new BillingService(db);
  const rates = await service.listBillingRates(firm.id, c.req.query("clientId"));
  return c.json({ rates });
});

// Deactivate a billing rate
billingRoutes.delete("/billing-rates/:rateId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const service = new BillingService(db);
  const rate = await service.getBillingRate(c.req.param("rateId"));
  if (!rate || rate.firmId !== firm.id) return c.json({ error: "Billing rate not found" }, 404);

  await service.deactivateBillingRate(rate.id);
  return c.json({ ok: true });
});

// Client statement PDF
billingRoutes.get("/:clientId/statement/pdf", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new BillingService(db);
  const invoices = await service.getInvoicesByClient(client.id);
  const payments = await service.getPaymentsByClient(client.id);
  const balance = await service.getClientBalance(client.id);

  // Fetch lines for each invoice
  const invoicesWithLines = await Promise.all(invoices.map(async (inv) => {
    const lines = await db.query<any>(`SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY sort_order`, [inv.id]);
    return { ...inv, lines: lines.map(l => ({ ...l, lineTotal: Number(l.line_total) })) };
  }));

  const pdfBytes = await buildStatementPdf({
    firmName: firm.name,
    clientName: client.name,
    clientEmail: client.email ?? "",
    invoices: invoicesWithLines,
    payments,
    balanceDue: balance.balanceDue,
    asOfDate: new Date().toISOString().split('T')[0],
  });

  return c.body(new Uint8Array(pdfBytes), 200, { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="statement-${client.name.replace(/\s+/g, '-')}.pdf"` });
});