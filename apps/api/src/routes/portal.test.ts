import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Env } from "../env";

const queryMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("../db", () => ({
  createDb: () => ({ query: queryMock, transaction: transactionMock }),
}));

const testEnv: Env = {
  AUTH_DB: {} as unknown as Env["AUTH_DB"],
  DATABASE_URL: "postgresql://user:pass@localhost/db",
  RECEIPTS: {} as unknown as Env["RECEIPTS"],
  BETTER_AUTH_SECRET: "test-secret-at-least-32-chars-long!!",
  BETTER_AUTH_URL: "https://folio-api.rsolistx.workers.dev",
  VAPID_PUBLIC_KEY: "test-public-key",
  VAPID_PRIVATE_KEY: "test-private-key",
};

const LINK_ROW = {
  id: "plink_1",
  firm_id: "firm_1",
  client_id: "cli_1",
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  revoked_at: null,
};

function requestRow(status: string) {
  return { id: "creq_1", firm_id: "firm_1", client_id: "cli_1", work_item_id: null, status };
}

beforeEach(() => {
  queryMock.mockReset();
  transactionMock.mockReset();
  transactionMock.mockImplementation(async (statements: unknown[]) => statements.map(() => []));
});

async function postMessage(status: string) {
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM client_portal_links WHERE token_hash")) return [LINK_ROW];
    if (sql.startsWith("UPDATE client_portal_links SET last_used_at")) return [];
    if (sql.includes("FROM client_requests WHERE id = $1 AND firm_id = $2")) return [requestRow(status)];
    if (sql.startsWith("INSERT INTO request_messages")) return [];
    if (sql.includes("FROM request_messages WHERE id = $1")) return [{ id: "rmsg_1", body: "hi" }];
    return [];
  });

  const { portalRoutes } = await import("./portal");
  return portalRoutes.request(
    "/requests/creq_1/messages",
    {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ body: "hello" }),
    },
    testEnv,
  );
}

describe("POST /requests/:requestId/messages closed-request guard", () => {
  it("rejects a new message on a satisfied request with 409 and never writes it", async () => {
    const res = await postMessage("satisfied");
    expect(res.status).toBe(409);
    expect(queryMock.mock.calls.some(([sql]) => String(sql).startsWith("INSERT INTO request_messages"))).toBe(false);
  });

  it("rejects a new message on a cancelled request with 409 and never writes it", async () => {
    const res = await postMessage("cancelled");
    expect(res.status).toBe(409);
    expect(queryMock.mock.calls.some(([sql]) => String(sql).startsWith("INSERT INTO request_messages"))).toBe(false);
  });

  it("still accepts a new message on a nonterminal (requested) request", async () => {
    const res = await postMessage("requested");
    expect(res.status).toBe(201);
  });
});
