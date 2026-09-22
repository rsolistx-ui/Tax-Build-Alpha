import { describe, expect, it } from "vitest";
import type { Db } from "../db";
import type { Env } from "../env";
import type { ClientRow } from "./clients";
import { HttpError, ingestReceiptForClient, isSupportedReceiptUpload, applyDeterministicMarkdownRules } from "./receipt-intake";

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
