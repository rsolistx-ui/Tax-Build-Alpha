import type { Db } from "../db";
import { newId } from "../lib/id";

export interface WorkflowStep {
  title: string;
  description?: string;
  daysOffset: number;
  workType?: string;
}

export interface ServiceTemplate {
  id: string;
  firmId: string | null;
  serviceType: string;
  name: string;
  steps: WorkflowStep[];
  createdAt: string;
}

export interface ClientServiceSubscription {
  id: string;
  firmId: string;
  clientId: string;
  templateId: string;
  recurrence: "once" | "monthly" | "quarterly" | "annually";
  nextRunDate: string;
  isActive: boolean;
  lastRunAt: string | null;
}

function mapTemplate(row: any): ServiceTemplate {
  return {
    id: row.id,
    firmId: row.firm_id,
    serviceType: row.service_type,
    name: row.name,
    steps: (typeof row.steps_json === "string" ? JSON.parse(row.steps_json) : row.steps_json) ?? [],
    createdAt: row.created_at,
  };
}

function mapSubscription(row: any): ClientServiceSubscription {
  return {
    id: row.id,
    firmId: row.firm_id,
    clientId: row.client_id,
    templateId: row.template_id,
    recurrence: row.recurrence,
    nextRunDate: row.next_run_date,
    isActive: row.is_active,
    lastRunAt: row.last_run_at,
  };
}

function addInterval(date: Date, recurrence: ClientServiceSubscription["recurrence"]): Date {
  const next = new Date(date);
  if (recurrence === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  else if (recurrence === "quarterly") next.setUTCMonth(next.getUTCMonth() + 3);
  else if (recurrence === "annually") next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}

export class WorkflowTemplateService {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async createTemplate(firmId: string, input: { serviceType: string; name: string; steps: WorkflowStep[] }): Promise<ServiceTemplate> {
    const id = newId("svt");
    await this.db.query(
      `INSERT INTO service_templates (id, firm_id, service_type, name, steps_json) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [id, firmId, input.serviceType, input.name, JSON.stringify(input.steps)],
    );
    const template = await this.getTemplate(id);
    if (!template) throw new Error("Template not found after creation");
    return template;
  }

  async getTemplate(id: string): Promise<ServiceTemplate | null> {
    const [row] = await this.db.query<any>(`SELECT * FROM service_templates WHERE id = $1`, [id]);
    return row ? mapTemplate(row) : null;
  }

  async listTemplates(firmId: string): Promise<ServiceTemplate[]> {
    const rows = await this.db.query<any>(
      `SELECT * FROM service_templates WHERE firm_id = $1 ORDER BY name`,
      [firmId],
    );
    return rows.map(mapTemplate);
  }

  async subscribeClient(
    firmId: string,
    clientId: string,
    templateId: string,
    recurrence: ClientServiceSubscription["recurrence"],
    firstRunDate: string,
  ): Promise<ClientServiceSubscription> {
    const id = newId("csub");
    await this.db.query(
      `INSERT INTO client_service_subscriptions (id, firm_id, client_id, template_id, recurrence, next_run_date)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, firmId, clientId, templateId, recurrence, firstRunDate],
    );
    const [row] = await this.db.query<any>(`SELECT * FROM client_service_subscriptions WHERE id = $1`, [id]);
    return mapSubscription(row);
  }

  async listSubscriptionsForClient(clientId: string): Promise<ClientServiceSubscription[]> {
    const rows = await this.db.query<any>(
      `SELECT * FROM client_service_subscriptions WHERE client_id = $1 ORDER BY next_run_date`,
      [clientId],
    );
    return rows.map(mapSubscription);
  }

  async deactivateSubscription(id: string): Promise<void> {
    await this.db.query(`UPDATE client_service_subscriptions SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, [id]);
  }

  /** Instantiates one work_item per template step, due at next_run_date + daysOffset. Returns the created work item ids. */
  async applyTemplateToClient(firmId: string, clientId: string, template: ServiceTemplate, anchorDate: string, sourceId: string): Promise<string[]> {
    const ids: string[] = [];
    for (const step of template.steps) {
      const dueAt = new Date(`${anchorDate}T00:00:00.000Z`);
      dueAt.setUTCDate(dueAt.getUTCDate() + step.daysOffset);
      const id = newId("wi");
      await this.db.query(
        `INSERT INTO work_items (id, firm_id, client_id, title, description, work_type, status, priority, due_at, source_type, source_id, client_visible)
         VALUES ($1,$2,$3,$4,$5,$6,'open','normal',$7,'workflow_template',$8,FALSE)`,
        [id, firmId, clientId, step.title, step.description ?? null, step.workType ?? "general", dueAt.toISOString(), sourceId],
      );
      ids.push(id);
    }
    return ids;
  }

  /**
   * Called by the scheduled cron. Instantiates work items for every
   * subscription due today or earlier, then advances (or deactivates, for
   * one-time subscriptions) its next_run_date. Returns a summary for the
   * ops health notification.
   */
  async runDueSubscriptions(): Promise<{ subscriptionsProcessed: number; workItemsCreated: number }> {
    const due = await this.db.query<any>(
      `SELECT * FROM client_service_subscriptions WHERE is_active = TRUE AND next_run_date <= CURRENT_DATE`,
    );

    let workItemsCreated = 0;
    for (const row of due) {
      const subscription = mapSubscription(row);
      const template = await this.getTemplate(subscription.templateId);
      if (!template) continue;

      const created = await this.applyTemplateToClient(
        subscription.firmId, subscription.clientId, template, subscription.nextRunDate, subscription.id,
      );
      workItemsCreated += created.length;

      if (subscription.recurrence === "once") {
        await this.db.query(
          `UPDATE client_service_subscriptions SET is_active = FALSE, last_run_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [subscription.id],
        );
      } else {
        const next = addInterval(new Date(`${subscription.nextRunDate}T00:00:00.000Z`), subscription.recurrence);
        await this.db.query(
          `UPDATE client_service_subscriptions SET next_run_date = $2, last_run_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [subscription.id, next.toISOString().slice(0, 10)],
        );
      }
    }

    return { subscriptionsProcessed: due.length, workItemsCreated };
  }
}
