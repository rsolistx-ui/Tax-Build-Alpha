import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Env } from "../env";

const queryMock = vi.fn();
const transactionMock = vi.fn();
const signUpEmailMock = vi.fn();

vi.mock("../db", () => ({
  createDb: () => ({ query: queryMock, transaction: transactionMock }),
}));

vi.mock("../auth", () => ({
  createAuth: () => ({ api: { signUpEmail: signUpEmailMock } }),
}));

const testEnv: Env = {
  AUTH_DB: {} as unknown as Env["AUTH_DB"],
  DATABASE_URL: "postgresql://user:pass@localhost/db",
  RECEIPTS: {} as unknown as Env["RECEIPTS"],
  BETTER_AUTH_SECRET: "test-secret-at-least-32-chars-long!!",
  BETTER_AUTH_URL: "https://folio-api.rsolistx.workers.dev",
};

const PENDING_INVITATION = {
  id: "biv_test1",
  email: "invitee@example.com",
  status: "pending",
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  redeemed_at: null,
  beta_days: 30,
};

beforeEach(() => {
  queryMock.mockReset();
  transactionMock.mockReset();
  signUpEmailMock.mockReset();
});

describe("redemption activation and audit events are atomic", () => {
  it("commits the entitlement activation and both required beta audit events in a single db.transaction() call, with no fallible write after", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id, email, status, expires_at, redeemed_at, beta_days")) {
        return [PENDING_INVITATION];
      }
      if (sql.includes("UPDATE beta_invitations SET status = 'redeemed'")) {
        return [{ id: PENDING_INVITATION.id }];
      }
      return [];
    });
    transactionMock.mockImplementation(async (statements: Array<{ query: string }>) => statements.map(() => []));
    signUpEmailMock.mockResolvedValue(
      new Response(JSON.stringify({ user: { id: "user-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { betaRoutes } = await import("./beta");
    const res = await betaRoutes.request(
      "/redeem",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: "test-token",
          email: "invitee@example.com",
          password: "password123",
          name: "Test Invitee",
        }),
      },
      testEnv,
    );

    expect(res.status).toBe(200);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    const statements = transactionMock.mock.calls[0][0] as Array<{ query: string }>;
    expect(statements).toHaveLength(4);
    expect(statements.some((s) => s.query.includes("UPDATE beta_invitations SET redeemed_by_user_id"))).toBe(true);
    expect(statements.some((s) => s.query.includes("INSERT INTO beta_entitlements"))).toBe(true);
    const auditStatements = statements.filter((s) => s.query.includes("INSERT INTO beta_access_events"));
    expect(auditStatements).toHaveLength(2);

    // No further fallible database write happens between the transaction
    // succeeding and the response being returned: every db.query call must
    // have occurred before the (single) db.transaction call.
    const queryCallOrder = queryMock.mock.invocationCallOrder;
    const transactionCallOrder = transactionMock.mock.invocationCallOrder[0];
    expect(queryCallOrder.every((order) => order < transactionCallOrder)).toBe(true);
  });

  it("does not leave an orphan D1 account or a permanently claimed invitation when the post-signup Neon transaction fails", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id, email, status, expires_at, redeemed_at, beta_days")) {
        return [PENDING_INVITATION];
      }
      if (sql.includes("UPDATE beta_invitations SET status = 'redeemed'")) {
        return [{ id: PENDING_INVITATION.id }];
      }
      return [];
    });
    transactionMock.mockRejectedValue(new Error("simulated Neon outage"));
    signUpEmailMock.mockResolvedValue(
      new Response(JSON.stringify({ user: { id: "user-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const authDbCalls: string[] = [];
    const authDb = {
      prepare(sql: string) {
        authDbCalls.push(sql);
        return { bind: () => ({ run: async () => ({}) }) };
      },
    } as unknown as Env["AUTH_DB"];

    const { betaRoutes } = await import("./beta");
    const res = await betaRoutes.request(
      "/redeem",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: "test-token",
          email: "invitee@example.com",
          password: "password123",
          name: "Test Invitee",
        }),
      },
      { ...testEnv, AUTH_DB: authDb },
    );

    expect(res.status).toBe(500);
    expect(authDbCalls.some((sql) => sql.includes("DELETE FROM session"))).toBe(true);
    expect(authDbCalls.some((sql) => sql.includes("DELETE FROM account"))).toBe(true);
    expect(authDbCalls.some((sql) => sql.includes("DELETE FROM user"))).toBe(true);
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("SET status = 'pending'"))).toBe(true);
  });
});
