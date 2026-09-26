import { describe, expect, it } from "vitest";
import type { Db, DbStatement } from "../db";
import type { Env } from "../env";
import type { ClientRow } from "./clients";
import { HttpError, ingestReceiptForClient, isSupportedReceiptUpload, applyDeterministicMarkdownRules, receiptExtractionRetryDelaySeconds, recoverReceiptExtractionsWithDb, suggestDeterministicCategory } from "./receipt-intake";

const client: ClientRow = { id: "cli_1", firm_id: "firm_1", name: "Acme", legal_name: null, notes: null, email: null, phone: null, pipeline_status: "active", created_at: "now", updated_at: "now" };

const untouchedDb: Db = {
  async query<T>(): Promise<T[]> {
    throw new Error("validation should reject the upload before any query runs");
  },
  async transaction<T>(): Promise<T[][]> {
    throw new Error("validation should reject the upload before any transaction runs");
  },
};

const untouchedEnv = {
  RECEIPTS: {
    put: () => {
      throw new Error("validation should reject the upload before any R2 write");
    },
  },
} as unknown as Env;

function fileOf(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(Math.max(sizeBytes, 0))], name, { type });
}

describe("ingestReceiptForClient centralized validation", () => {
  it("rejects an empty file before any I/O", async () => {
    const file = fileOf("receipt.png", "image/png", 0);
    await expect(ingestReceiptForClient(untouchedDb, untouchedEnv, client, file, "user_1", null)).rejects.toThrow(HttpError);
    await expect(ingestReceiptForClient(untouchedDb, untouchedEnv, client, file, "user_1", null)).rejects.toThrow(/empty/i);
  });

  it("rejects an oversized file before any I/O", async () => {
    const file = fileOf("receipt.png", "image/png", 21 * 1024 * 1024);
    await expect(ingestReceiptForClient(untouchedDb, untouchedEnv, client, file, "user_1", null)).rejects.toThrow(/upload limit/i);
  });

  it("rejects an unsupported file type before any I/O", async () => {
    const file = fileOf("receipt.exe", "application/x-msdownload", 1024);
    await expect(ingestReceiptForClient(untouchedDb, untouchedEnv, client, file, "user_1", null)).rejects.toThrow(/unsupported file type/i);
  });

  it("rejects a document type that is valid elsewhere (docx) but not for a receipt", async () => {
    const file = fileOf("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 1024);
    await expect(ingestReceiptForClient(untouchedDb, untouchedEnv, client, file, "user_1", null)).rejects.toThrow(HttpError);
  });
});

describe("receipt extraction recovery", () => {
  it("keeps a provider outage recoverable instead of discarding the stored source", async () => {
    const statements: DbStatement[] = [];
    const db: Db = {
      async query<T>(query: string, params: unknown[] = []) {
        statements.push({ query, params });
        return (query.includes("RETURNING status") ? [{ status: "retry_pending" }] : []) as T[];
      },
      async transaction<T>(batch: DbStatement[]) { statements.push(...batch); return batch.map(() => []) as T[][]; },
    };
    const env = {
      LLM_PROVIDER: "azure",
      US_ONLY_READING: "true",
      RECEIPTS: { put: async () => ({}) },
    } as unknown as Env;

    const result = await ingestReceiptForClient(db, env, client, fileOf("receipt.png", "image/png", 12), "user_1", null);

    expect(result).toMatchObject({ ok: false, retryPending: true });
    expect(statements.some((statement) => statement.query.includes("ELSE 'retry_pending'"))).toBe(true);
    expect(statements.some((statement) => String(statement.params?.[0] ?? "").includes("OCR_RETRY_PENDING"))).toBe(true);
  });

  it("backs off retries and bounds a single retry delay", () => {
    expect(receiptExtractionRetryDelaySeconds(1)).toBe(60);
    expect(receiptExtractionRetryDelaySeconds(5)).toBe(960);
    expect(receiptExtractionRetryDelaySeconds(9)).toBe(1800);
  });

  it("reuses the existing receipt and R2 source on a successful recovery", async () => {
    const statements: DbStatement[] = [];
    const db: Db = {
      async query<T>(query: string, params: unknown[] = []) {
        statements.push({ query, params });
        if (query.includes("WITH recovered AS")) {
          return [{ id: "job_1", receiptId: "rcp_1", clientId: "cli_1", r2Key: "firm_1/cli_1/rcp_1/receipt.png", bankTransactionId: null, actorUserId: "user_1", attempt_count: 2, claim_token: "claim_1" }] as T[];
        }
        if (query.includes("FROM receipts r JOIN clients")) return [{ ...client, filename: "receipt.png", content_type: "image/png", r2_key: "firm_1/cli_1/rcp_1/receipt.png" }] as T[];
        if (query.includes("SELECT id FROM jobs WHERE id")) return [{ id: "job_1" }] as T[];
        if (query.includes("UPDATE jobs SET status = 'finalizing'")) return [{ id: "job_1" }] as T[];
        return [] as T[];
      },
      async transaction<T>(batch: DbStatement[]) { statements.push(...batch); return batch.map(() => []) as T[][]; },
    };
    const env = {
      LLM_PROVIDER: "mock",
      RECEIPTS: { get: async () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) },
    } as unknown as Env;

    const result = await recoverReceiptExtractionsWithDb(db, env);

    expect(result).toEqual({ claimed: 1, recovered: 1, retried: 0, deadLettered: 0 });
    expect(statements.some((statement) => statement.query.includes("INSERT INTO receipts"))).toBe(false);
    expect(statements.some((statement) => statement.query.includes("UPDATE jobs SET status = 'done'"))).toBe(true);
  });

  it("does not write receipt facts when a stale worker loses its finalizing lease", async () => {
    const statements: DbStatement[] = [];
    const db: Db = {
      async query<T>(query: string, params: unknown[] = []) {
        statements.push({ query, params });
        if (query.includes("WITH recovered AS")) {
          return [{ id: "job_1", receiptId: "rcp_1", clientId: "cli_1", r2Key: "firm_1/cli_1/rcp_1/receipt.png", bankTransactionId: null, actorUserId: "user_1", attempt_count: 2, claim_token: "stale_claim" }] as T[];
        }
        if (query.includes("FROM receipts r JOIN clients")) return [{ ...client, filename: "receipt.png", content_type: "image/png", r2_key: "firm_1/cli_1/rcp_1/receipt.png" }] as T[];
        if (query.includes("SELECT id FROM jobs WHERE id")) return [{ id: "job_1" }] as T[];
        // Simulate a newer claimant winning immediately before final persistence.
        if (query.includes("UPDATE jobs SET status = 'finalizing'")) return [] as T[];
        return [] as T[];
      },
      async transaction<T>(batch: DbStatement[]) { statements.push(...batch); return batch.map(() => []) as T[][]; },
    };
    const env = {
      LLM_PROVIDER: "mock",
      RECEIPTS: { get: async () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) },
    } as unknown as Env;

    expect(await recoverReceiptExtractionsWithDb(db, env)).toEqual({ claimed: 1, recovered: 0, retried: 0, deadLettered: 0 });
    expect(statements.some((statement) => statement.query.includes("UPDATE receipts SET\n          status = 'review'"))).toBe(false);
    expect(statements.some((statement) => statement.query.includes("INSERT INTO receipt_line_items"))).toBe(false);
  });
});

describe("isSupportedReceiptUpload", () => {
  it("accepts JPG", () => expect(isSupportedReceiptUpload("a.jpg", "image/jpeg")).toBe(true));
  it("accepts JPEG", () => expect(isSupportedReceiptUpload("a.jpeg", "image/jpeg")).toBe(true));
  it("accepts PNG", () => expect(isSupportedReceiptUpload("a.png", "image/png")).toBe(true));
  it("accepts PDF, since extraction explicitly branches on application/pdf", () => expect(isSupportedReceiptUpload("a.pdf", "application/pdf")).toBe(true));
  it("accepts HEIC", () => expect(isSupportedReceiptUpload("a.heic", "image/heic")).toBe(true));
  it("rejects DOCX (valid for general documents, not for a receipt)", () => expect(isSupportedReceiptUpload("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(false));
  it("rejects XLSX", () => expect(isSupportedReceiptUpload("a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(false));
  it("rejects CSV", () => expect(isSupportedReceiptUpload("a.csv", "text/csv")).toBe(false));
  it("rejects an unknown extension outright", () => expect(isSupportedReceiptUpload("a.exe", "application/x-msdownload")).toBe(false));
});

describe("suggestDeterministicCategory", () => {
  const extraction = (merchant: string, lines: string[] = []) => ({
    date: null, merchant, subtotal: null, tax: null, tip: null, total: 10, currency: "USD", category: null, confidence: 0.9,
    lineItems: lines.map((description) => ({ description, quantity: null, unitPrice: null, amount: null, category: null, confidence: 0.9 })),
  });

  it("offers Supplies from factual office-supply evidence, for professional approval", () => {
    expect(suggestDeterministicCategory(extraction("Folio Test Supply"), ["hotel", "supplies"])).toBe("supplies");
  });

  it("does not invent a category when the evidence is ambiguous", () => {
    expect(suggestDeterministicCategory(extraction("Example Merchant", ["General purchase"]), ["hotel", "supplies"])).toBeNull();
  });
});
