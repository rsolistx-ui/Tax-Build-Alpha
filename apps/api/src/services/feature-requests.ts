import type { Db } from "../db";
import { newId } from "../lib/id";
import { insertWorkAuditEvent } from "./work-audit";

export type FeatureRequestArea =
  | "receipt_scanning"
  | "categorization"
  | "tax_radar"
  | "reports"
  | "bank_feed"
  | "ui_ux"
  | "general";

export type FeatureRequestStatus =
  | "submitted"
  | "under_review"
  | "in_progress"
  | "completed"
  | "declined";

export interface FeatureRequest {
  id: string;
  firmId: string;
  clientId: string | null;
  submittedByUserId: string;
  title: string;
  description: string;
  area: FeatureRequestArea;
  status: FeatureRequestStatus;
  source: "text" | "voice";
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFeatureRequestInput {
  title: string;
  description: string;
  area?: FeatureRequestArea;
  clientId?: string | null;
  source?: "text" | "voice";
}

export interface UpdateFeatureRequestInput {
  status?: FeatureRequestStatus;
  adminNotes?: string | null;
}

export class FeatureRequestsService {
  constructor(private db: Db) {}

  async create(firmId: string, userId: string, input: CreateFeatureRequestInput): Promise<FeatureRequest> {
    const id = newId("freq");
    const [row] = await this.db.query<FeatureRequest>(
      `INSERT INTO feature_requests (
        id, firm_id, client_id, submitted_by_user_id, title, description, area, status, source, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'submitted', $8, NOW(), NOW())
      RETURNING id, firm_id as "firmId", client_id as "clientId", submitted_by_user_id as "submittedByUserId",
                title, description, area, status, source, admin_notes as "adminNotes",
                created_at as "createdAt", updated_at as "updatedAt"`,
      [
        id,
        firmId,
        input.clientId ?? null,
        userId,
        input.title.trim(),
        input.description.trim(),
        input.area ?? "general",
        input.source ?? "text",
      ]
    );

    await insertWorkAuditEvent(this.db, {
      firmId,
      entityType: "feature_request",
      entityId: id,
      action: "feature_request_created",
      actorUserId: userId,
      afterJson: { title: input.title, area: input.area, source: input.source },
    });

    return row;
  }

  async list(firmId: string, status?: FeatureRequestStatus): Promise<FeatureRequest[]> {
    let query = `
      SELECT id, firm_id as "firmId", client_id as "clientId", submitted_by_user_id as "submittedByUserId",
             title, description, area, status, source, admin_notes as "adminNotes",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM feature_requests
      WHERE firm_id = $1
    `;
    const params: unknown[] = [firmId];

    if (status) {
      query += ` AND status = $2`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC`;
    return this.db.query<FeatureRequest>(query, params);
  }

  async update(firmId: string, id: string, userId: string, input: UpdateFeatureRequestInput): Promise<FeatureRequest | null> {
    const updates: string[] = [];
    const params: unknown[] = [firmId, id];
    let pIdx = 3;

    if (input.status !== undefined) {
      updates.push(`status = $${pIdx++}`);
      params.push(input.status);
    }
    if (input.adminNotes !== undefined) {
      updates.push(`admin_notes = $${pIdx++}`);
      params.push(input.adminNotes);
    }

    if (updates.length === 0) return null;
    updates.push(`updated_at = NOW()`);

    const [updated] = await this.db.query<FeatureRequest>(
      `UPDATE feature_requests
       SET ${updates.join(", ")}
       WHERE firm_id = $1 AND id = $2
       RETURNING id, firm_id as "firmId", client_id as "clientId", submitted_by_user_id as "submittedByUserId",
                 title, description, area, status, source, admin_notes as "adminNotes",
                 created_at as "createdAt", updated_at as "updatedAt"`,
      params
    );

    if (updated) {
      await insertWorkAuditEvent(this.db, {
        firmId,
        entityType: "feature_request",
        entityId: id,
        action: "feature_request_status_updated",
        actorUserId: userId,
        afterJson: { status: input.status, adminNotes: input.adminNotes },
      });
    }

    return updated || null;
  }
}
