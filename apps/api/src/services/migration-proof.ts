export type MigrationSourceType =
  | "transactions"
  | "customers"
  | "vendors"
  | "invoices"
  | "bills"
  | "chart_of_accounts";

export type MigrationFinding = {
  row: number | null;
  severity: "error" | "warning";
  message: string;
};

export type MigrationProof = {
  sourceType: MigrationSourceType;
  headers: string[];
  sourceRowCount: number;
  nonBlankRowCount: number;
  duplicateCandidateCount: number;
  findings: MigrationFinding[];
  readyForMappedImport: boolean;
};

const REQUIRED_HEADERS: Record<MigrationSourceType, string[]> = {
  transactions: ["date", "description", "amount"],
  customers: ["name"],
  vendors: ["name"],
  invoices: ["invoice number", "customer name", "invoice date", "total"],
  bills: ["bill number", "vendor name", "bill date", "total"],
  chart_of_accounts: ["account name", "account type"],
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

/** RFC-4180-compatible enough for user-uploaded CSV preview, including quoted commas and escaped quotes. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

export function buildMigrationProof(sourceType: MigrationSourceType, text: string): MigrationProof {
  const rows = parseCsvRows(text);
  const headers = rows[0] ?? [];
  const normalizedHeaders = headers.map(normalizeHeader);
  const findings: MigrationFinding[] = [];
  if (rows.length === 0) {
    return { sourceType, headers: [], sourceRowCount: 0, nonBlankRowCount: 0, duplicateCandidateCount: 0, findings: [{ row: null, severity: "error", message: "The file is empty." }], readyForMappedImport: false };
  }
  if (headers.length === 0) {
    findings.push({ row: 1, severity: "error", message: "A header row is required." });
  }
  for (const required of REQUIRED_HEADERS[sourceType]) {
    if (!normalizedHeaders.includes(required)) {
      findings.push({ row: 1, severity: "error", message: `Missing required column: ${required}.` });
    }
  }

  const duplicateKeys = new Set<string>();
  let duplicateCandidateCount = 0;
  const dataRows = rows.slice(1);
  for (const [offset, values] of dataRows.entries()) {
    const rowNumber = offset + 2;
    const valueFor = (header: string) => values[normalizedHeaders.indexOf(header)]?.trim() ?? "";
    const requiredValues = REQUIRED_HEADERS[sourceType].map(valueFor);
    if (requiredValues.some((value) => !value)) {
      findings.push({ row: rowNumber, severity: "warning", message: "This row is missing one or more required values and will need review or mapping." });
    }
    const fingerprint = requiredValues.map((value) => value.toLowerCase()).join("\u001f");
    if (fingerprint && !requiredValues.some((value) => !value)) {
      if (duplicateKeys.has(fingerprint)) {
        duplicateCandidateCount += 1;
        findings.push({ row: rowNumber, severity: "warning", message: "Possible duplicate of an earlier source row; review before import." });
      }
      duplicateKeys.add(fingerprint);
    }
  }

  return {
    sourceType,
    headers,
    sourceRowCount: dataRows.length,
    nonBlankRowCount: dataRows.length,
    duplicateCandidateCount,
    findings,
    readyForMappedImport: findings.every((finding) => finding.severity !== "error"),
  };
}
