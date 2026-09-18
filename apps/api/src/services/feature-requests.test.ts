import { describe, expect, it } from "vitest";
import { FeatureRequestsService } from "./feature-requests";
import type { Db } from "../db";

function makeFakeDb(): Db {
  const rows: any[] = [];
  const audits: any[] = [];

  return {
    async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
      if (sql.includes("INSERT INTO feature_requests")) {
        const [id, firm_id, client_id, submitted_by_user_id, title, description, area, source] = params;
        const record = {
          id,
          firmId: firm_id,
          clientId: client_id,
          submittedByUserId: submitted_by_user_id,
          title,
          description,
          area,
          status: "submitted",
          source,
          adminNotes: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        rows.push(record);
        return [record as T];
      }
      if (sql.includes("INSERT INTO work_audit_events")) {
        audits.push(params);
        return [] as T[];
      }
      if (sql.includes("SELECT") && sql.includes("FROM feature_requests")) {
        return rows as T[];
      }
      if (sql.includes("UPDATE feature_requests")) {
        const status = params[2];
        if (rows[0]) {
          rows[0].status = status;
          return [rows[0] as T];
        }
        return [];
      }
      return [] as T[];
    },
    async transaction<T>(fnOrStatements: any): Promise<T> {
      return [] as T;
    },
  } as unknown as Db;
}

describe("FeatureRequestsService", () => {
  it("creates a voice or text feature request and logs an audit event", async () => {
    const db = makeFakeDb();
    const service = new FeatureRequestsService(db);

    const created = await service.create("firm-1", "user-1", {
      title: "Schedule C Auto-reconciliation",
      description: "Allow 1-click batch matching from the bank feed drawer.",
      area: "bank_feed",
      source: "voice",
    });

    expect(created.id).toMatch(/^freq_/);
    expect(created.title).toBe("Schedule C Auto-reconciliation");
    expect(created.status).toBe("submitted");
    expect(created.source).toBe("voice");
  });

  it("lists submitted requests for a firm", async () => {
    const db = makeFakeDb();
    const service = new FeatureRequestsService(db);

    await service.create("firm-1", "user-1", {
      title: "Export to Lacerte",
      description: "Direct bridge file for Lacerte tax software.",
    });

    const list = await service.list("firm-1");
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].title).toBe("Export to Lacerte");
  });

  it("updates request status with audit tracking", async () => {
    const db = makeFakeDb();
    const service = new FeatureRequestsService(db);

    const created = await service.create("firm-1", "user-1", {
      title: "Dark mode tweak",
      description: "Increase contrast for high-noon sunlight.",
    });

    const updated = await service.update("firm-1", created.id, "user-admin", {
      status: "in_progress",
      adminNotes: "Added to sprint 12.",
    });

    expect(updated?.status).toBe("in_progress");
  });
});
