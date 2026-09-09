import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Env } from "../env";

const queryMock = vi.fn();
const transactionMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock("../db", () => ({
  createDb: () => ({ query: queryMock, transaction: transactionMock }),
}));

vi.mock("../auth", () => ({
  createAuth: () => ({ api: { getSession: getSessionMock } }),
}));

const testEnv: Env = {
  AUTH_DB: {} as unknown as Env["AUTH_DB"],
  DATABASE_URL: "postgresql://user:pass@localhost/db",
  RECEIPTS: {} as unknown as Env["RECEIPTS"],
  BETTER_AUTH_SECRET: "test-secret-at-least-32-chars-long!!",
  BETTER_AUTH_URL: "https://folio-api.rsolistx.workers.dev",
  OWNER_EMAIL: "owner@example.com",
};

const FIRM_ROW = { id: "firm_1", name: "Test Firm", owner_user_id: "user_1" };
const CLIENT_ROW = { id: "cli_1", firm_id: "firm_1", name: "Test Client" };

function requestRow(status: string) {
  return { id: "creq_1", firm_id: "firm_1", client_id: "cli_1", work_item_id: null, status };
}

beforeEach(() => {
  queryMock.mockReset();
  transactionMock.mockReset();
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({ user: { id: "user_1", email: "owner@example.com", name: "Owner" } });
  transactionMock.mockImplementation(async (statements: unknown[]) => statements.map(() => []));
});

async function postSatisfy(status: string) {
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM firms f")) return [FIRM_ROW];
    if (sql.includes("FROM clients WHERE id = $1 AND firm_id = $2")) return [CLIENT_ROW];
    if (sql.includes("FROM client_requests WHERE id = $1 AND firm_id = $2")) return [requestRow(status)];
    return [];
  });

  const { clientRequestRoutes } = await import("./client-requests");
  return clientRequestRoutes.request(
    "/cli_1/requests/creq_1/satisfy",
    { method: "POST", headers: { authorization: "Bearer test-token" } },
    testEnv,
  );
}

describe("POST /:clientId/requests/:requestId/satisfy already-terminal guard", () => {
  it("rejects satisfying an already-satisfied request with 409 and performs no mutation", async () => {
    const res = await postSatisfy("satisfied");
    expect(res.status).toBe(409);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects satisfying an already-cancelled request with 409 and performs no mutation (no resurrection)", async () => {
    const res = await postSatisfy("cancelled");
    expect(res.status).toBe(409);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("still satisfies a legitimate nonterminal (responded) request successfully", async () => {
    const res = await postSatisfy("responded");
    expect(res.status).toBe(200);
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });
});
