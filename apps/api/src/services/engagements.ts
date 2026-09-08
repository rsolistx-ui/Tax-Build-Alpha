import type { Db } from "../db";
import { newId } from "../lib/id";
import { getServiceTemplateSteps } from "./service-templates";
import { workAuditEventStatement } from "./work-audit";

export type EngagementRow = {
  id: string;
  firm_id: string;
  client_id: string;
  service_type: string;
  title: string;
  status: string;
  start_date: string | null;
  due_date: string | null;
  recurrence: string | null;
  assigned_user_id: string | null;
  tax_year: number | null;
  created_at: string;
  updated_at: string;
};

const ENGAGEMENT_STATUSES = [
  "planned", "active", "waiting_on_client", "professional_review", "ready", "complete", "archived",
] as const;

export function isEngagementStatus(value: string): value is (typeof ENGAGEMENT_STATUSES)[number] {
  return (ENGAGEMENT_STATUSES as readonly string[]).includes(value);
}

export async function listEngagements(db: Db, firmId: string, clientId?: string): Promise<EngagementRow[]> {
  if (clientId) {
    return db.query<EngagementRow>(
      `SELECT * FROM engagements WHERE firm_id = $1 AND client_id = $2 ORDER BY due_date NULLS LAST, created_at DESC`,
      [firmId, clientId],
    );
  }
  return db.query<EngagementRow>(
    `SELECT * FROM engagements WHERE firm_id = $1 ORDER BY due_date NULLS LAST, created_at DESC`,
    [firmId],
  );
}

export async function getEngagement(db: Db, engagementId: string, firmId: string): Promise<EngagementRow | undefined> {
  const [row] = await db.query<EngagementRow>(
    `SELECT * FROM engagements WHERE id = $1 AND firm_id = $2`,
    [engagementId, firmId],
  );
  return row;
}

export async function createEngagement(
  db: Db,
  actorUserId: string,
  input: {
    firmId: string;
    clientId: string;
    serviceType: string;
    title: string;
    startDate?: string | null;
    dueDate?: string | null;
    recurrence?: string | null;
    assignedUserId?: string | null;
    taxYear?: number | null;
  },
): Promise<EngagementRow> {
  const id = newId("eng");
  const steps = getServiceTemplateSteps(input.serviceType);

  const statements = [
    {
      query: `INSERT INTO engagements
        (id, firm_id, client_id, service_type, title, status, start_date, due_date, recurrence, assigned_user_id, tax_year)
       VALUES ($1, $2, $3, $4, $5, 'planned', $6, $7, $8, $9, $10)`,
      params: [
        id, input.firmId, input.clientId, input.serviceType, input.title,
        input.startDate ?? null, input.dueDate ?? null, input.recurrence ?? null,
        input.assignedUserId ?? null, input.taxYear ?? null,
      ],
    },
    ...steps.map((step) => ({
      query: `INSERT INTO work_items
        (id, firm_id, client_id, engagement_id, title, work_type, status, source_type, source_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', 'service_template', $7)`,
      params: [newId("wi"), input.firmId, input.clientId, id, step.title, step.workType, input.serviceType],
    })),
    workAuditEventStatement({
      firmId: input.firmId,
      entityType: "engagement",
      entityId: id,
      action: "engagement_created",
      actorUserId,
      afterJson: { serviceType: input.serviceType, title: input.title, stepCount: steps.length },
    }),
  ];

  await db.transaction(statements);
  const engagement = await getEngagement(db, id, input.firmId);
  if (!engagement) throw new Error("Engagement was not created");
  return engagement;
}

export async function updateEngagementStatus(
  db: Db,
  engagementId: string,
  firmId: string,
  actorUserId: string,
  status: string,
): Promise<EngagementRow | undefined> {
  const current = await getEngagement(db, engagementId, firmId);
  if (!current) return undefined;

  await db.transaction([
    {
      query: `UPDATE engagements SET status = $1, updated_at = NOW() WHERE id = $2 AND firm_id = $3`,
      params: [status, engagementId, firmId],
    },
    workAuditEventStatement({
      firmId,
      entityType: "engagement",
      entityId: engagementId,
      action: "engagement_status_changed",
      actorUserId,
      beforeJson: { status: current.status },
      afterJson: { status },
    }),
  ]);

  return getEngagement(db, engagementId, firmId);
}
