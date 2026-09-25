import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { clientIdsInRequest, scopedFirmWideAllowed, visibleClientSql } from "./client-assignment";

const queryMock = vi.fn();
const accessMock = vi.fn();

vi.mock("../db", () => ({ createDb: () => ({ query: queryMock, transaction: vi.fn() }) }));
vi.mock("./firm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./firm")>()),
  loadAccessEntitlement: (...args: unknown[]) => accessMock(...args),
}));

describe("clientIdsInRequest", () => {
  it("finds client ids in the path, including percent-encoded ones, and in the query", () => {
    expect(clientIdsInRequest("/api/clients/cli_a/receipts", {})).toEqual({ pathIds: ["cli_a"], queryIds: [] });
    expect(clientIdsInRequest("/api/clients/%63li_b/overview", {}).pathIds).toEqual(["cli_b"]);
    expect(clientIdsInRequest("/api/work-queue", { clientId: ["cli_c"], view: ["overdue"] }).queryIds).toEqual(["cli_c"]);
  });
});

describe("scopedFirmWideAllowed", () => {
  it("allows only the firm-wide routes whose handlers filter by assignment", () => {
    expect(scopedFirmWideAllowed("GET", "/api/clients", false)).toBe(true);
    expect(scopedFirmWideAllowed("POST", "/api/clients", false)).toBe(true);
    expect(scopedFirmWideAllowed("GET", "/api/dashboard", false)).toBe(true);
    expect(scopedFirmWideAllowed("GET", "/api/workbench/2026", false)).toBe(true);
    expect(scopedFirmWideAllowed("PATCH", "/api/work-queue/wi_1/status", false)).toBe(true);
  });

  it("refuses firm-wide routes that are not assignment-aware", () => {
    for (const [method, path] of [
      ["GET", "/api/time-savings"],
      ["GET", "/api/push/sync/poll"],
      ["GET", "/api/accounting/journals"],
      ["GET", "/api/projects/projects"],
      ["POST", "/api/gmail/triage"],
      ["GET", "/api/calendar/range"],
      ["DELETE", "/api/clients"],
    ]) {
      expect(scopedFirmWideAllowed(method, path, false), `${method} ${path}`).toBe(false);
    }
  });

  it("allows upcoming deadlines only for a named client", () => {
    expect(scopedFirmWideAllowed("GET", "/api/calendar/upcoming", false)).toBe(false);
    expect(scopedFirmWideAllowed("GET", "/api/calendar/upcoming", true)).toBe(true);
  });
});

describe("visibleClientSql", () => {
  it("filters nothing when the parameter is NULL and to the user's assignments otherwise", () => {
    const sql = visibleClientSql("c.id", "$2");
    expect(sql).toContain("$2::text IS NULL");
    expect(sql).toContain("c.id IN (SELECT ca.client_id FROM client_assignments ca WHERE ca.user_id = $2::text)");
  });
});

describe("requireActiveBeta with client assignment", () => {
  const active = { status: "active", starts_at: "2026-01-01", expires_at: "2099-01-01", source: "firm" };

  async function call(path: string, method = "GET") {
    const { requireActiveBeta } = await import("../middleware/beta");
    const app = new Hono<any>();
    app.use("*", async (c, next) => {
      c.set("userId", "user_staff");
      c.set("userEmail", "staff@example.com");
      c.set("userName", "Staff");
      await next();
    });
    app.all("*", requireActiveBeta, (c) => c.json({ scope: c.get("clientScopeUserId") }));
    return app.request(path, { method }, { OWNER_EMAIL: "owner@example.com" } as Env);
  }

  beforeEach(() => {
    queryMock.mockReset();
    accessMock.mockReset();
  });

  it("refuses a scoped staff member a client that is not assigned to them", async () => {
    accessMock.mockResolvedValue({ entitlement: active, role: "preparer", seesAllClients: false });
    queryMock.mockResolvedValue([]);
    const res = await call("/api/clients/cli_other/overview");
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "CLIENT_NOT_ASSIGNED" });
  });

  it("lets a scoped staff member reach an assigned client and marks the request scoped", async () => {
    accessMock.mockResolvedValue({ entitlement: active, role: "bookkeeper", seesAllClients: false });
    queryMock.mockResolvedValue([{ client_id: "cli_mine" }]);
    const res = await call("/api/clients/cli_mine/receipts");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ scope: "user_staff" });
  });

  it("refuses a scoped staff member a firm-wide route that is not assignment-aware", async () => {
    accessMock.mockResolvedValue({ entitlement: active, role: "preparer", seesAllClients: false });
    const res = await call("/api/time-savings");
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "CLIENT_SCOPE_FORBIDDEN" });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("checks client ids in the query string of an allowed firm-wide route", async () => {
    accessMock.mockResolvedValue({ entitlement: active, role: "preparer", seesAllClients: false });
    queryMock.mockResolvedValue([]);
    const res = await call("/api/work-queue?clientId=cli_other");
    expect(res.status).toBe(403);
  });

  it("does not scope staff with the sees-all switch", async () => {
    accessMock.mockResolvedValue({ entitlement: active, role: "preparer", seesAllClients: true });
    const res = await call("/api/time-savings");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ scope: null });
    expect(queryMock).not.toHaveBeenCalled();
  });
});
