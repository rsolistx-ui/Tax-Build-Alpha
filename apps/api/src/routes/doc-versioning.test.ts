import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Env } from "../env";

const queryMock = vi.fn();
vi.mock("../db", () => ({ createDb: () => ({ query: queryMock }) }));
vi.mock("../services/firm", () => ({ ensureFirm: async () => ({ id: "firm_a" }) }));
vi.mock("../services/clients", () => ({ getClient: async (_db: unknown, id: string) => ({ id }) }));
const createMock = vi.fn(async () => ({ id: "sigr_1" }));
vi.mock("../services/doc-versioning", async (orig) => ({ ...(await orig<object>()), createSignatureRequest: createMock }));

const env = { DATABASE_URL: "postgresql://test" } as Env;

async function post(body: Record<string, unknown>) {
  const { docVersioningRoutes } = await import("./doc-versioning");
  return docVersioningRoutes.request("/cli_a/signature-requests", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }, env);
}

describe("POST /:clientId/signature-requests ownership checks", () => {
  beforeEach(() => { queryMock.mockReset(); queryMock.mockResolvedValue([]); createMock.mockClear(); });

  it("refuses a document that belongs to another client", async () => {
    const res = await post({ documentId: "doc_other" });
    expect(res.status).toBe(404);
    expect(createMock).not.toHaveBeenCalled();
    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain("FROM client_documents WHERE id=$1 AND client_id=$2");
    expect(params).toEqual(["doc_other", "cli_a"]);
  });

  it("refuses an engagement that belongs to another client", async () => {
    const res = await post({ engagementId: "eng_other" });
    expect(res.status).toBe(404);
    expect(createMock).not.toHaveBeenCalled();
    expect(queryMock.mock.calls[0][1]).toEqual(["eng_other", "cli_a", "firm_a"]);
  });

  it("creates the request when the document belongs to the client", async () => {
    queryMock.mockResolvedValueOnce([{ id: "doc_1" }]);
    const res = await post({ documentId: "doc_1" });
    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledOnce();
  });
});
