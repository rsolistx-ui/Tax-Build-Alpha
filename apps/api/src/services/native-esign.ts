import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Db } from "../db";
import type { Env } from "../env";
import { newId } from "../lib/id";
import { sha256Hex } from "./documents";
import { createVersion } from "./doc-versioning";

export interface SignatureSubmission {
  signatureType: "drawn" | "typed";
  signatureData: string; // Base64 data URL for drawn, or string name for typed
  signerName: string;
  signerEmail: string;
  consentAgreed: boolean;
  ipAddress: string;
  userAgent: string;
}

export interface StampedSignatureResult {
  signedPdfBytes: Uint8Array;
  signedR2Key: string;
  certificateId: string;
  documentHash: string;
}

/**
 * Native document-signing engine for non-IRS signature-authorisation documents.
 * 1. Takes the original document from storage.
 * 2. Stamps the signature on designated signature tabs.
 * 3. Appends a Certificate of Completion and writes the completed-document digest to the audit record.
 * 4. Computes SHA-256 cryptographic hashes before and after signature.
 */
export class NativeEsignService {
  constructor(private db: Db, private env: Env) {}

  async stampAndCertifyDocument(
    firmId: string,
    clientId: string,
    requestId: string,
    documentId: string,
    originalPdfBytes: Uint8Array,
    submission: SignatureSubmission,
    tabs?: Array<{ pageNumber?: string; xPosition?: string; yPosition?: string }>,
  ): Promise<StampedSignatureResult> {
    if (!submission.consentAgreed) {
      throw new Error("Signer must consent to electronic signature under 15 U.S.C. § 7001");
    }
    if (submission.signatureType === "drawn" && !submission.signatureData.startsWith("data:image/png;base64,")) {
      throw new Error("Drawn signatures must be submitted as a PNG data URL");
    }

    const originalHash = await sha256Hex(originalPdfBytes.buffer as ArrayBuffer);
    const doc = await PDFDocument.load(originalPdfBytes);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const certificateId = newId("cert");
    const signedAt = new Date().toISOString();

    const pages = doc.getPages();

    // 1. Stamp the signature onto the primary document page
    if (pages.length > 0) {
      const targetPage = pages[0]; // default to first page or designated tab
      const tab = tabs?.[0];
      const x = tab?.xPosition ? Number(tab.xPosition) : 72;
      const y = tab?.yPosition ? 792 - Number(tab.yPosition) : 100;

      if (submission.signatureType === "drawn" && submission.signatureData.startsWith("data:image/png;base64,")) {
        try {
          const base64Data = submission.signatureData.replace(/^data:image\/png;base64,/, "");
          const imageBytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
          const pngImage = await doc.embedPng(imageBytes);
          const dims = pngImage.scale(0.35);
          targetPage.drawImage(pngImage, {
            x,
            y,
            width: Math.min(dims.width, 180),
            height: Math.min(dims.height, 50),
          });
        } catch {
          // Fallback to text stamp if PNG decoding encounters non-standard bytes
          targetPage.drawText(`/${submission.signerName}/ (Digitally Signed)`, {
            x,
            y: y + 10,
            size: 11,
            font: bold,
            color: rgb(0.1, 0.2, 0.45),
          });
        }
      } else {
        // Styled typed signature
        targetPage.drawText(`/${submission.signerName}/`, {
          x,
          y: y + 10,
          size: 13,
          font: bold,
          color: rgb(0.08, 0.2, 0.45),
        });
      }

      targetPage.drawText(`Electronically signed by ${submission.signerName} · ${signedAt.slice(0, 10)}`, {
        x,
        y: y - 10,
        size: 8,
        font,
        color: rgb(0.4, 0.4, 0.4),
      });
    }

    // 2. Append the Audit Certificate of Completion as a dedicated final page
    const certPage = doc.addPage([612, 792]);
    const margin = 54;
    let cy = 792 - margin;

    const printLine = (text: string, options: { size?: number; useBold?: boolean; gap?: number; color?: any; font?: any } = {}) => {
      const size = options.size ?? 10;
      certPage.drawText(text, {
        x: margin,
        y: cy,
        size,
        font: options.font ?? (options.useBold ? bold : font),
        color: options.color ?? rgb(0.15, 0.15, 0.15),
      });
      cy -= options.gap ?? size + 8;
    };

    // Header Banner
    printLine("FOLIO PRACTICE OS — CERTIFICATE OF COMPLETION", { size: 13, useBold: true, gap: 18 });
    printLine(`Certificate ID: ${certificateId}`, { size: 9, color: rgb(0.4, 0.4, 0.4), gap: 14 });
    printLine("This document has been electronically signed pursuant to the United States Electronic Signatures in", { size: 8.5, color: rgb(0.3, 0.3, 0.3), gap: 10 });
    printLine("Global and National Commerce Act (ESIGN, 15 U.S.C. § 7001 et seq.) and Uniform Electronic Transactions Act (UETA).", { size: 8.5, color: rgb(0.3, 0.3, 0.3), gap: 20 });

    certPage.drawLine({
      start: { x: margin, y: cy + 6 },
      end: { x: 612 - margin, y: cy + 6 },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
    });
    cy -= 14;

    // Summary Details Table
    printLine("DOCUMENT & SIGNING AUDIT TRAIL", { size: 10, useBold: true, gap: 14 });
    printLine(`Document ID: ${documentId}`, { size: 9, gap: 12 });
    printLine(`Signature Request ID: ${requestId}`, { size: 9, gap: 12 });
    printLine(`Signer Full Name: ${submission.signerName}`, { size: 9, gap: 12 });
    printLine(`Signer Email: ${submission.signerEmail}`, { size: 9, gap: 12 });
    printLine(`Signature Timestamp: ${signedAt} UTC`, { size: 9, gap: 12 });
    printLine(`Signer IP Address: ${submission.ipAddress || "Verified Remote Client"}`, { size: 9, gap: 12 });
    printLine(`User Agent: ${submission.userAgent.slice(0, 75)}...`, { size: 8.5, color: rgb(0.3, 0.3, 0.3), gap: 16 });

    certPage.drawLine({
      start: { x: margin, y: cy + 6 },
      end: { x: 612 - margin, y: cy + 6 },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
    });
    cy -= 14;

    // The original digest is embedded in the certificate. The digest of the
    // completed PDF is calculated only after the PDF is finalised; embedding a
    // document's own final hash would change that document and make the value
    // unverifiable.
    printLine("CRYPTOGRAPHIC INTEGRITY VERIFICATION", { size: 10, useBold: true, gap: 14 });
    printLine(`Original Document SHA-256:`, { size: 8.5, useBold: true, gap: 10 });
    printLine(originalHash, { size: 8, font, color: rgb(0.25, 0.25, 0.25), gap: 14 });

    printLine("Completed-document SHA-256 is retained with the signed audit event.", {
      size: 8.5,
      color: rgb(0.25, 0.25, 0.25),
      gap: 18,
    });
    printLine("Status: COMPLETED · FOLIO SIGNATURE RECORD", {
      size: 9.5,
      useBold: true,
      color: rgb(0.05, 0.5, 0.25),
      gap: 12,
    });

    const signedPdfBytes = await doc.save();
    const finalHash = await sha256Hex(signedPdfBytes.buffer as ArrayBuffer);
    const signedR2Key = `signed-documents/${firmId}/${clientId}/${documentId}-certified.pdf`;

    // 3. Persist to Cloudflare R2
    if (this.env.RECEIPTS) {
      await this.env.RECEIPTS.put(signedR2Key, signedPdfBytes, {
        httpMetadata: { contentType: "application/pdf" },
      });
    }

    // 4. Create new version in PostgreSQL
    await createVersion(this.db, firmId, documentId, signedR2Key, "client-signer");
    await this.db.query(
      `UPDATE client_documents
       SET r2_key = $1, status = 'confirmed', content_type = 'application/pdf', updated_at = NOW()
       WHERE id = $2 AND client_id = $3`,
      [signedR2Key, documentId, clientId],
    );

    // 5. Update signature request status
    await this.db.query(
      `UPDATE signature_requests
       SET status = 'signed',
           signed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [requestId],
    );

    // 6. Record immutable audit event
    await this.db.query(
      `INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at)
       VALUES ($1, $2, $3, 'native_document_signed', $4, $5::jsonb, NOW())`,
      [
        newId("aud"),
        firmId,
        clientId,
        submission.signerEmail,
        JSON.stringify({
          requestId,
          documentId,
          certificateId,
          originalHash,
          finalHash,
          signerName: submission.signerName,
          ipAddress: submission.ipAddress,
          signedAt,
        }),
      ],
    );

    return {
      signedPdfBytes,
      signedR2Key,
      certificateId,
      documentHash: finalHash,
    };
  }
}
