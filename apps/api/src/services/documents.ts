/**
 * General client document intake, beyond receipts. Deterministic-first
 * classification and checklist generation - AI extraction is reserved for
 * the existing specialized receipt pipeline, which this module does not
 * touch. An uncertain classification is only ever a suggestion; the
 * professional confirms or corrects it in the document review queue.
 */
export const DOCUMENT_TYPES = [
  "receipt",
  "bank_statement",
  "tax_document",
  "prior_year_return",
  "payroll_document",
  "loan_document",
  "formation_document",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_STATUSES = ["needs_review", "confirmed", "duplicate", "not_needed"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const CHECKLIST_STATUSES = ["expected", "requested", "received", "reviewed", "not_applicable"] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

export const CHECKLIST_DOC_TYPES = [
  "prior_year_return",
  "bank_statements",
  "credit_card_statements",
  "1099",
  "w2",
  "k1",
  "1098",
  "payroll_summaries",
  "loan_statements",
  "depreciation_fixed_assets",
  "estimated_tax_payments",
  "formation_change_documents",
  "other",
] as const;
export type ChecklistDocType = (typeof CHECKLIST_DOC_TYPES)[number];

export function isValidDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

export function isValidChecklistStatus(value: string): value is ChecklistStatus {
  return (CHECKLIST_STATUSES as readonly string[]).includes(value);
}

/**
 * Deterministic filename/content-type based suggestion. Never a final
 * classification - the review queue is where a professional confirms it.
 */
export function suggestDocumentType(filename: string): DocumentType {
  const f = filename.toLowerCase();
  if (/1099|w-?2|k-?1|1098/.test(f)) return "tax_document";
  if (/prior.?year|tax.?return/.test(f)) return "prior_year_return";
  if (/bank.?statement|checking|savings/.test(f)) return "bank_statement";
  if (/payroll|pay.?stub|paystub/.test(f)) return "payroll_document";
  if (/loan|mortgage/.test(f)) return "loan_document";
  if (/articles.?of|formation|operating.?agreement|ein.?letter/.test(f)) return "formation_document";
  if (/receipt|invoice/.test(f)) return "receipt";
  return "other";
}

export type ChecklistGenerationInput = {
  entityType: string | null;
  taxPrepRequired: boolean;
  hasBankActivity: boolean;
  priorYearReturnAvailable: boolean | null;
};

export type GeneratedChecklistItem = { docType: ChecklistDocType; customLabel: string | null };

/**
 * Deterministic checklist generation from known client context. Never one
 * universal list - a client with tax preparation not required gets none,
 * and the entity-type/activity signals shape which document classes apply.
 */
export function generateChecklist(input: ChecklistGenerationInput): GeneratedChecklistItem[] {
  if (!input.taxPrepRequired) return [];

  const items: GeneratedChecklistItem[] = [];
  if (input.priorYearReturnAvailable !== false) {
    items.push({ docType: "prior_year_return", customLabel: null });
  }
  if (input.hasBankActivity) {
    items.push({ docType: "bank_statements", customLabel: null });
  }

  const entityType = (input.entityType ?? "").toLowerCase();
  const isPassthroughOrCorp = ["sole_proprietor", "llc", "s_corp", "c_corp", "partnership"].includes(entityType);
  if (["s_corp", "c_corp", "partnership"].includes(entityType)) {
    items.push({ docType: "k1", customLabel: null });
  }
  if (isPassthroughOrCorp) {
    items.push({ docType: "1099", customLabel: null });
    items.push({ docType: "estimated_tax_payments", customLabel: null });
  }
  items.push({ docType: "depreciation_fixed_assets", customLabel: null });

  return items;
}

export function isDuplicateCandidate(newHash: string, existingHashes: readonly string[]): boolean {
  return existingHashes.includes(newHash);
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
