import type { Db } from "../db";
import { newId } from "../lib/id";
import { parseCsvRows, type MigrationSourceType } from "./migration-proof";

type ImportType = Exclude<MigrationSourceType, "transactions">;

export type SafeImportSummary = {
  sourceType: ImportType;
  totalRows: number;
  createdCount: number;
  skippedCount: number;
  failedRows: Array<{ row: number; message: string }>;
};

function headerKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function rowObject(headers: string[], values: string[]): Record<string, string> {
  return Object.fromEntries(headers.map((header, index) => [headerKey(header), values[index]?.trim() ?? ""]));
}

function value(row: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    const found = row[headerKey(name)];
    if (found) return found;
  }
  return "";
}

function asMoney(input: string): number {
  const parsed = Number(input.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(parsed)) throw new Error("Amount is not a valid number");
  return Math.abs(parsed);
}

function asDate(input: string, field: string): string {
  const normalized = input.trim();
  const match = normalized.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  throw new Error(`${field} must be a valid date`);
}

function accountType(input: string): "asset" | "liability" | "equity" | "revenue" | "expense" {
  const type = input.toLowerCase();
  if (/(income|revenue|sales)/.test(type)) return "revenue";
  if (/(expense|cost)/.test(type)) return "expense";
  if (/(liabil|payable|credit card)/.test(type)) return "liability";
  if (/(equity|retained)/.test(type)) return "equity";
  return "asset";
}

async function stableKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The safe, direct CSV migration service. It deliberately creates only
 * draft operational records and keeps an immutable source-to-target record
 * so a second upload cannot silently duplicate the books.
 */
export class WaveSafeImportService {
  constructor(private readonly db: Db) {}

  async importCsv(input: { firmId: string; source?: "wave_csv" | "quickbooks_csv"; sourceType: ImportType; filename: string; csv: string; defaultClientId?: string | null }): Promise<SafeImportSummary> {
    const source = input.source ?? "wave_csv";
    const rows = parseCsvRows(input.csv);
    const headers = rows[0] ?? [];
    const summary: SafeImportSummary = { sourceType: input.sourceType, totalRows: Math.max(0, rows.length - 1), createdCount: 0, skippedCount: 0, failedRows: [] };

    for (const [offset, values] of rows.slice(1).entries()) {
      const row = offset + 2;
      try {
        const result = await this.importRow({ ...input, source }, rowObject(headers, values));
        if (result === "created") summary.createdCount += 1;
        else summary.skippedCount += 1;
      } catch (error) {
        summary.failedRows.push({ row, message: error instanceof Error ? error.message : "Unable to import this row" });
      }
    }
    return summary;
  }

  private async alreadyImported(firmId: string, source: string, sourceType: ImportType, sourceKey: string): Promise<boolean> {
    const [row] = await this.db.query<{ id: string }>(
      `SELECT id FROM migration_import_records WHERE firm_id=$1 AND source=$2 AND source_type=$3 AND source_key=$4`,
      [firmId, source, sourceType, sourceKey],
    );
    return Boolean(row);
  }

  private async record(input: { firmId: string; source: string; sourceType: ImportType; sourceKey: string; targetType: string; targetId: string; filename: string }): Promise<void> {
    await this.db.query(
      `INSERT INTO migration_import_records (id, firm_id, source, source_type, source_key, target_type, target_id, source_filename)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [newId("mir"), input.firmId, input.source, input.sourceType, input.sourceKey, input.targetType, input.targetId, input.filename],
    );
  }

  private async importRow(input: { firmId: string; source: "wave_csv" | "quickbooks_csv"; sourceType: ImportType; filename: string; defaultClientId?: string | null }, row: Record<string, string>): Promise<"created" | "skipped"> {
    if (input.sourceType === "customers") return this.customer(input, row);
    if (input.sourceType === "vendors") return this.vendor(input, row);
    if (input.sourceType === "chart_of_accounts") return this.account(input, row);
    if (input.sourceType === "invoices") return this.invoice(input, row);
    return this.bill(input, row);
  }

  private async customer(input: { firmId: string; source: string; sourceType: ImportType; filename: string }, row: Record<string, string>): Promise<"created" | "skipped"> {
    const name = value(row, "name", "display name", "customer display name");
    if (!name) throw new Error("Customer name is required");
    const key = await stableKey(`customer:${name.toLowerCase()}`);
    if (await this.alreadyImported(input.firmId, input.source, input.sourceType, key)) return "skipped";
    const [existing] = await this.db.query<{ id: string }>(`SELECT id FROM clients WHERE firm_id=$1 AND LOWER(name)=LOWER($2)`, [input.firmId, name]);
    const id = existing?.id ?? newId("cli");
    if (existing) {
      await this.db.query(`UPDATE clients SET email=COALESCE(NULLIF($1,''),email), phone=COALESCE(NULLIF($2,''),phone), updated_at=NOW() WHERE id=$3 AND firm_id=$4`, [value(row, "email"), value(row, "phone"), id, input.firmId]);
    } else {
      await this.db.query(`INSERT INTO clients (id, firm_id, name, email, phone, legal_name, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())`, [id, input.firmId, name, value(row, "email") || null, value(row, "phone") || null, name]);
    }
    await this.record({ ...input, sourceKey: key, targetType: "client", targetId: id });
    return "created";
  }

  private async vendor(input: { firmId: string; source: string; sourceType: ImportType; filename: string }, row: Record<string, string>): Promise<"created" | "skipped"> {
    const name = value(row, "name", "display name", "vendor display name");
    if (!name) throw new Error("Vendor name is required");
    const key = await stableKey(`vendor:${name.toLowerCase()}`);
    if (await this.alreadyImported(input.firmId, input.source, input.sourceType, key)) return "skipped";
    const [existing] = await this.db.query<{ id: string }>(`SELECT id FROM vendors WHERE firm_id=$1 AND LOWER(name)=LOWER($2)`, [input.firmId, name]);
    const id = existing?.id ?? newId("ven");
    if (existing) {
      await this.db.query(`UPDATE vendors SET email=COALESCE(NULLIF($1,''),email), phone=COALESCE(NULLIF($2,''),phone), address=COALESCE(NULLIF($3,''),address), updated_at=NOW() WHERE id=$4 AND firm_id=$5`, [value(row, "email"), value(row, "phone"), value(row, "address"), id, input.firmId]);
    } else {
      await this.db.query(`INSERT INTO vendors (id, firm_id, name, email, phone, address) VALUES ($1,$2,$3,$4,$5,$6)`, [id, input.firmId, name, value(row, "email") || null, value(row, "phone") || null, value(row, "address") || null]);
    }
    await this.record({ ...input, sourceKey: key, targetType: "vendor", targetId: id });
    return "created";
  }

  private async account(input: { firmId: string; source: string; sourceType: ImportType; filename: string }, row: Record<string, string>): Promise<"created" | "skipped"> {
    const name = value(row, "account name", "name");
    if (!name) throw new Error("Account name is required");
    const key = await stableKey(`account:${name.toLowerCase()}`);
    if (await this.alreadyImported(input.firmId, input.source, input.sourceType, key)) return "skipped";
    const code = value(row, "account number", "code") || `WAVE-${key.slice(0, 8).toUpperCase()}`;
    const type = accountType(value(row, "account type", "type"));
    const [existing] = await this.db.query<{ id: string }>(`SELECT id FROM accounts WHERE firm_id=$1 AND code=$2`, [input.firmId, code]);
    const id = existing?.id ?? newId("acc");
    if (existing) {
      await this.db.query(`UPDATE accounts SET name=$1, type=$2, normal_balance=$3, description=COALESCE(NULLIF($4,''),description), updated_at=NOW() WHERE id=$5 AND firm_id=$6`, [name, type, type === "asset" || type === "expense" ? "debit" : "credit", value(row, "description"), id, input.firmId]);
    } else {
      await this.db.query(`INSERT INTO accounts (id, firm_id, code, name, type, normal_balance, description, is_active, is_system, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,FALSE,0)`, [id, input.firmId, code, name, type, type === "asset" || type === "expense" ? "debit" : "credit", value(row, "description") || null]);
    }
    await this.record({ ...input, sourceKey: key, targetType: "account", targetId: id });
    return "created";
  }

  private async clientForInvoice(firmId: string, name: string): Promise<string> {
    const [existing] = await this.db.query<{ id: string }>(`SELECT id FROM clients WHERE firm_id=$1 AND LOWER(name)=LOWER($2)`, [firmId, name]);
    if (existing) return existing.id;
    const id = newId("cli");
    await this.db.query(`INSERT INTO clients (id, firm_id, name, legal_name, created_at, updated_at) VALUES ($1,$2,$3,$3,NOW(),NOW())`, [id, firmId, name]);
    return id;
  }

  private async invoice(input: { firmId: string; source: string; sourceType: ImportType; filename: string; defaultClientId?: string | null }, row: Record<string, string>): Promise<"created" | "skipped"> {
    const number = value(row, "invoice number", "transaction number", "number", "num");
    const customerName = value(row, "customer name", "customer");
    if (!number || (!customerName && !input.defaultClientId)) throw new Error("Invoice number and customer name are required");
    const key = await stableKey(`invoice:${number.toLowerCase()}`);
    if (await this.alreadyImported(input.firmId, input.source, input.sourceType, key)) return "skipped";
    const [collision] = await this.db.query<{ id: string }>(`SELECT id FROM invoices WHERE firm_id=$1 AND number=$2`, [input.firmId, number]);
    if (collision) throw new Error(`Invoice number ${number} already exists; review it instead of overwriting it`);
    const id = newId("inv");
    const clientId = input.defaultClientId || await this.clientForInvoice(input.firmId, customerName);
    const total = asMoney(value(row, "total", "amount"));
    const issueDate = asDate(value(row, "invoice date", "issue date", "transaction date", "date"), "Invoice date");
    const dueRaw = value(row, "due date");
    const dueDate = dueRaw ? asDate(dueRaw, "Due date") : issueDate;
    await this.db.transaction([
      { query: `INSERT INTO invoices (id, firm_id, client_id, number, status, issue_date, due_date, subtotal, total, notes, memo) VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$7,$8,$9)`, params: [id, input.firmId, clientId, number, issueDate, dueDate, total, value(row, "notes", "memo") || null, "Imported CSV — review before sending"] },
      { query: `INSERT INTO invoice_lines (id, invoice_id, description, quantity, unit_price, sort_order) VALUES ($1,$2,$3,1,$4,0)`, params: [newId("invl"), id, "Migrated invoice total — review line detail", total] },
      { query: `INSERT INTO migration_import_records (id, firm_id, source, source_type, source_key, target_type, target_id, source_filename) VALUES ($1,$2,$3,$4,$5,'invoice',$6,$7)`, params: [newId("mir"), input.firmId, input.source, input.sourceType, key, id, input.filename] },
    ]);
    return "created";
  }

  private async bill(input: { firmId: string; source: string; sourceType: ImportType; filename: string; defaultClientId?: string | null }, row: Record<string, string>): Promise<"created" | "skipped"> {
    const number = value(row, "bill number", "transaction number", "number", "num");
    const vendorName = value(row, "vendor name", "vendor");
    if (!number || !vendorName) throw new Error("Bill number and vendor name are required");
    const key = await stableKey(`bill:${number.toLowerCase()}`);
    if (await this.alreadyImported(input.firmId, input.source, input.sourceType, key)) return "skipped";
    const [collision] = await this.db.query<{ id: string }>(`SELECT id FROM bills WHERE firm_id=$1 AND number=$2`, [input.firmId, number]);
    if (collision) throw new Error(`Bill number ${number} already exists; review it instead of overwriting it`);
    const [vendor] = await this.db.query<{ id: string }>(`SELECT id FROM vendors WHERE firm_id=$1 AND LOWER(name)=LOWER($2)`, [input.firmId, vendorName]);
    const vendorId = vendor?.id ?? newId("ven");
    const issueDate = asDate(value(row, "bill date", "issue date", "transaction date", "date"), "Bill date");
    const dueRaw = value(row, "due date");
    const dueDate = dueRaw ? asDate(dueRaw, "Due date") : null;
    const id = newId("bil");
    await this.db.transaction([
      ...(vendor ? [] : [{ query: `INSERT INTO vendors (id, firm_id, name) VALUES ($1,$2,$3)`, params: [vendorId, input.firmId, vendorName] }]),
      { query: `INSERT INTO bills (id, firm_id, vendor_id, client_id, number, status, issue_date, due_date, total, notes, import_source, import_key) VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$10,$11)`, params: [id, input.firmId, vendorId, input.defaultClientId ?? null, number, issueDate, dueDate, asMoney(value(row, "total", "amount")), value(row, "notes", "memo") || null, input.source, key] },
      { query: `INSERT INTO migration_import_records (id, firm_id, source, source_type, source_key, target_type, target_id, source_filename) VALUES ($1,$2,$3,$4,$5,'bill',$6,$7)`, params: [newId("mir"), input.firmId, input.source, input.sourceType, key, id, input.filename] },
    ]);
    return "created";
  }
}
