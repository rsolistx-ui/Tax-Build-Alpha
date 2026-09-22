import { describe, expect, it } from "vitest";
import type { Db } from "../db";
import { updateClientPipelineStatus, type ClientRow } from "./clients";

function fakeDb(existing: ClientRow) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.trim().startsWith("SELECT * FROM clients WHERE id = $1")) {
        return [existing] as T[];
      }
      return [] as T[];
    },
    async transaction<T>() { return [] as T[][]; },
  };
  return { db, calls };
}

describe("updateClientPipelineStatus", () => {
  it("writes the new stage scoped to firm and client, then returns the reloaded client", async () => {
    const existing: ClientRow = {
      id: "cli_1", firm_id: "firm_1", name: "Acme", legal_name: null, notes: null,
      email: null, phone: null, pipeline_status: "engaged", created_at: "now", updated_at: "now",
    };
    const { db, calls } = fakeDb(existing);

    const result = await updateClientPipelineStatus(db, "cli_1", "firm_1", "active");

    const updateCall = calls.find((c) => c.sql.includes("UPDATE clients SET pipeline_status"));
    expect(updateCall?.params).toEqual(["active", "cli_1", "firm_1"]);
    expect(result).toEqual(existing);
  });
});
