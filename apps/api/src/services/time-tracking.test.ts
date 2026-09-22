import { describe, expect, it, beforeEach } from "vitest";
import type { Db } from "../db";
import {
  TimeTrackingService,
  TimeEntryConflictError,
  TimeEntryInvoicedError,
  TimeEntryMissingRateError,
} from "./time-tracking";
import { BillingService } from "./billing";

/**
 * A minimal in-memory Postgres stand-in scoped to exactly the statements
 * TimeTrackingService and BillingService issue. It exists so the real
 * conversion math (duration -> hours -> invoice line) is exercised end to
 * end, not just asserted against recorded SQL strings.
 */
function fakeDb() {
  const timeEntries = new Map<string, any>();
  const billingRates = new Map<string, any>();
  const invoices = new Map<string, any>();
  const invoiceLines: any[] = [];
  let now = 0;
  const nowIso = () => new Date(now++).toISOString();

  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const s = sql.trim();

      if (s.startsWith("INSERT INTO time_entries (id, firm_id, client_id, engagement_id, billing_rate_id, description, started_at, is_billable, created_by_user_id)")) {
        const [id, firmId, clientId, engagementId, billingRateId, description, isBillable, createdBy] = params as any[];
        timeEntries.set(id, {
          id, firm_id: firmId, client_id: clientId, engagement_id: engagementId, billing_rate_id: billingRateId,
          description, started_at: nowIso(), ended_at: null, duration_minutes: null, is_billable: isBillable,
          invoice_id: null, created_by_user_id: createdBy, created_at: nowIso(), updated_at: nowIso(),
        });
        return [] as T[];
      }

      if (s.startsWith("INSERT INTO time_entries (id, firm_id, client_id, engagement_id, billing_rate_id, description, started_at, ended_at, duration_minutes, is_billable, created_by_user_id)")) {
        const [id, firmId, clientId, engagementId, billingRateId, description, startedAt, endedAt, duration, isBillable, createdBy] = params as any[];
        timeEntries.set(id, {
          id, firm_id: firmId, client_id: clientId, engagement_id: engagementId, billing_rate_id: billingRateId,
          description, started_at: startedAt, ended_at: endedAt, duration_minutes: duration, is_billable: isBillable,
          invoice_id: null, created_by_user_id: createdBy, created_at: nowIso(), updated_at: nowIso(),
        });
        return [] as T[];
      }

      if (s.startsWith("UPDATE time_entries SET ended_at")) {
        const [id, endedAt, duration] = params as any[];
        const row = timeEntries.get(id as string);
        if (row) { row.ended_at = endedAt; row.duration_minutes = duration; row.updated_at = nowIso(); }
        return [] as T[];
      }

      if (s.startsWith("UPDATE time_entries SET invoice_id")) {
        const [invoiceId, entryIds] = params as any[];
        for (const id of entryIds as string[]) {
          const row = timeEntries.get(id);
          if (row) { row.invoice_id = invoiceId; row.updated_at = nowIso(); }
        }
        return [] as T[];
      }

      if (s.startsWith("UPDATE time_entries SET")) {
        const id = (params as any[])[0];
        const row = timeEntries.get(id);
        if (row) {
          const setClause = s.slice("UPDATE time_entries SET ".length, s.indexOf(" WHERE"));
          const cols = setClause.split(",").map((c) => c.trim()).filter((c) => !c.startsWith("updated_at"));
          cols.forEach((col, i) => {
            const [name] = col.split("=").map((p) => p.trim());
            row[name] = (params as any[])[i + 1];
          });
          row.updated_at = nowIso();
        }
        return [] as T[];
      }

      if (s.startsWith("SELECT * FROM time_entries WHERE id = $1")) {
        const row = timeEntries.get((params as any[])[0]);
        return (row ? [row] : []) as T[];
      }

      if (s.startsWith("SELECT * FROM time_entries WHERE client_id = $1 AND ended_at IS NULL")) {
        const clientId = (params as any[])[0];
        const row = [...timeEntries.values()].find((r) => r.client_id === clientId && r.ended_at === null);
        return (row ? [row] : []) as T[];
      }

      if (s.startsWith("SELECT * FROM time_entries WHERE client_id = $1")) {
        const clientId = (params as any[])[0];
        let rows = [...timeEntries.values()].filter((r) => r.client_id === clientId);
        if (s.includes("invoice_id IS NULL")) rows = rows.filter((r) => r.invoice_id === null);
        if (s.includes("ended_at IS NOT NULL")) rows = rows.filter((r) => r.ended_at !== null);
        if (s.includes("is_billable = TRUE")) rows = rows.filter((r) => r.is_billable);
        rows.sort((a, b) => b.started_at.localeCompare(a.started_at));
        return rows as T[];
      }

      if (s.startsWith("DELETE FROM time_entries WHERE id = $1")) {
        timeEntries.delete((params as any[])[0] as string);
        return [] as T[];
      }

      if (s.startsWith("INSERT INTO billing_rates")) {
        const [id, firmId, clientId, serviceType, name, rateType, rate, currency, effectiveFrom, effectiveTo] = params as any[];
        billingRates.set(id, {
          id, firm_id: firmId, client_id: clientId, service_type: serviceType, name, rate_type: rateType,
          rate, currency, is_active: true, effective_from: effectiveFrom, effective_to: effectiveTo,
        });
        return [] as T[];
      }

      if (s.startsWith("SELECT * FROM billing_rates WHERE id = $1")) {
        const row = billingRates.get((params as any[])[0]);
        return (row ? [row] : []) as T[];
      }

      if (s.startsWith("SELECT MAX(number)")) {
        return [{ max_num: null }] as T[];
      }

      if (s.startsWith("INSERT INTO invoices")) {
        const [id, firmId, clientId, engagementId, number, issueDate, dueDate, subtotal, total, notes, memo] = params as any[];
        invoices.set(id, {
          id, firm_id: firmId, client_id: clientId, engagement_id: engagementId, number, status: "draft",
          issue_date: issueDate, due_date: dueDate, subtotal, tax_amount: 0, total, amount_paid: 0,
          balance_due: total, notes, memo, created_at: nowIso(), updated_at: nowIso(), sent_at: null, paid_at: null,
        });
        return [] as T[];
      }

      if (s.startsWith("INSERT INTO invoice_lines")) {
        const [id, invoiceId, accountId, description, quantity, unitPrice, sortOrder] = params as any[];
        invoiceLines.push({ id, invoice_id: invoiceId, account_id: accountId, description, quantity, unit_price: unitPrice, line_total: quantity * unitPrice, sort_order: sortOrder });
        return [] as T[];
      }

      if (s.startsWith("SELECT * FROM invoices WHERE id = $1")) {
        const row = invoices.get((params as any[])[0]);
        return (row ? [row] : []) as T[];
      }

      if (s.startsWith("SELECT * FROM invoice_lines WHERE invoice_id = $1")) {
        const invoiceId = (params as any[])[0];
        return invoiceLines.filter((l) => l.invoice_id === invoiceId).sort((a, b) => a.sort_order - b.sort_order) as T[];
      }

      throw new Error(`fakeDb: unhandled query: ${s}`);
    },
    async transaction<T>(): Promise<T[][]> { return [] as T[][]; },
  };

  return { db, timeEntries, billingRates, invoices, invoiceLines };
}

describe("TimeTrackingService", () => {
  let ctx: ReturnType<typeof fakeDb>;
  let service: TimeTrackingService;
  let billing: BillingService;

  beforeEach(() => {
    ctx = fakeDb();
    service = new TimeTrackingService(ctx.db);
    billing = new BillingService(ctx.db);
  });

  it("refuses to start a second timer for the same client while one is running", async () => {
    await service.startTimer("firm_1", "client_1", { description: "Reviewing receipts" }, "user_1");
    await expect(
      service.startTimer("firm_1", "client_1", { description: "Bank recon" }, "user_1"),
    ).rejects.toThrow(TimeEntryConflictError);
  });

  it("allows a second running timer for a different client", async () => {
    await service.startTimer("firm_1", "client_1", { description: "A" }, "user_1");
    await expect(
      service.startTimer("firm_1", "client_2", { description: "B" }, "user_1"),
    ).resolves.toBeTruthy();
  });

  it("stopping a timer records a nonnegative duration and clears the running-timer slot", async () => {
    const started = await service.startTimer("firm_1", "client_1", { description: "Reviewing receipts" }, "user_1");
    const stopped = await service.stopTimer(started.id);
    expect(stopped?.endedAt).toBeInstanceOf(Date);
    expect(stopped?.durationMinutes).toBeGreaterThanOrEqual(0);
    expect(await service.getRunningTimer("client_1")).toBeNull();
  });

  it("refuses to convert entries that have no billing rate assigned", async () => {
    const entry = await service.logManualEntry("firm_1", "client_1", {
      description: "Bank recon", startedAt: "2026-01-01T09:00:00.000Z", endedAt: "2026-01-01T10:30:00.000Z",
    }, "user_1");

    await expect(
      service.convertToInvoice("firm_1", "client_1", [entry.id], { issueDate: "2026-01-31", dueDate: "2026-02-14" }),
    ).rejects.toThrow(TimeEntryMissingRateError);
  });

  it("converts an hourly entry into an invoice line billing duration at the rate", async () => {
    const rate = await billing.createBillingRate("firm_1", {
      name: "Standard hourly", rateType: "hourly", rate: 150, effectiveFrom: "2026-01-01",
    });
    const entry = await service.logManualEntry("firm_1", "client_1", {
      description: "Bookkeeping cleanup", billingRateId: rate.id,
      startedAt: "2026-01-01T09:00:00.000Z", endedAt: "2026-01-01T10:30:00.000Z", // 90 minutes
    }, "user_1");

    const invoice = await service.convertToInvoice("firm_1", "client_1", [entry.id], {
      issueDate: "2026-01-31", dueDate: "2026-02-14",
    });

    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines![0].quantity).toBeCloseTo(1.5); // 90 minutes = 1.5 hours
    expect(invoice.lines![0].unitPrice).toBe(150);
    expect(invoice.total).toBeCloseTo(225);

    const reloaded = await service.getEntry(entry.id);
    expect(reloaded?.invoiceId).toBe(invoice.id);
  });

  it("bills a fixed-rate entry once regardless of duration", async () => {
    const rate = await billing.createBillingRate("firm_1", {
      name: "Flat engagement letter review", rateType: "fixed", rate: 75, effectiveFrom: "2026-01-01",
    });
    const entry = await service.logManualEntry("firm_1", "client_1", {
      description: "Engagement letter review", billingRateId: rate.id,
      startedAt: "2026-01-01T09:00:00.000Z", endedAt: "2026-01-01T09:05:00.000Z",
    }, "user_1");

    const invoice = await service.convertToInvoice("firm_1", "client_1", [entry.id], {
      issueDate: "2026-01-31", dueDate: "2026-02-14",
    });

    expect(invoice.lines![0].quantity).toBe(1);
    expect(invoice.total).toBe(75);
  });

  it("refuses to edit or delete a time entry already applied to an invoice", async () => {
    const rate = await billing.createBillingRate("firm_1", {
      name: "Standard hourly", rateType: "hourly", rate: 100, effectiveFrom: "2026-01-01",
    });
    const entry = await service.logManualEntry("firm_1", "client_1", {
      description: "Work", billingRateId: rate.id,
      startedAt: "2026-01-01T09:00:00.000Z", endedAt: "2026-01-01T10:00:00.000Z",
    }, "user_1");
    await service.convertToInvoice("firm_1", "client_1", [entry.id], { issueDate: "2026-01-31", dueDate: "2026-02-14" });

    await expect(service.updateEntry(entry.id, { description: "Changed" })).rejects.toThrow(TimeEntryInvoicedError);
    await expect(service.deleteEntry(entry.id)).rejects.toThrow(TimeEntryInvoicedError);
  });

  it("excludes non-billable and already-invoiced entries from the unbilled list", async () => {
    const rate = await billing.createBillingRate("firm_1", {
      name: "Standard hourly", rateType: "hourly", rate: 100, effectiveFrom: "2026-01-01",
    });
    const billable = await service.logManualEntry("firm_1", "client_1", {
      description: "Billable", billingRateId: rate.id,
      startedAt: "2026-01-01T09:00:00.000Z", endedAt: "2026-01-01T10:00:00.000Z",
    }, "user_1");
    await service.logManualEntry("firm_1", "client_1", {
      description: "Non-billable", isBillable: false,
      startedAt: "2026-01-01T09:00:00.000Z", endedAt: "2026-01-01T10:00:00.000Z",
    }, "user_1");
    await service.convertToInvoice("firm_1", "client_1", [billable.id], { issueDate: "2026-01-31", dueDate: "2026-02-14" });

    const unbilled = await service.listByClient("client_1", { unbilledOnly: true });
    expect(unbilled).toHaveLength(0);
  });
});
