import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const SERVICE_LABELS: Record<string, string> = {
  bookkeeping: "Bookkeeping Services",
  monthly_close: "Monthly Close Services",
  quarterly_work: "Quarterly Bookkeeping and Review Services",
  tax_1040: "Individual Income Tax Preparation (Form 1040)",
  tax_1065: "Partnership Income Tax Preparation (Form 1065)",
  tax_1120: "Corporate Income Tax Preparation (Form 1120)",
  tax_1120s: "S Corporation Income Tax Preparation (Form 1120-S)",
  payroll_compliance: "Payroll Compliance Services",
  advisory: "Advisory Services",
  custom: "Professional Services",
};

export type EngagementLetterInput = {
  firmName: string;
  clientName: string;
  serviceType: string;
  taxYear?: number | null;
  fee?: string | null;
  effectiveDate: Date;
};

/**
 * Renders a plain, standard one-page engagement letter. Page size is US
 * Letter (612x792pt); the returned signature/date tab coordinates are in
 * the same top-left-origin scheme already used by the DocuSign tabs
 * elsewhere in this codebase (see routes/docu-sign.ts's 8879 flow).
 */
export async function buildEngagementLetterPdf(input: EngagementLetterInput): Promise<{
  pdfBytes: Uint8Array;
  signatureTab: { pageNumber: number; xPosition: number; yPosition: number };
  dateTab: { pageNumber: number; xPosition: number; yPosition: number };
}> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const serviceLabel = SERVICE_LABELS[input.serviceType] ?? "Professional Services";
  const dateLabel = input.effectiveDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const margin = 72;
  let y = 792 - margin;

  const drawLine = (text: string, options: { size?: number; useBold?: boolean; gap?: number } = {}) => {
    const size = options.size ?? 11;
    page.drawText(text, { x: margin, y, size, font: options.useBold ? bold : font, color: rgb(0.1, 0.1, 0.1) });
    y -= options.gap ?? size + 8;
  };

  const drawWrapped = (text: string, maxChars = 92) => {
    const words = text.split(" ");
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length > maxChars) {
        drawLine(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) drawLine(line);
  };

  drawLine(input.firmName, { size: 14, useBold: true, gap: 28 });
  drawLine(`Engagement Letter — ${serviceLabel}`, { size: 13, useBold: true, gap: 24 });
  drawLine(dateLabel, { gap: 24 });

  drawLine(`Dear ${input.clientName},`, { gap: 20 });
  drawWrapped(
    `This letter confirms the terms of our engagement to provide ${serviceLabel.toLowerCase()}` +
      (input.taxYear ? ` for tax year ${input.taxYear}` : "") + `. This letter, once signed by both parties, ` +
      `constitutes our mutual agreement as to the scope, terms, and fees of this engagement.`,
  );
  y -= 12;

  drawLine("Scope of Services", { useBold: true, gap: 18 });
  drawWrapped(
    `We will perform the services described above based on information and documentation you provide. ` +
      `You remain responsible for the accuracy and completeness of that information. This engagement does not ` +
      `include an audit, review, or verification of the underlying records beyond what is customary for the ` +
      `service described.`,
  );
  y -= 12;

  drawLine("Fees", { useBold: true, gap: 18 });
  drawWrapped(
    input.fee
      ? `Fees for this engagement are ${input.fee}, invoiced separately from this letter.`
      : `Fees for this engagement will be invoiced separately per our standard rates, and communicated to you in advance of material changes in scope.`,
  );
  y -= 12;

  drawLine("Acceptance", { useBold: true, gap: 18 });
  drawWrapped(`Please sign and date below to confirm your acceptance of these terms.`);
  y -= 48;

  page.drawLine({ start: { x: margin, y }, end: { x: margin + 220, y }, thickness: 1, color: rgb(0.3, 0.3, 0.3) });
  page.drawLine({ start: { x: margin + 260, y }, end: { x: margin + 400, y }, thickness: 1, color: rgb(0.3, 0.3, 0.3) });
  const signatureLineY = y;
  y -= 14;
  drawLine("Client Signature", { size: 9 });
  page.drawText("Date", { x: margin + 260, y: signatureLineY - 14, size: 9, font, color: rgb(0.3, 0.3, 0.3) });

  const pdfBytes = await doc.save();

  return {
    pdfBytes,
    signatureTab: { pageNumber: 1, xPosition: margin, yPosition: Math.round(792 - signatureLineY) },
    dateTab: { pageNumber: 1, xPosition: margin + 260, yPosition: Math.round(792 - signatureLineY) },
  };
}
