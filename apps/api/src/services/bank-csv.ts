export type BankColumnMapping = {
  date: string;
  description: string;
  amount?: string | null;
  debit?: string | null;
  credit?: string | null;
  currency?: string | null;
};

export type BankCsvPreview = {
  headers: string[];
  mapping: BankColumnMapping;
  ready: boolean;
  sampleRows: Record<string, string>[];
  rowCount: number;
};

export type NormalizedBankRow = {
  sourceRow: number;
  date: string;
  description: string;
  amount: number;
  currency: string;
  raw: Record<string, string>;
};

export type BankCsvNormalization = {
  rows: NormalizedBankRow[];
  errors: Array<{ sourceRow: number; message: string }>;
};

const HEADER_ALIASES = {
  date: ["date", "transactiondate", "posteddate", "postingdate", "transdate", "effectivedate"],
  description: ["description", "memo", "details", "transactiondescription", "name", "merchant", "payee"],
  amount: ["amount", "transactionamount", "amt", "netamount"],
  debit: ["debit", "withdrawal", "withdrawals", "debitamount", "moneyout", "outflow"],
  credit: ["credit", "deposit", "deposits", "creditamount", "moneyin", "inflow"],
  currency: ["currency", "curr", "currencycode"],
} as const;

export function previewBankCsv(text: string): BankCsvPreview {
  const parsed = parseCsv(text);
  if (parsed.length < 2) throw new Error("CSV must include a header row and at least one transaction row");
  const headers = parsed[0].map((header) => header.trim());
  if (headers.some((header) => !header)) throw new Error("CSV contains an empty column header");

  const mapping = detectMapping(headers);
  const sampleRows = parsed.slice(1, 6).map((row) => rowToObject(headers, row));
  return {
    headers,
    mapping,
    ready: mappingIsReady(mapping),
    sampleRows,
    rowCount: parsed.length - 1,
  };
}

export function normalizeBankCsv(text: string, mapping: BankColumnMapping, defaultCurrency = "USD"): BankCsvNormalization {
  const parsed = parseCsv(text);
  if (parsed.length < 2) throw new Error("CSV must include a header row and at least one transaction row");
  const headers = parsed[0].map((header) => header.trim());
  validateMapping(headers, mapping);

  const rows: NormalizedBankRow[] = [];
  const errors: Array<{ sourceRow: number; message: string }> = [];

  parsed.slice(1).forEach((values, index) => {
    const sourceRow = index + 2;
    if (values.every((value) => !value.trim())) return;
    const raw = rowToObject(headers, values);
    try {
      const date = parseDate(raw[mapping.date]);
      const description = String(raw[mapping.description] ?? "").trim();
      if (!description) throw new Error("description is empty");

      let amount: number | null = null;
      if (mapping.amount) {
        amount = parseMoney(raw[mapping.amount]);
      } else {
        const debit = mapping.debit ? parseMoney(raw[mapping.debit]) : null;
        const credit = mapping.credit ? parseMoney(raw[mapping.credit]) : null;
        if (debit === null && credit === null) throw new Error("amount is empty");
        amount = (credit ?? 0) - Math.abs(debit ?? 0);
      }
      if (amount === null || !Number.isFinite(amount)) throw new Error("amount is invalid");
      if (Math.abs(amount) > 999999999999.99) throw new Error("amount is outside the supported range");

      const currencyRaw = mapping.currency ? String(raw[mapping.currency] ?? "").trim() : "";
      const currency = (currencyRaw || defaultCurrency || "USD").toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("currency must be a 3 letter code");

      rows.push({ sourceRow, date, description, amount: roundMoney(amount), currency, raw });
    } catch (error) {
      errors.push({ sourceRow, message: error instanceof Error ? error.message : "invalid row" });
    }
  });

  return { rows, errors };
}

export function detectMapping(headers: string[]): BankColumnMapping {
  const normalized = new Map(headers.map((header) => [normalizeHeader(header), header]));
  const find = (aliases: readonly string[]) => aliases.map((alias) => normalized.get(alias)).find(Boolean) ?? null;

  return {
    date: find(HEADER_ALIASES.date) ?? "",
    description: find(HEADER_ALIASES.description) ?? "",
    amount: find(HEADER_ALIASES.amount),
    debit: find(HEADER_ALIASES.debit),
    credit: find(HEADER_ALIASES.credit),
    currency: find(HEADER_ALIASES.currency),
  };
}

export function mappingIsReady(mapping: BankColumnMapping): boolean {
  return Boolean(mapping.date && mapping.description && (mapping.amount || mapping.debit || mapping.credit));
}

function validateMapping(headers: string[], mapping: BankColumnMapping): void {
  if (!mappingIsReady(mapping)) {
    throw new Error("Map date, description, and either amount or debit/credit before importing");
  }
  const available = new Set(headers);
  const selected = [mapping.date, mapping.description, mapping.amount, mapping.debit, mapping.credit, mapping.currency]
    .filter((value): value is string => Boolean(value));
  for (const column of selected) {
    if (!available.has(column)) throw new Error(`Mapped column does not exist: ${column}`);
  }
}

function rowToObject(headers: string[], values: string[]): Record<string, string> {
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/^\uFEFF/, "").replace(/[^a-z0-9]/g, "");
}

function parseMoney(value: string | undefined): number | null {
  const input = String(value ?? "").trim();
  if (!input) return null;
  const negativeByParens = /^\(.*\)$/.test(input);
  const cleaned = input.replace(/[,$\s]/g, "").replace(/[()]/g, "");
  if (!/^[-+]?\d+(\.\d+)?$/.test(cleaned)) throw new Error(`invalid amount '${input}'`);
  const parsed = Number(cleaned);
  return negativeByParens ? -Math.abs(parsed) : parsed;
}

function parseDate(value: string | undefined): string {
  const input = String(value ?? "").trim();
  if (!input) throw new Error("date is empty");

  const iso = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]), input);

  const us = input.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  if (us) {
    let year = Number(us[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return validDate(year, Number(us[1]), Number(us[2]), input);
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) throw new Error(`invalid date '${input}'`);
  return parsed.toISOString().slice(0, 10);
}

function validDate(year: number, month: number, day: number, original: string): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`invalid date '${original}'`);
  }
  return date.toISOString().slice(0, 10);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows.filter((values) => values.some((value) => value.trim().length > 0));
}
