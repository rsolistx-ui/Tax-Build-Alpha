import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";

const queryMock = vi.fn();
vi.mock("../db", () => ({ createDb: () => ({ query: queryMock, transaction: vi.fn(async () => []) }) }));

const engagementTask = {
  id: "task_1", source_type: "engagement_letter", source_id: "eng_1", action_type: "engagement_letter_draft",
  status: "awaiting_approval", recommendation_json: {},
};

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM firms f")) return [{ id: "firm_1", name: "Firm", owner_user_id: "user-owner" }];
    if (sql.includes("FROM clients")) return [{ id: "cli_1", firm_id: "firm_1", name: "Client" }];
    if (sql.includes("FROM agent_tasks") && sql.includes("awaiting_approval")) return [engagementTask];
    return [];
  });
});

// In production these routes sit behind the /api/clients/* gate in index.ts,
// which sets the session and the caller's firm role; this stands in for it.
async function call(role: string, path: string, init: RequestInit = {}) {
  const { agentSupervisorRoutes } = await import("./agent-supervisor");
  const app = new Hono<any>();
  app.use("*", async (c, next) => {
    c.set("userId", "user-1");
    c.set("userName", "User");
    c.set("userEmail", "u@example.com");
    c.set("firmRole", role);
    await next();
  });
  app.route("/", agentSupervisorRoutes);
  return app.request(path, { headers: { "content-type": "application/json" }, ...init }, {} as Env);
}

describe("engagement-letter agent tasks by role", () => {
  it("does not let a bookkeeper approve an engagement-letter draft, and writes nothing", async () => {
    const res = await call("bookkeeper", "/cli_1/agent-tasks/task_1", { method: "PATCH", body: JSON.stringify({ action: "approve" }) });
    expect(res.status).toBe(404);
    const writes = queryMock.mock.calls.filter(([sql]) => /^\s*(INSERT|UPDATE)/i.test(String(sql)));
    expect(writes).toEqual([]);
  });

  it("leaves engagement-letter drafts out of a bookkeeper's task list", async () => {
    await call("bookkeeper", "/cli_1/agent-tasks");
    const list = queryMock.mock.calls.find(([sql]) => String(sql).includes("FROM agent_tasks WHERE client_id"));
    expect(list?.[0]).toContain("engagement_letter_draft");
    expect(list?.[1]).toEqual(["cli_1", "firm_1", true]);
  });

  it("shows them to a preparer", async () => {
    await call("preparer", "/cli_1/agent-tasks");
    const list = queryMock.mock.calls.find(([sql]) => String(sql).includes("FROM agent_tasks WHERE client_id"));
    expect(list?.[1]).toEqual(["cli_1", "firm_1", false]);
  });
});
