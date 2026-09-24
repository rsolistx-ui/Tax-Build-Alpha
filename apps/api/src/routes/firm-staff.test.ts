import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";

const queryMock = vi.fn();
vi.mock("../db", () => ({ createDb: () => ({ query: queryMock, transaction: vi.fn() }) }));
vi.mock("../middleware/session", () => ({
  requireSession: async (c: any, next: any) => {
    c.set("userId", "user-me");
    c.set("userName", "Me");
    c.set("userEmail", "me@example.com");
    await next();
  },
}));
vi.mock("../middleware/beta", () => ({ requireActiveBeta: async (_c: any, next: any) => next() }));

let myRole = "owner";
let existingAccount: { id: string } | null = null;
const authDbSql: string[] = [];

function env(): Env {
  return {
    AUTH_DB: {
      prepare(sql: string) {
        authDbSql.push(sql);
        const bound = {
          first: async () => existingAccount,
          all: async () => ({ results: [] }),
          run: async () => ({}),
        };
        return { bind: () => bound, ...bound };
      },
    },
  } as unknown as Env;
}

beforeEach(() => {
  queryMock.mockReset();
  authDbSql.length = 0;
  existingAccount = null;
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM firms f")) return [{ id: "firm_1", name: "Firm", owner_user_id: "user-owner" }];
    if (sql.includes("SELECT firm_id, role FROM firm_members")) return [{ firm_id: "firm_1", role: myRole }];
    if (sql.includes("DELETE FROM firm_members")) return [{ id: "fm_1" }];
    return [];
  });
});

async function call(path: string, init: RequestInit) {
  const { firmStaffRoutes } = await import("./firm-staff");
  return firmStaffRoutes.request(path, { headers: { "content-type": "application/json" }, ...init }, env());
}

describe("firm staff seats", () => {
  it("lets only the firm owner invite staff", async () => {
    myRole = "staff";
    const res = await call("/staff/invitations", { method: "POST", body: JSON.stringify({ email: "new@example.com" }) });
    expect(res.status).toBe(403);
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO beta_invitations"))).toBe(false);
  });

  it("creates a staff invitation tied to the owner's firm", async () => {
    myRole = "owner";
    const res = await call("/staff/invitations", { method: "POST", body: JSON.stringify({ email: "New@Example.com", role: "bookkeeper" }) });
    expect(res.status).toBe(201);
    const insert = queryMock.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO beta_invitations"));
    expect(insert?.[1]).toEqual(expect.arrayContaining(["new@example.com", "firm_1", "bookkeeper"]));
    const body = (await res.json()) as { invitation: { token: string } };
    expect(body.invitation.token).toBeTruthy();
  });

  it("never lets an invitation or a role change create another owner", async () => {
    myRole = "owner";
    const invite = await call("/staff/invitations", { method: "POST", body: JSON.stringify({ email: "x@example.com", role: "owner" }) });
    expect(invite.status).toBe(400);
    const change = await call("/staff/user-staff", { method: "PATCH", body: JSON.stringify({ role: "owner" }) });
    expect(change.status).toBe(400);
  });

  it("lets the owner change a staff member's role", async () => {
    myRole = "owner";
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM firms f")) return [{ id: "firm_1", name: "Firm", owner_user_id: "user-owner" }];
      if (sql.includes("SELECT firm_id, role FROM firm_members")) return [{ firm_id: "firm_1", role: "owner" }];
      if (sql.includes("UPDATE firm_members SET role")) return [{ id: "fm_1" }];
      return [];
    });
    const res = await call("/staff/user-staff", { method: "PATCH", body: JSON.stringify({ role: "read_only" }) });
    expect(res.status).toBe(200);
    const update = queryMock.mock.calls.find(([sql]) => String(sql).includes("UPDATE firm_members SET role"));
    expect(update?.[0]).toContain("role <> 'owner'");
    expect(update?.[1]).toEqual(["firm_1", "user-staff", "read_only"]);
  });

  it("refuses to invite an email that already has an account", async () => {
    myRole = "owner";
    existingAccount = { id: "user-other" };
    const res = await call("/staff/invitations", { method: "POST", body: JSON.stringify({ email: "taken@example.com" }) });
    expect(res.status).toBe(409);
  });

  it("removes staff (never the owner) and ends their sessions", async () => {
    myRole = "owner";
    const res = await call("/staff/user-staff", { method: "DELETE" });
    expect(res.status).toBe(200);
    const del = queryMock.mock.calls.find(([sql]) => String(sql).includes("DELETE FROM firm_members"));
    expect(del?.[0]).toContain("role <> 'owner'");
    expect(del?.[1]).toEqual(["firm_1", "user-staff"]);
    expect(authDbSql.some((sql) => sql.includes("DELETE FROM session"))).toBe(true);
  });
});
