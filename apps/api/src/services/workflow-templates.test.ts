import { describe, expect, it, beforeEach } from "vitest";
import type { Db } from "../db";
import { WorkflowTemplateService } from "./workflow-templates";

function fakeDb() {
  const templates = new Map<string, any>();
  const subscriptions = new Map<string, any>();
  const workItems: any[] = [];

  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const s = sql.trim();

      if (s.startsWith("INSERT INTO service_templates")) {
        const [id, firmId, serviceType, name, stepsJson] = params as any[];
        templates.set(id, { id, firm_id: firmId, service_type: serviceType, name, steps_json: stepsJson, created_at: "now" });
        return [] as T[];
      }
      if (s.startsWith("SELECT * FROM service_templates WHERE id = $1")) {
        const row = templates.get((params as any[])[0]);
        return (row ? [row] : []) as T[];
      }
      if (s.startsWith("SELECT * FROM service_templates WHERE firm_id = $1")) {
        const firmId = (params as any[])[0];
        return [...templates.values()].filter((t) => t.firm_id === firmId) as T[];
      }

      if (s.startsWith("INSERT INTO client_service_subscriptions")) {
        const [id, firmId, clientId, templateId, recurrence, nextRunDate] = params as any[];
        subscriptions.set(id, {
          id, firm_id: firmId, client_id: clientId, template_id: templateId, recurrence,
          next_run_date: nextRunDate, is_active: true, last_run_at: null,
        });
        return [] as T[];
      }
      if (s.startsWith("SELECT * FROM client_service_subscriptions WHERE id = $1")) {
        const row = subscriptions.get((params as any[])[0]);
        return (row ? [row] : []) as T[];
      }
      if (s.startsWith("SELECT * FROM client_service_subscriptions WHERE client_id = $1")) {
        const clientId = (params as any[])[0];
        return [...subscriptions.values()].filter((r) => r.client_id === clientId) as T[];
      }
      if (s.startsWith("SELECT * FROM client_service_subscriptions WHERE is_active = TRUE AND next_run_date <= CURRENT_DATE")) {
        const today = new Date().toISOString().slice(0, 10);
        return [...subscriptions.values()].filter((r) => r.is_active && r.next_run_date <= today) as T[];
      }
      if (s.startsWith("UPDATE client_service_subscriptions SET is_active = FALSE")) {
        const id = (params as any[])[0];
        const row = subscriptions.get(id);
        if (row) row.is_active = false;
        return [] as T[];
      }
      if (s.startsWith("UPDATE client_service_subscriptions SET next_run_date")) {
        const [id, nextRunDate] = params as any[];
        const row = subscriptions.get(id);
        if (row) row.next_run_date = nextRunDate;
        return [] as T[];
      }

      if (s.startsWith("INSERT INTO work_items")) {
        const [id, firmId, clientId, title, description, workType, dueAt, sourceId] = params as any[];
        workItems.push({ id, firm_id: firmId, client_id: clientId, title, description, work_type: workType, due_at: dueAt, source_id: sourceId });
        return [] as T[];
      }

      throw new Error(`fakeDb: unhandled query: ${s}`);
    },
    async transaction<T>(): Promise<T[][]> { return [] as T[][]; },
  };

  return { db, templates, subscriptions, workItems };
}

describe("WorkflowTemplateService", () => {
  let ctx: ReturnType<typeof fakeDb>;
  let service: WorkflowTemplateService;

  beforeEach(() => {
    ctx = fakeDb();
    service = new WorkflowTemplateService(ctx.db);
  });

  it("instantiates one work item per step, offset from the anchor date", async () => {
    const template = await service.createTemplate("firm_1", {
      serviceType: "1040_prep",
      name: "Annual 1040 Prep",
      steps: [
        { title: "Send organizer", daysOffset: 0 },
        { title: "Collect documents", daysOffset: 14 },
        { title: "Prepare return", daysOffset: 30 },
      ],
    });

    const workItemIds = await service.applyTemplateToClient("firm_1", "client_1", template, "2026-03-01", "manual_1");

    expect(workItemIds).toHaveLength(3);
    expect(ctx.workItems[0].due_at.startsWith("2026-03-01")).toBe(true);
    expect(ctx.workItems[1].due_at.startsWith("2026-03-15")).toBe(true);
    expect(ctx.workItems[2].due_at.startsWith("2026-03-31")).toBe(true);
  });

  it("processes a due annual subscription and advances next_run_date by one year", async () => {
    const template = await service.createTemplate("firm_1", {
      serviceType: "1040_prep", name: "Annual 1040 Prep",
      steps: [{ title: "Send organizer", daysOffset: 0 }],
    });
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    const subscription = await service.subscribeClient("firm_1", "client_1", template.id, "annually", pastDate.toISOString().slice(0, 10));

    const summary = await service.runDueSubscriptions();

    expect(summary.subscriptionsProcessed).toBe(1);
    expect(summary.workItemsCreated).toBe(1);
    const updated = ctx.subscriptions.get(subscription.id);
    expect(updated.is_active).toBe(true);
    expect(new Date(updated.next_run_date).getUTCFullYear()).toBe(new Date(subscription.nextRunDate).getUTCFullYear() + 1);
  });

  it("deactivates a one-time subscription after it runs once", async () => {
    const template = await service.createTemplate("firm_1", {
      serviceType: "onboarding", name: "New Client Onboarding",
      steps: [{ title: "Send engagement letter", daysOffset: 0 }],
    });
    const today = new Date().toISOString().slice(0, 10);
    const subscription = await service.subscribeClient("firm_1", "client_1", template.id, "once", today);

    await service.runDueSubscriptions();

    expect(ctx.subscriptions.get(subscription.id).is_active).toBe(false);
  });

  it("does not process a subscription whose next_run_date is in the future", async () => {
    const template = await service.createTemplate("firm_1", {
      serviceType: "1040_prep", name: "Annual 1040 Prep",
      steps: [{ title: "Send organizer", daysOffset: 0 }],
    });
    const future = new Date();
    future.setDate(future.getDate() + 30);
    await service.subscribeClient("firm_1", "client_1", template.id, "monthly", future.toISOString().slice(0, 10));

    const summary = await service.runDueSubscriptions();
    expect(summary.subscriptionsProcessed).toBe(0);
    expect(ctx.workItems).toHaveLength(0);
  });
});
