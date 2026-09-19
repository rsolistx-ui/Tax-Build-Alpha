import { describe, expect, it, vi } from "vitest";
import type { Env } from "../env";

const testEnv: Env = {
  DATABASE_URL: "postgres://localhost/test",
  AUTH_DB: {} as any,
  RECEIPTS: {} as any,
  BETTER_AUTH_SECRET: "mock-secret-at-least-32-chars-long",
  BETTER_AUTH_URL: "https://folio-api.rsolistx.workers.dev",
  OWNER_EMAIL: "test@example.com",
  VAPID_PUBLIC_KEY: "test-pub",
  VAPID_PRIVATE_KEY: "test-priv",
  PLAID_CLIENT_ID: "test-plaid-client",
  PLAID_CLIENT_SECRET: "test-plaid-secret",
  PLAID_ENVIRONMENT: "sandbox",
};

vi.mock("../db", () => ({
  createDb: () => ({
    query: async () => [],
    transaction: async () => [],
  }),
}));

vi.mock("../auth", () => ({
  createAuth: () => ({
    api: {
      getSession: async () => ({
        user: { id: "user_1", email: "test@example.com", name: "Test User" },
      }),
    },
  }),
}));

vi.mock("../services/firm", () => ({
  ensureFirm: async () => ({ id: "firm_1", name: "Test Firm" }),
}));

describe("bankConnectivityRoutes", () => {
  it("GET /providers returns plaid availability based on environment configuration", async () => {
    const { bankConnectivityRoutes } = await import("./bank-connectivity");
    const res = await bankConnectivityRoutes.request(
      "/providers",
      {
        method: "GET",
        headers: { authorization: "Bearer mock-token" },
      },
      testEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.plaid.available).toBe(true);
    expect(body.plaid.environment).toBe("sandbox");
    expect(body.teller.available).toBe(false);
  });
});
