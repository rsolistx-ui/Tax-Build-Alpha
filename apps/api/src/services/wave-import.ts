import type { Db } from "../db";
import { newId } from "../lib/id";
import { ensureFirm } from "./firm";
import { getClient } from "./clients";
import { getEngagement } from "./engagements";
import { FolioNativeAccountingProvider } from "./folio-native-accounting";
import { BillingService } from "./billing";
import { StripeService } from "./stripe";
import { createVersion } from "./doc-versioning";
import { sha256Hex } from "./documents";

export interface WaveImportOptions {
  firmId: string;
  clientId?: string | null;
  sourceType: 'chart_of_accounts' | 'customers' | 'vendors' | 'invoices' | 'bills' | 'transactions' | 'journal_entries' | 'full';
  file: File;
  fieldMapping?: Record<string, string>;
  options?: {
    skipDuplicates?: boolean;
    dryRun?: boolean;
    createMissingClients?: boolean;
    defaultClientId?: string;
  };
}

export interface WaveImportResult {
  jobId: string;
  status: 'completed' | 'failed' | 'partial';
  totalRows: number;
  processedRows: number;
  failedRows: number;
  created: Record<string, number>;
  updated: Record<string, number>;
  skipped: Record<string, number>;
  errors: Array<{ row: number; message: string; data?: any }>;
}

export interface WaveFieldMapping {
  waveColumn: string;
  folioField: string;
  transform?: 'uppercase' | 'lowercase' | 'trim' | 'date_iso' | 'number' | 'boolean' | 'currency';
}

export class WaveImportService {
  private db: Db;
  private storage: R2Bucket;
  private accounting: FolioNativeAccountingProvider;
  private billing: BillingService;

  constructor(db: Db, storage: R2Bucket) {
    this.db = db;
    this.storage = storage;
    this.accounting = new FolioNativeAccountingProvider(db);
    this.billing = new BillingService(db);
  }

  // Default field mappings for each Wave export type
  static readonly DEFAULT_MAPPINGS: Record<string, WaveFieldMapping[]> = {
    chart_of_accounts: [
      { waveColumn: 'Account Number', folioField: 'code', transform: 'trim' },
      { waveColumn: 'Account Name', folioField: 'name', transform: 'trim' },
      { waveColumn: 'Account Type', folioField: 'type', transform: 'lowercase' },
      { waveColumn: 'Description', folioField: 'description', transform: 'trim' },
    ],
    customers: [
      { waveColumn: 'Name', folioField: 'name', transform: 'trim' },
      { waveColumn: 'Email', folioField: 'email', transform: 'lowercase' },
      { waveColumn: 'Phone', folioField: 'phone', transform: 'trim' },
      { waveColumn: 'Address', folioField: 'address', transform: 'trim' },
      { waveColumn: 'City', folioField: 'city', transform: 'trim' },
      { waveColumn: 'State', folioField: 'state', transform: 'uppercase' },
      { waveColumn: 'Zip', folioField: 'zip', transform: 'trim' },
      { waveColumn: 'Country', folioField: 'country', transform: 'trim' },
    ],
    vendors: [
      { waveColumn: 'Name', folioField: 'name', transform: 'trim' },
      { waveColumn: 'Email', folioField: 'email', transform: 'lowercase' },
      { waveColumn: 'Phone', folioField: 'phone', transform: 'trim' },
      { waveColumn: 'Address', folioField: 'address', transform: 'trim' },
    ],
    invoices: [
      { waveColumn: 'Invoice Number', folioField: 'number', transform: 'trim' },
      { waveColumn: 'Customer Name', folioField: 'clientName', transform: 'trim' },
      { waveColumn: 'Invoice Date', folioField: 'issueDate', transform: 'date_iso' },
      { waveColumn: 'Due Date', folioField: 'dueDate', transform: 'date_iso' },
      { waveColumn: 'Status', folioField: 'status', transform: 'lowercase' },
      { waveColumn: 'Total', folioField: 'total', transform: 'currency' },
      { waveColumn: 'Currency', folioField: 'currency', transform: 'uppercase' },
      { waveColumn: 'Notes', folioField: 'notes', transform: 'trim' },
    ],
    bills: [
      { waveColumn: 'Bill Number', folioField: 'number', transform: 'trim' },
      { waveColumn: 'Vendor Name', folioField: 'vendorName', transform: 'trim' },
      { waveColumn: 'Bill Date', folioField: 'issueDate', transform: 'date_iso' },
      { waveColumn: 'Due Date', folioField: 'dueDate', transform: 'date_iso' },
      { waveColumn: 'Status', folioField: 'status', transform: 'lowercase' },
      { waveColumn: 'Total', folioField: 'total', transform: 'currency' },
    ],
    transactions: [
      { waveColumn: 'Date', folioField: 'date', transform: 'date_iso' },
      { waveColumn: 'Description', folioField: 'description', transform: 'trim' },
      { waveColumn: 'Amount', folioField: 'amount', transform: 'currency' },
      { waveColumn: 'Category', folioField: 'category', transform: 'trim' },
      { waveColumn: 'Account', folioField: 'accountName', transform: 'trim' },
    ],
    journal_entries: [
      { waveColumn: 'Date', folioField: 'date', transform: 'date_iso' },
      { waveColumn: 'Description', folioField: 'memo', transform: 'trim' },
      { waveColumn: 'Account', folioField: 'accountName', transform: 'trim' },
      { waveColumn: 'Debit', folioField: 'debit', transform: 'currency' },
      { waveColumn: 'Credit', folioField: 'credit', transform: 'currency' },
    ],
  };

  async createImportJob(
    firmId: string,
    userId: string,
    options: WaveImportOptions
  ): Promise<string> {
    const jobId = newId("wvj");
    const totalRows = await this.countCsvRows(options.file);
    const storageKey = `imports/wave/${firmId}/${jobId}/source.csv`;
    const bytes = await options.file.arrayBuffer();
    await this.storage.put(storageKey, bytes, {
      httpMetadata: { contentType: options.file.type || "text/csv" },
      customMetadata: { filename: options.file.name, firmId, jobId, sourceType: options.sourceType },
    });
    
    await this.db.query(
      `INSERT INTO wave_import_jobs (id, firm_id, client_id, source_type, source_filename, source_storage_key, total_rows, field_mapping, options, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')`,
      [
        jobId, firmId, options.clientId ?? null, options.sourceType, options.file.name, storageKey, totalRows,
        JSON.stringify(options.fieldMapping ?? WaveImportService.DEFAULT_MAPPINGS[options.sourceType] ?? []),
        JSON.stringify(options.options ?? {}),
        userId,
      ],
    );
    return jobId;
  }

  async processImport(jobId: string): Promise<WaveImportResult> {
    const [job] = await this.db.query<any>(`SELECT * FROM wave_import_jobs WHERE id = $1`, [jobId]);
    if (!job) throw new Error("Import job not found");

    await this.db.query(
      `UPDATE wave_import_jobs SET status = 'processing', started_at = NOW() WHERE id = $1`,
      [jobId],
    );

    if (!job.source_storage_key) throw new Error("This import was created before durable source storage was enabled. Upload the CSV again to process it.");
    const file = await this.getFileFromStorage(job.source_storage_key, job.source_filename);
    const csvText = await file.text();
    const rows = this.parseCsv(csvText);
    
    const fieldMapping = job.field_mapping as WaveFieldMapping[];
    const options = job.options as any;
    
    let processed = 0;
    let failed = 0;
    const created: Record<string, number> = {};
    const updated: Record<string, number> = {};
    const skipped: Record<string, number> = {};
    const errors: WaveImportResult['errors'] = [];

    await this.db.query(`UPDATE wave_import_jobs SET total_rows = $1 WHERE id = $2`, [rows.length, jobId]);

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 1;
      const row = rows[i];
      
      try {
        await this.db.query(
          `INSERT INTO wave_import_rows (id, job_id, row_number, source_data, status)
           VALUES ($1,$2,$3,$3,'pending')`,
          [newId("wvr"), jobId, rowNum, JSON.stringify(row)],
        );

        const mapped = this.applyFieldMapping(row, job.field_mapping as WaveFieldMapping[]);
        
        await this.db.query(
          `UPDATE wave_import_rows SET mapped_data = $1 WHERE job_id = $2 AND row_number = $3`,
          [JSON.stringify(mapped), jobId, rowNum],
        );

        const result = await this.processRow(job, mapped, job.source_type, job.options as any);
        
        await this.db.query(
          `UPDATE wave_import_rows SET status = $1, target_entity_type = $2, target_entity_id = $3 WHERE job_id = $1 AND row_number = $2`,
          [result.status, result.entityType, result.entityId, jobId, rowNum],
        );

        if (result.status === 'created') {
          created[result.entityType] = (created[result.entityType] || 0) + 1;
        } else if (result.status === 'updated') {
          updated[result.entityType] = (updated[result.entityType] || 0) + 1;
        } else if (result.status === 'skipped') {
          skipped[result.entityType] = (skipped[result.entityType] || 0) + 1;
        }
        processed++;

      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ row: rowNum, message: msg, data: rows[i] });
        
        await this.db.query(
          `UPDATE wave_import_rows SET status = 'failed', error_message = $1 WHERE job_id = $1 AND row_number = $2`,
          [msg, jobId, rowNum],
        );
      }

      await this.db.query(
        `UPDATE wave_import_jobs SET processed_rows = $1, failed_rows = $2 WHERE id = $3`,
        [processed, failed, jobId],
      );
    }

    const status = failed === 0 ? 'completed' : (processed === 0 ? 'failed' : 'partial');
    await this.db.query(
      `UPDATE wave_import_jobs SET status = $1, completed_at = NOW(), 
        result_summary = $2, error_message = $3 WHERE id = $4`,
      [status, JSON.stringify({ created, updated, skipped, errors }), errors.length > 0 ? errors.map(e => e.message).join('; ') : null, jobId],
    );

    return {
      jobId,
      status: status as any,
      totalRows: rows.length,
      processedRows: processed,
      failedRows: failed,
      created,
      updated,
      skipped: {},
      errors,
    };
  }

  private async processRow(
    job: any,
    mapped: Record<string, any>,
    sourceType: string,
    options: any
  ): Promise<{ status: 'created' | 'updated' | 'skipped' | 'failed'; entityType: string; entityId: string }> {
    switch (job.source_type) {
      case 'chart_of_accounts':
        return this.importAccount(job.firm_id, mapped);
      case 'customers':
        return this.importClient(job.firm_id, mapped, options.createMissingClients, options.defaultClientId);
      case 'vendors':
        return this.importVendor(job.firm_id, mapped);
      case 'invoices':
        return this.importInvoice(job.firm_id, mapped, options);
      case 'bills':
        return this.importBill(job.firm_id, mapped, options);
      case 'transactions':
        return this.importTransaction(job.firm_id, mapped, options);
      case 'journal_entries':
        return this.importJournalEntry(job.firm_id, mapped);
      default:
        return { status: 'skipped', entityType: 'unknown', entityId: '' };
    }
  }

  private async importAccount(firmId: string, mapped: Record<string, any>): Promise<{ status: 'created' | 'updated' | 'skipped' | 'failed'; entityType: string; entityId: string }> {
    const code = mapped.code;
    if (!code) throw new Error("Account code required");

    const existing = await this.accounting.getAccountByCode(firmId, code);
    if (existing) {
      await this.accounting.updateAccount(firmId, existing.id, {
        name: mapped.name,
        type: mapped.type,
        subtype: mapped.subtype,
        description: mapped.description,
      });
      return { status: 'updated', entityType: 'account', entityId: existing.id };
    }

    const accountType = (['asset', 'liability', 'equity', 'revenue', 'expense'].includes(String(mapped.type || '').toLowerCase()) 
      ? String(mapped.type).toLowerCase() 
      : 'asset') as 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
    
    const account = await this.accounting.createAccount(firmId, {
      code: String(mapped.code),
      name: String(mapped.name),
      type: accountType,
      subtype: String(mapped.subtype ?? ''),
      description: String(mapped.description ?? ''),
      normalBalance: (accountType === 'asset' || accountType === 'expense') ? 'debit' : 'credit',
      isActive: true,
      sortOrder: 0,
      isSystem: false,
    });
    return { status: 'created', entityType: 'account', entityId: account.id };
  }

  private async importClient(firmId: string, mapped: Record<string, any>, createMissing?: boolean, defaultClientId?: string): Promise<{ status: 'created' | 'updated' | 'skipped' | 'failed'; entityType: string; entityId: string }> {
    const name = mapped.name;
    if (!name) throw new Error("Client name required");

    // Try to find existing client by name
    const existing = await this.db.query<any>(
      `SELECT id FROM clients WHERE firm_id = $1 AND LOWER(name) = LOWER($2)`,
      [firmId, name],
    );

    if (existing[0]) {
      await this.db.query(
        `UPDATE clients SET email = $1, phone = $2, updated_at = NOW() WHERE id = $3`,
        [mapped.email, mapped.phone, existing[0].id],
      );
      return { status: 'updated', entityType: 'client', entityId: existing[0].id };
    }

    if (!createMissing && defaultClientId) {
      return { status: 'skipped', entityType: 'client', entityId: defaultClientId };
    }

    const clientId = newId("cli");
    await this.db.query(
      `INSERT INTO clients (id, firm_id, name, email, phone, legal_name, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())`,
      [clientId, firmId, name, mapped.email, mapped.phone, mapped.legal_name ?? name],
    );
    return { status: 'created', entityType: 'client', entityId: clientId };
  }

  private async importVendor(firmId: string, mapped: Record<string, any>): Promise<{ status: 'created' | 'updated' | 'skipped' | 'failed'; entityType: string; entityId: string }> {
    // Similar to client import but for vendors
    // Would need vendor table - simplified for now
    return { status: 'skipped', entityType: 'vendor', entityId: '' };
  }

  private async importInvoice(firmId: string, mapped: Record<string, any>, options: any): Promise<{ status: 'created' | 'updated' | 'skipped' | 'failed'; entityType: string; entityId: string }> {
    // Find or create client
    let clientId = options.defaultClientId;
    if (!clientId && mapped.clientName) {
      const clientResult = await this.importClient(firmId, { name: mapped.clientName, email: mapped.clientEmail }, true);
      clientId = clientResult.entityId;
    }
    if (!clientId) throw new Error("Client required for invoice");

    const billing = new BillingService(this.db);
    const invoice = await billing.createInvoice(firmId, {
      clientId,
      engagementId: mapped.engagementId ?? null,
      issueDate: mapped.issueDate,
      dueDate: mapped.dueDate,
      lines: mapped.lines ?? [],
      notes: mapped.notes,
      memo: mapped.memo,
    });

    if (mapped.status === 'sent') {
      await this.billing.sendInvoice(invoice.id);
    }
    return { status: 'created', entityType: 'invoice', entityId: invoice.id };
  }

  private async importBill(firmId: string, mapped: Record<string, any>, options: any): Promise<{ status: 'created' | 'updated' | 'skipped' | 'failed'; entityType: string; entityId: string }> {
    // Similar to invoice but for bills (AP)
    return { status: 'skipped', entityType: 'bill', entityId: '' };
  }

  private async importTransaction(firmId: string, mapped: Record<string, any>, options: any): Promise<{ status: 'created' | 'updated' | 'skipped' | 'failed'; entityType: string; entityId: string }> {
    // Import bank transaction - would integrate with bank feed
    return { status: 'skipped', entityType: 'transaction', entityId: '' };
  }

  private async importJournalEntry(firmId: string, mapped: Record<string, any>): Promise<{ status: 'created' | 'updated' | 'skipped' | 'failed'; entityType: string; entityId: string }> {
    const accounting = new FolioNativeAccountingProvider(this.db);
    const journal = await accounting.createJournal(firmId, {
      firmId,
      sourceType: 'wave_import',
      sourceId: mapped.id ?? '',
      memo: mapped.memo,
      periodStart: mapped.date,
      periodEnd: mapped.date,
      status: 'draft',
      lines: [
        { accountId: mapped.accountId, description: mapped.description, debit: mapped.debit || 0, credit: mapped.credit || 0, currency: 'USD', exchangeRate: 1 },
      ],
    });
    return { status: 'created', entityType: 'journal', entityId: journal.id };
  }

  private applyFieldMapping(row: Record<string, string>, mappings: WaveFieldMapping[]): Record<string, any> {
    const result: Record<string, any> = {};
    for (const mapping of mappings) {
      const value = row[mapping.waveColumn];
      if (value === undefined || value === '') continue;
      
      let transformed: any = value;
      switch (mapping.transform) {
        case 'uppercase': transformed = value.toUpperCase(); break;
        case 'lowercase': transformed = value.toLowerCase(); break;
        case 'trim': transformed = value.trim(); break;
        case 'date_iso': transformed = this.parseDate(value); break;
        case 'number': transformed = parseFloat(value.replace(/[^0-9.-]/g, '')); break;
        case 'boolean': transformed = ['true', 'yes', '1', 'y'].includes(value.toLowerCase()); break;
        case 'currency': transformed = parseFloat(value.replace(/[^0-9.-]/g, '')); break;
      }
      result[mapping.folioField] = transformed;
    }
    return result;
  }

  private parseDate(value: string): string {
    // Try multiple date formats
    const formats = [
      /^\d{4}-\d{2}-\d{2}$/,     // YYYY-MM-DD
      /^\d{2}\/\d{2}\/\d{4}$/,   // MM/DD/YYYY
      /^\d{2}-\d{2}-\d{4}$/,     // MM-DD-YYYY
      /^\d{4}\/\d{2}\/\d{2}$/,   // YYYY/MM/DD
    ];
    for (const fmt of formats) {
      if (fmt.test(value)) {
        const parts = value.split(/[\/-]/);
        if (parts[0].length === 4) return value; // Already ISO
        return `${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`;
      }
    }
    return value; // Return as-is, let DB handle
  }

  private parseCsv(text: string): Record<string, string>[] {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    return lines.slice(1).map(line => {
      const values = this.parseCsvLine(line);
      const row: Record<string, string> = {};
      headers.forEach((h, i) => row[h] = values[i] ?? '');
      return row;
    });
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result.map(v => v.trim().replace(/^"|"$/g, ''));
  }

  private async countCsvRows(file: File): Promise<number> {
    const text = await file.text();
    return Math.max(0, text.trim().split('\n').length - 1);
  }

  private async getFileFromStorage(storageKey: string, filename: string): Promise<File> {
    const object = await this.storage.get(storageKey);
    if (!object) throw new Error("The original import file is no longer available. Upload it again to start a new migration.");
    return new File([await object.arrayBuffer()], filename, { type: object.httpMetadata?.contentType || "text/csv" });
  }

  async getJob(jobId: string) {
    const [row] = await this.db.query<any>(`SELECT * FROM wave_import_jobs WHERE id = $1`, [jobId]);
    return row;
  }

  async getJobRows(jobId: string) {
    return this.db.query<any>(`SELECT * FROM wave_import_rows WHERE job_id = $1 ORDER BY row_number`, [jobId]);
  }

  async rollbackJob(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job || job.status !== 'completed') throw new Error("Only completed jobs can be rolled back");

    const rows = await this.db.query<any>(`SELECT * FROM wave_import_rows WHERE job_id = $1`, [jobId]);
    
    for (const row of rows) {
      if (row.target_entity_id && row.target_entity_type) {
        // Attempt to delete created entities - simplified
        await this.db.query(
          `DELETE FROM ${row.target_entity_type}s WHERE id = $1`,
          [row.target_entity_id],
        ).catch(() => {});
      }
    }

    await this.db.query(
      `UPDATE wave_import_jobs SET status = 'rolled_back', rolled_back_at = NOW() WHERE id = $1`,
      [jobId],
    );
  }

  async getSavedMappings(firmId: string, sourceType?: string) {
    let sql = `SELECT * FROM wave_field_mappings WHERE firm_id = $1`;
    const params: any[] = [firmId];
    if (sourceType) {
      sql += ` AND source_type = $2`;
      params.push(sourceType);
    }
    sql += ` ORDER BY is_default DESC, name`;
    return this.db.query<any>(sql, params);
  }

  async saveMapping(firmId: string, input: {
    name: string;
    sourceType: string;
    mapping: WaveFieldMapping[];
    isDefault?: boolean;
  }) {
    const id = newId("wfm");
    await this.db.query(
      `INSERT INTO wave_field_mappings (id, firm_id, name, source_type, mapping, is_default)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (firm_id, source_type, name) DO UPDATE SET
         mapping = EXCLUDED.mapping,
         is_default = EXCLUDED.is_default,
         updated_at = NOW()`,
      [id, firmId, input.name, input.sourceType, JSON.stringify(input.mapping), input.isDefault ?? false],
    );
    return id;
  }

  async getDefaultMapping(sourceType: string): Promise<WaveFieldMapping[]> {
    return WaveImportService.DEFAULT_MAPPINGS[sourceType] ?? [];
  }
}
