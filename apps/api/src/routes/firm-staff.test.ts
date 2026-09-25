import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";

const queryMock = vi.fn();
const transactionMock = vi.fn();
vi.mock("../db", () => ({ createDb: () => ({ query: queryMock, transaction: transactionMock }) }));
vi.mock("../middleware/session", () => ({
  requireSession: async (c: any, next: any) => {
    c.set("userId", "user-me");
    c.set("userName", "Me");
    c.set("userEmail", "me@example.com");
    await next();
  },
}));
let betaBlocks = false;
vi.mock("../middleware/beta", () => ({
  requireActiveBeta: async (c: any, next: any) => (betaBlocks ? c.json({ code: "BETA_REQUIRED" }, 403) : next()),
}));

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

  it("invites an email that already has an account and says so", async () => {
    myRole = "owner";
    existingAccount = { id: "user-other" };
    const res = await call("/staff/invitations", { method: "POST", body: JSON.stringify({ email: "taken@example.com" }) });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { invitation: { existingAccount: boolean } };
    expect(body.invitation.existingAccount).toBe(true);
  });

  it("refuses to invite someone already on the team", async () => {
    myRole = "owner";
    existingAccount = { id: "user-staff" };
    const base = queryMock.getMockImplementation()!;
    queryMock.mockImplementation(async (sql: string, params: unknown[]) =>
      sql.includes("SELECT id FROM firm_members WHERE firm_id = $1 AND user_id = $2") ? [{ id: "fm_2" }] : base(sql, params));
    const res = await call("/staff/invitations", { method: "POST", body: JSON.stringify({ email: "staff@example.com" }) });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "ALREADY_MEMBER" });
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

describe("client assignment", () => {
  function withStaffAndClients(clientIdsInFirm: string[]) {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM firms f")) return [{ id: "firm_1", name: "Firm", owner_user_id: "user-owner" }];
      if (sql.includes("SELECT firm_id, role FROM firm_members")) return [{ firm_id: "firm_1", role: myRole }];
      if (sql.includes("SELECT id FROM firm_members")) return [{ id: "fm_2" }];
      if (sql.includes("SELECT id FROM clients")) return clientIdsInFirm.map((id) => ({ id }));
      return [];
    });
  }

  beforeEach(() => transactionMock.mockReset());

  it("lets only the firm owner assign clients", async () => {
    myRole = "preparer";
    withStaffAndClients(["cli_a"]);
    const res = await call("/staff/user-staff/clients", { method: "PUT", body: JSON.stringify({ seesAllClients: false, clientIds: ["cli_a"] }) });
    expect(res.status).toBe(403);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("refuses a client that is not in the owner's firm", async () => {
    myRole = "owner";
    withStaffAndClients(["cli_a"]);
    const res = await call("/staff/user-staff/clients", { method: "PUT", body: JSON.stringify({ seesAllClients: false, clientIds: ["cli_a", "cli_elsewhere"] }) });
    expect(res.status).toBe(400);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("replaces the member's assignments and switch in one transaction", async () => {
    myRole = "owner";
    withStaffAndClients(["cli_a", "cli_b"]);
    const res = await call("/staff/user-staff/clients", { method: "PUT", body: JSON.stringify({ seesAllClients: false, clientIds: ["cli_a", "cli_b", "cli_a"] }) });
    expect(res.status).toBe(200);
    const [statements] = transactionMock.mock.calls[0] as [{ query: string; params: unknown[] }[]];
    expect(statements[0].query).toContain("sees_all_clients");
    expect(statements[0].params).toEqual(["firm_1", "user-staff", false]);
    expect(statements[1].query).toContain("client_assignments");
    // Arrays reach Neon as JSON text, so the insert unpacks them as jsonb.
    expect(statements[2].query).toContain("jsonb_array_elements_text($1::jsonb)");
    expect(statements[2].params).toEqual([["cli_a", "cli_b"], "firm_1", "user-staff", "user-me"]);
  });
});

describe("an existing account joins a firm", () => {
  const TOKEN = "t".repeat(40);
  let invitation: Record<string, unknown> | null;
  let membership: { firm_id: string; role: string } | null;
  let usage: { clients: string; staff: string };

  beforeEach(() => {
    transactionMock.mockReset();
    transactionMock.mockResolvedValue([]);
    betaBlocks = false;
    invitation = { id: "biv_1", email: "Me@Example.com", firm_id: "firm_owner", firm_role: "bookkeeper", firm_name: "Phyllis Tax" };
    membership = null;
    usage = { clients: "0", staff: "0" };
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM beta_invitations i JOIN firms f")) return invitation ? [invitation] : [];
      if (sql.includes("SELECT firm_id, role FROM firm_members")) return membership ? [membership] : [];
      if (sql.includes("SELECT (SELECT COUNT(*) FROM clients")) return [usage];
      if (sql.includes("SET status = 'redeemed'")) return [{ id: "biv_1" }];
      return [];
    });
  });

  async function join(path: string) {
    const { firmJoinRoutes } = await import("./firm-staff");
    return firmJoinRoutes.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: TOKEN }) }, env());
  }
  const claimed = () => queryMock.mock.calls.some(([sql]) => String(sql).includes("SET status = 'redeemed'"));
  const statements = () => (transactionMock.mock.calls[0]?.[0] ?? []) as { query: string; params: unknown[] }[];

  it("adds an account with no firm, even when its own access has lapsed", async () => {
    betaBlocks = true; // a removed staff member: signed in, but no active access of their own
    const res = await join("/accept");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, firmName: "Phyllis Tax", role: "bookkeeper" });
    const insert = statements().find((s) => s.query.includes("INSERT INTO firm_members"));
    expect(insert?.params.slice(1)).toEqual(["firm_owner", "user-me", "bookkeeper"]);
    expect(statements().some((s) => s.query.includes("DELETE FROM firm_members"))).toBe(false);
  });

  it("refuses an invitation sent to a different email and does not reveal the firm", async () => {
    invitation!.email = "someone-else@example.com";
    for (const path of ["/preview", "/accept"]) {
      const res = await join(path);
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain("Phyllis Tax");
    }
    expect(claimed()).toBe(false);
  });

  it("refuses an invalid or used token", async () => {
    invitation = null;
    const res = await join("/accept");
    expect(res.status).toBe(404);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("moves the owner of an empty firm, keeping the old firm and revoking its pending invitations", async () => {
    membership = { firm_id: "firm_mine", role: "owner" };
    const res = await join("/accept");
    expect(res.status).toBe(200);
    const s = statements();
    const leave = s.find((x) => x.query.includes("DELETE FROM firm_members"));
    expect(leave?.params).toEqual(["firm_mine", "user-me"]);
    // The emptiness check is repeated inside the transaction, not only before it.
    expect(leave?.query).toContain("NOT EXISTS (SELECT 1 FROM clients WHERE firm_id = $1)");
    expect(leave?.query).toContain("o.user_id <> $2");
    expect(s.find((x) => x.query.includes("SET status = 'revoked'"))?.params).toEqual(["firm_mine"]);
    expect(s.some((x) => x.query.includes("DELETE FROM firms"))).toBe(false);
  });

  it("refuses when the account's own firm has clients or staff", async () => {
    membership = { firm_id: "firm_mine", role: "owner" };
    usage = { clients: "2", staff: "0" };
    const res = await join("/accept");
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "OWN_FIRM_IN_USE" });
    expect(claimed()).toBe(false);
  });

  it("refuses staff of another firm and someone already on this team", async () => {
    membership = { firm_id: "firm_other", role: "preparer" };
    let res = await join("/accept");
    await expect(res.json()).resolves.toMatchObject({ code: "IN_ANOTHER_FIRM" });
    membership = { firm_id: "firm_owner", role: "bookkeeper" };
    res = await join("/accept");
    await expect(res.json()).resolves.toMatchObject({ code: "ALREADY_MEMBER" });
    expect(claimed()).toBe(false);
  });

  it("releases the invitation when joining fails", async () => {
    transactionMock.mockRejectedValue(new Error("unique violation"));
    const res = await join("/accept");
    expect(res.status).toBe(500);
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("SET status = 'pending'"))).toBe(true);
  });
});
