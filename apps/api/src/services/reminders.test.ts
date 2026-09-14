import { describe, expect, it } from "vitest";
import type { Db, DbStatement } from "../db";
import {
  nextReminderAfterSend,
  listRequestsDueForReminder,
  sendRemindersForFirm,
  handleReminderCron,
} from "./reminders";

function fakeDb(rows: Record<string, unknown[][]>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const consumed = new Set<string>();
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      calls.push({ sql, params });
      for (const [key, value] of Object.entries(rows)) {
        if (sql.includes(key) && !consumed.has(key)) {
          consumed.add(key);
          return [] as T[];
        }
      }
      return [] as T[];
    },
    async transaction<T>(statements: DbStatement[]): Promise<T[][]> {
      for (const s of statements) {
        calls.push({ sql: s.query, params: s.params ?? [] });
      }
      return [] as T[][];
    },
  };
  return { db, calls };
}

describe("reminders service", () => {
  it("nextReminderAfterSend adds 5 days by default", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const next = nextReminderAfterSend(from);
    expect(next.getTime()).toBe(new Date("2026-01-06T00:00:00Z").getTime());
  });

  it("listRequestsDueForReminder queries firm-scoped with correct asOf bound", async () => {
    const { db, calls } = fakeDb({ "FROM client_requests": [[{ id: "creq_1", reminder_count: 0, next_reminder_at: "2026-01-01T00:00:00Z" }]] });
    await listRequestsDueForReminder(db, "firm_1", new Date("2026-01-01T12:00:00Z"));
    expect(calls[0].sql).toContain("firm_id = $1");
    expect(calls[0].sql).toContain("status IN ('requested', 'viewed')");
    expect(calls[0].sql).toContain("next_reminder_at IS NOT NULL AND next_reminder_at <= $2");
    expect(calls[0].params).toEqual(["firm_1", new Date("2026-01-01T12:00:00Z").toISOString()]);
  });

  it("sendRemindersForFirm export exists", () => {
    expect(typeof sendRemindersForFirm).toBe("function");
  });

  it("listRequestsDueForReminder export exists", () => {
    expect(typeof listRequestsDueForReminder).toBe("function");
  });

  it("nextReminderAfterSend export exists", () => {
    expect(typeof nextReminderAfterSend).toBe("function");
  });

  it("handleReminderCron export exists", () => {
    expect(typeof handleReminderCron).toBe("function");
  });
});