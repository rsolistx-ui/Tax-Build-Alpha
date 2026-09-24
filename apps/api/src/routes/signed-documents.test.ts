import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Env } from "../env";

const queryMock = vi.fn();
vi.mock("../db", () => ({ createDb: () => ({ query: queryMock }) }));
vi.mock("../lib/signed-url", () => ({ verifyDocumentToken: vi.fn(async () => "all") }));

const env: Env = {
  AUTH_DB: {} as Env["AUTH_DB"], DATABASE_URL: "postgresql://test", RECEIPTS: { get: vi.fn() } as unknown as R2Bucket,
  BETTER_AUTH_SECRET: "test-secret-at-least-32-chars-long!!", BETTER_AUTH_URL: "https://example.test",
  VAPID_PUBLIC_KEY: "test", VAPID_PRIVATE_KEY: "test",
};

describe("signed document entitlement gate", () => {
  beforeEach(() => queryMock.mockReset());

  it("refuses a valid signed URL after the owning firm's entitlement expires", async () => {
    queryMock.mockResolvedValueOnce([{
      r2_key: "firm/client/file.pdf", filename: "file.pdf", content_type: "application/pdf",
      entitlement_status: "active", entitlement_expires_at: new Date(Date.now() - 1_000).toISOString(),
    }]);
    const { signedDocumentRoutes } = await import("./signed-documents");
    const res = await signedDocumentRoutes.request("/doc_1/token", {}, env);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "BETA_EXPIRED" });
  });
});
