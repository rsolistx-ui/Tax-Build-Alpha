import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildEngagementLetterPdf } from "./engagement-letter";

describe("buildEngagementLetterPdf", () => {
  it("produces a real, loadable one-page PDF with a valid header", async () => {
    const { pdfBytes } = await buildEngagementLetterPdf({
      firmName: "Test Firm LLC",
      clientName: "Jane Client",
      serviceType: "tax_1040",
      taxYear: 2025,
      fee: "$450",
      effectiveDate: new Date("2026-09-16"),
    });

    expect(Buffer.from(pdfBytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");

    const loaded = await PDFDocument.load(pdfBytes);
    expect(loaded.getPageCount()).toBe(1);
    const page = loaded.getPage(0);
    expect(page.getSize()).toEqual({ width: 612, height: 792 });
  });

  it("returns signature and date tabs positioned on page 1, within page bounds", async () => {
    const { signatureTab, dateTab } = await buildEngagementLetterPdf({
      firmName: "Test Firm LLC",
      clientName: "Jane Client",
      serviceType: "bookkeeping",
      taxYear: null,
      fee: null,
      effectiveDate: new Date("2026-09-16"),
    });

    for (const tab of [signatureTab, dateTab]) {
      expect(tab.pageNumber).toBe(1);
      expect(tab.xPosition).toBeGreaterThan(0);
      expect(tab.xPosition).toBeLessThan(612);
      expect(tab.yPosition).toBeGreaterThan(0);
      expect(tab.yPosition).toBeLessThan(792);
    }
    expect(dateTab.xPosition).toBeGreaterThan(signatureTab.xPosition);
  });

  it("falls back to a generic label for an unrecognized service type instead of throwing", async () => {
    const { pdfBytes } = await buildEngagementLetterPdf({
      firmName: "Test Firm LLC",
      clientName: "Jane Client",
      serviceType: "not_a_real_service_type",
      taxYear: null,
      fee: null,
      effectiveDate: new Date("2026-09-16"),
    });
    expect(pdfBytes.length).toBeGreaterThan(0);
  });
});
