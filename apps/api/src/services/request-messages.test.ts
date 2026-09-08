import { describe, expect, it, vi } from "vitest";
import type { Db, DbStatement } from "../db";
import { addRequestMessage } from "./request-messages";

vi.mock("./client-requests", () => ({ respondToRequest: vi.fn() }));

function fakeDb(): { db: Db; inserts: { sql: string; params: unknown[] }[] } {
  const inserts: { sql: string; params: unknown[] }[] = [];
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      if (sql.startsWith("INSERT")) {
        inserts.push({ sql, params });
        return [] as T[];
      }
      if (sql.startsWith("SELECT")) {
        return [{ id: "rmsg_1", firm_id: params[1], request_id: params[2], client_id: params[3], author_type: "professional", author_user_id: null, body: "hi", created_at: "now" }] as T[];
      }
      return [] as T[];
    },
    async transaction<T>(_statements: DbStatement[]) {
      return [] as T[][];
    },
  };
  return { db, inserts };
}

describe("addRequestMessage tenant-column contract", () => {
  it("supplies every NOT NULL tenant column (firm_id, request_id, client_id) required by migration 0012's request_messages table", async () => {
    const { db, inserts } = fakeDb();

    await addRequestMessage(db, "creq_1", "firm_1", "cli_1", "professional", "user_1", "hello");

    expect(inserts).toHaveLength(1);
    const insert = inserts[0];
    expect(insert.sql).toContain("INSERT INTO request_messages");
    expect(insert.sql).toContain("firm_id");
    expect(insert.sql).toContain("client_id");
    // params order: id, firm_id, request_id, client_id, author_type, author_user_id, body
    expect(insert.params[1]).toBe("firm_1");
    expect(insert.params[2]).toBe("creq_1");
    expect(insert.params[3]).toBe("cli_1");
    for (const requiredValue of [insert.params[1], insert.params[2], insert.params[3]]) {
      expect(requiredValue).not.toBeNull();
      expect(requiredValue).not.toBeUndefined();
    }
  });

  it("triggers respondToRequest only for a client-authored message", async () => {
    const { respondToRequest } = await import("./client-requests");
    const { db } = fakeDb();

    await addRequestMessage(db, "creq_1", "firm_1", "cli_1", "client", null, "here it is");
    expect(respondToRequest).toHaveBeenCalledWith(db, "creq_1", "firm_1");

    vi.mocked(respondToRequest).mockClear();
    await addRequestMessage(db, "creq_1", "firm_1", "cli_1", "professional", "user_1", "noted");
    expect(respondToRequest).not.toHaveBeenCalled();
  });
});
