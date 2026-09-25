import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";

const queryMock = vi.fn();
vi.mock("../db", () => ({ createDb: () => ({ query: queryMock, transaction: vi.fn() }) }));
vi.mock("../middleware/session", () => ({
  requireSession: async (c: any, next: any) => {
    c.set("userId", "user-me");
    c.set("userName", "Me");
    await next();
  },
}));
vi.mock("../middleware/beta", () => ({ requireActiveBeta: async (_c: any, next: any) => next() }));

const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  queryMock.mockReset();
  fetchMock.mockClear();
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM firms f")) return [{ id: "firm_1", name: "Firm", owner_user_id: "user-me" }];
    if (sql.includes("FROM push_subscriptions")) return [{ endpoint: "https://push.example/1", p256dh: "k", auth: "a" }];
    return [];
  });
});

async function notify(body: unknown) {
  const { pushRoutes } = await import("./push");
  return pushRoutes.request("/notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, {} as Env);
}

describe("POST /api/push/notify", () => {
  it("sends only to devices in the caller's own firm", async () => {
    const res = await notify({ message: "hello" });
    expect(res.status).toBe(200);
    const [sql, params] = queryMock.mock.calls.find(([s]) => String(s).includes("FROM push_subscriptions"))!;
    expect(sql).toContain("WHERE firm_id = $1");
    expect(params).toEqual(["firm_1", null]);
  });

  it("refuses a client that is not in the caller's firm and sends nothing", async () => {
    const res = await notify({ message: "hello", clientId: "cli_elsewhere" });
    expect(res.status).toBe(404);
    expect(queryMock.mock.calls.some(([s]) => String(s).includes("FROM push_subscriptions"))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
