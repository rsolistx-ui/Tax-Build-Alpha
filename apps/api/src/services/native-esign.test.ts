import { describe, expect, it } from "vitest";
import { NativeEsignService } from "./native-esign";
import { buildEngagementLetterPdf } from "./engagement-letter";
import { PDFDocument } from "pdf-lib";
import type { Db } from "../db";
import type { Env } from "../env";

function mockDb() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.includes("SELECT max(version)")) return [{ m: 1 }] as T[];
      return [{ id: "test-id" }] as T[];
    },
    async transaction<T>() { return [] as T[][]; },
  };
  return { db, calls };
}

const mockEnv: Env = {
  DATABASE_URL: "postgres://localhost/test",
  AUTH_DB: {} as any,
  RECEIPTS: {
    put: async () => ({}),
  } as any,
  BETTER_AUTH_SECRET: "mock-secret-at-least-32-chars-long",
  BETTER_AUTH_URL: "https://folio-api.rsolistx.workers.dev",
  VAPID_PUBLIC_KEY: "test-pub",
  VAPID_PRIVATE_KEY: "test-priv",
};

describe("NativeEsignService (DocuSign/HelloSign Killer)", () => {
  it("throws error if signer has not consented to ESIGN agreement", async () => {
    const { db } = mockDb();
    const service = new NativeEsignService(db, mockEnv);
    const { pdfBytes } = await buildEngagementLetterPdf({
      firmName: "Apex Tax Advisory",
      clientName: "Bob Construction",
      serviceType: "tax_1040",
      effectiveDate: new Date(),
    });

    await expect(
      service.stampAndCertifyDocument(
        "firm_1",
        "cli_1",
        "sigr_1",
        "doc_1",
        pdfBytes,
        {
          signatureType: "typed",
          signatureData: "Bob Builder",
          signerName: "Bob Builder",
          signerEmail: "bob@example.com",
          consentAgreed: false,
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0",
        },
      ),
    ).rejects.toThrow("15 U.S.C. § 7001");
  });

  it("stamps typed signature and appends tamper-evident Certificate of Completion", async () => {
    const { db, calls } = mockDb();
    const service = new NativeEsignService(db, mockEnv);
    const { pdfBytes, signatureTab } = await buildEngagementLetterPdf({
      firmName: "Apex Tax Advisory",
      clientName: "Bob Construction",
      serviceType: "tax_1040",
      effectiveDate: new Date(),
    });

    const result = await service.stampAndCertifyDocument(
      "firm_1",
      "cli_1",
      "sigr_1",
      "doc_1",
      pdfBytes,
      {
        signatureType: "typed",
        signatureData: "Bob Builder",
        signerName: "Bob Builder",
        signerEmail: "bob@example.com",
        consentAgreed: true,
        ipAddress: "73.189.42.10",
        userAgent: "iPhone / Mobile Safari",
      },
      [
        {
          pageNumber: String(signatureTab.pageNumber),
          xPosition: String(signatureTab.xPosition),
          yPosition: String(signatureTab.yPosition),
        },
      ],
    );

    expect(result.certificateId).toMatch(/^cert_/);
    expect(result.signedR2Key).toContain("signed-documents/firm_1/cli_1/doc_1-certified.pdf");
    expect(result.documentHash).toHaveLength(64);

    // Verify PDF structure has added the certificate page (original 1 page -> now 2 pages)
    const signedDoc = await PDFDocument.load(result.signedPdfBytes);
    expect(signedDoc.getPageCount()).toBe(2);

    // Verify audit event was logged to database
    const auditCall = calls.find((c) => c.sql.includes("native_document_signed"));
    expect(auditCall).toBeDefined();
    expect(auditCall?.params[3]).toBe("bob@example.com");
  });
});
