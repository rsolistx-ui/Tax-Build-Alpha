import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Env } from "../env";

const queryMock = vi.fn();
vi.mock("../db", () => ({ createDb: () => ({ query: queryMock }) }));
const verifyMock = vi.fn(async (): Promise<"all" | "unsigned" | null> => "all");
vi.mock("../lib/signed-url", () => ({ verifyDocumentToken: verifyMock }));

const env: Env = {
  AUTH_DB: {} as Env["AUTH_DB"], DATABASE_URL: "postgresql://test", RECEIPTS: { get: vi.fn() } as unknown as R2Bucket,
  BETTER_AUTH_SECRET: "test-secret-at-least-32-chars-long!!", BETTER_AUTH_URL: "https://example.test",
  VAPID_PUBLIC_KEY: "test", VAPID_PRIVATE_KEY: "test",
};

describe("signed document entitlement gate", () => {
  beforeEach(() => { queryMock.mockReset(); verifyMock.mockResolvedValue("all"); });

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

describe("download links minted for roles that cannot read signed records", () => {
  beforeEach(() => { queryMock.mockReset(); verifyMock.mockResolvedValue("unsigned"); });

  it("refuses the file once the document has become a signed record", async () => {
    queryMock.mockResolvedValueOnce([{ "?column?": 1 }]); // signed-record check finds a match
    const { signedDocumentRoutes } = await import("./signed-documents");
    const res = await signedDocumentRoutes.request("/doc_1/token", {}, env);
    expect(res.status).toBe(404);
    expect(String(queryMock.mock.calls[0][0])).toContain("signature_requests");
  });

  it("still serves an ordinary document", async () => {
    queryMock
      .mockResolvedValueOnce([]) // not a signed record
      .mockResolvedValueOnce([{ r2_key: "k", filename: "f.pdf", content_type: "application/pdf", entitlement_status: "active", entitlement_expires_at: new Date(Date.now() + 86_400_000).toISOString() }])
      .mockResolvedValueOnce([]); // no versions
    (env.RECEIPTS.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ body: "pdf-bytes", httpMetadata: {} });
    const { signedDocumentRoutes } = await import("./signed-documents");
    const res = await signedDocumentRoutes.request("/doc_1/token", {}, env);
    expect(res.status).toBe(200);
  });
});
