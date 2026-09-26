import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { WaveImportService } from "../services/wave-import";
import { newId } from "../lib/id";
import { buildMigrationProof, type MigrationSourceType } from "../services/migration-proof";
import { detectMapping, mappingIsReady, normalizeBankCsv, previewBankCsv, type BankColumnMapping } from "../services/bank-csv";
import { WaveSafeImportService } from "../services/wave-safe-import";

export const waveImportRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
waveImportRoutes.use("*", requireSession);
waveImportRoutes.use("*", requireActiveBeta);

// ========== Field Mappings ==========

waveImportRoutes.get("/mappings", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const sourceType = c.req.query("sourceType");
  const importService = new WaveImportService(db, c.env.RECEIPTS);
  const mappings = await importService.getSavedMappings(firm.id, sourceType);

  // Include defaults
  const defaultMappings = {
    chart_of_accounts: (await import("../services/wave-import")).WaveImportService.DEFAULT_MAPPINGS.chart_of_accounts,
    customers: (await import("../services/wave-import")).WaveImportService.DEFAULT_MAPPINGS.customers,
    vendors: (await import("../services/wave-import")).WaveImportService.DEFAULT_MAPPINGS.vendors,
    invoices: (await import("../services/wave-import")).WaveImportService.DEFAULT_MAPPINGS.invoices,
    bills: (await import("../services/wave-import")).WaveImportService.DEFAULT_MAPPINGS.bills,
    transactions: (await import("../services/wave-import")).WaveImportService.DEFAULT_MAPPINGS.transactions,
    journal_entries: (await import("../services/wave-import")).WaveImportService.DEFAULT_MAPPINGS.journal_entries,
  };

  return c.json({ mappings, defaults: defaultMappings });
});

waveImportRoutes.post("/mappings", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const body = z.object({
    name: z.string().min(1).max(100),
    sourceType: z.enum(['chart_of_accounts', 'customers', 'vendors', 'invoices', 'bills', 'transactions', 'journal_entries']),
    mapping: z.array(z.object({
      waveColumn: z.string(),
      folioField: z.string(),
      transform: z.enum(['uppercase', 'lowercase', 'trim', 'date_iso', 'number', 'boolean', 'currency']).optional(),
    })).min(1),
    isDefault: z.boolean().default(false),
  }).parse(await c.req.json());

  const importService = new WaveImportService(db, c.env.RECEIPTS);
  const mappingId = await importService.saveMapping(firm.id, {
    name: body.name,
    sourceType: body.sourceType,
    mapping: body.mapping,
    isDefault: body.isDefault,
  });

  return c.json({ mappingId }, 201);
});

waveImportRoutes.get("/mappings/:mappingId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const [mapping] = await db.query<any>(
    `SELECT * FROM wave_field_mappings WHERE id = $1 AND firm_id = $2`,
    [c.req.param("mappingId"), firm.id],
  );
  if (!mapping) return c.json({ error: "Not found" }, 404);

  return c.json({ mapping });
});

waveImportRoutes.delete("/mappings/:mappingId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  await db.query(
    `DELETE FROM wave_field_mappings WHERE id = $1 AND firm_id = $2`,
    [c.req.param("mappingId"), firm.id],
  );

  return c.json({ ok: true });
});

// ========== Import Jobs ==========

const importOptionsSchema = z.object({
  clientId: z.string().optional(),
  sourceType: z.enum(['chart_of_accounts', 'customers', 'vendors', 'invoices', 'bills', 'transactions', 'journal_entries', 'full']),
  fieldMapping: z.array(z.object({
    waveColumn: z.string(),
    folioField: z.string(),
    transform: z.enum(['uppercase', 'lowercase', 'trim', 'date_iso', 'number', 'boolean', 'currency']).optional(),
  })).optional(),
  options: z.object({
    skipDuplicates: z.boolean().default(true),
    dryRun: z.boolean().default(false),
    createMissingClients: z.boolean().default(true),
    defaultClientId: z.string().optional(),
  }).optional(),
});

/**
 * Read-only source assessment for a migration proof run. It deliberately
 * writes nothing: a firm sees missing columns and duplicate candidates before
 * choosing an import path.
 */
waveImportRoutes.post("/proof", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") return c.json({ error: "File required" }, 400);
  if ((file as File).size > 5 * 1024 * 1024) return c.json({ error: "CSV proof files are limited to 5 MB" }, 400);
  const sourceType = z.enum(["transactions", "customers", "vendors", "invoices", "bills", "chart_of_accounts", "prior_year_tax_summary"]).safeParse(formData.get("sourceType"));
  if (!sourceType.success) return c.json({ error: "A supported sourceType is required" }, 400);
  const proof = buildMigrationProof(sourceType.data as MigrationSourceType, await (file as File).text());
  return c.json({ proof });
});

/**
 * The canonical transaction migration path. It intentionally bypasses the
 * legacy job service: that service cannot retrieve its source file and would
 * create a false successful import. Every accepted row is written to the
 * same bank_transactions ledger used by the native CSV importer.
 */
waveImportRoutes.post("/transactions/apply", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const form = await c.req.formData();
  const file = form.get("file");
  const clientId = typeof form.get("clientId") === "string" ? String(form.get("clientId")) : "";
  if (!file || typeof file === "string" || !clientId) return c.json({ error: "Select a client and a CSV file." }, 400);
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);
  if ((file as File).size <= 0 || (file as File).size > 5 * 1024 * 1024 || !(file as File).name.toLowerCase().endsWith(".csv")) {
    return c.json({ error: "Transaction migration requires a non-empty CSV up to 5 MB." }, 400);
  }
  const text = await (file as File).text();
  const proof = buildMigrationProof("transactions", text);
  if (!proof.readyForMappedImport) return c.json({ error: "Fix the migration proof findings before applying transactions.", code: "MIGRATION_PROOF_FAILED", proof }, 409);
  const preview = previewBankCsv(text);
  const mapping = detectMapping(preview.headers);
  if (!mappingIsReady(mapping)) return c.json({ error: "Could not map date, description, and amount columns automatically.", code: "MAPPING_REQUIRED", preview }, 409);
  const [profile] = await db.query<{ default_currency: string | null }>(`SELECT default_currency FROM client_profiles WHERE client_id=$1`, [client.id]);
  const normalized = normalizeBankCsv(text, mapping as BankColumnMapping, profile?.default_currency || "USD");
  if (!normalized.rows.length) return c.json({ error: "The CSV did not include any valid transaction rows.", rowErrors: normalized.errors }, 400);
  const importBatchId = newId("mig");
  const occurrences = new Map<string, number>();
  let insertedCount = 0;
  for (const row of normalized.rows) {
    const base = `${row.date}|${row.description.toLowerCase().replace(/\s+/g, " ").trim()}|${row.amount.toFixed(2)}|${row.currency}`;
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    const fingerprint = await sha256(`${client.id}|${base}|${occurrence}`);
    const [inserted] = await db.query<{ id: string }>(
      `INSERT INTO bank_transactions (id, client_id, txn_date, description, amount, currency, triage, raw_json, import_fingerprint, suggested_disposition)
       VALUES ($1,$2,$3,$4,$5,$6,'unmatched',$7::jsonb,$8,$9)
       ON CONFLICT (client_id, import_fingerprint) WHERE import_fingerprint IS NOT NULL DO NOTHING
       RETURNING id`,
      [newId("txn"), client.id, row.date, row.description, row.amount, row.currency, { importBatchId, source: "csv_migration", sourceFilename: (file as File).name, sourceRow: row.sourceRow, original: row.raw }, fingerprint, row.amount >= 0 ? "business_income" : "business_expense"],
    );
    if (inserted) insertedCount += 1;
  }
  const duplicateCount = normalized.rows.length - insertedCount;
  await db.query(`INSERT INTO audit_events (id, client_id, actor_user_id, action, after_json) VALUES ($1,$2,$3,'migration_csv_transactions_imported',$4)`, [newId("aud"), client.id, c.get("userId"), { importBatchId, filename: (file as File).name, validRows: normalized.rows.length, insertedCount, duplicateCount, rejectedRowCount: normalized.errors.length, rowErrors: normalized.errors.slice(0, 100) }]);
  return c.json({ importBatchId, validRows: normalized.rows.length, insertedCount, duplicateCount, rejectedRowCount: normalized.errors.length, rowErrors: normalized.errors }, 201);
});

/**
 * Applies non-transaction Wave exports through the same proof-first contract.
 * Every imported invoice and bill stays draft; migration never sends mail,
 * posts a journal, or changes a reviewed record.
 */
waveImportRoutes.post("/apply", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const form = await c.req.formData();
  const file = form.get("file");
  const parsed = z.enum(["customers", "vendors", "invoices", "bills", "chart_of_accounts"]).safeParse(form.get("sourceType"));
  const source = z.enum(["wave_csv", "quickbooks_csv"]).safeParse(form.get("source"));
  const defaultClientId = typeof form.get("clientId") === "string" ? String(form.get("clientId")) : null;
  if (!file || typeof file === "string" || !parsed.success) return c.json({ error: "Select a supported source export and CSV file." }, 400);
  if ((file as File).size <= 0 || (file as File).size > 5 * 1024 * 1024 || !(file as File).name.toLowerCase().endsWith(".csv")) {
    return c.json({ error: "Migration requires a non-empty CSV up to 5 MB." }, 400);
  }
  if (defaultClientId && !(await getClient(db, defaultClientId, firm.id))) return c.json({ error: "Client not found" }, 404);
  const csv = await (file as File).text();
  const proof = buildMigrationProof(parsed.data as MigrationSourceType, csv);
  if (!proof.readyForMappedImport) return c.json({ error: "Fix the migration proof findings before applying this export.", code: "MIGRATION_PROOF_FAILED", proof }, 409);
  const result = await new WaveSafeImportService(db).importCsv({
    firmId: firm.id,
    source: source.success ? source.data : "wave_csv",
    sourceType: parsed.data,
    filename: (file as File).name,
    csv,
    defaultClientId,
  });
  await db.query(
    `INSERT INTO audit_events (id, firm_id, actor_user_id, action, after_json) VALUES ($1,$2,$3,'migration_wave_csv_imported',$4)`,
    [newId("aud"), firm.id, c.get("userId"), { filename: (file as File).name, source: source.success ? source.data : "wave_csv", ...result }],
  );
  return c.json({ result }, result.failedRows.length ? 207 : 201);
});

/** Imports the three reference values commonly available from tax-software CSV exports. */
waveImportRoutes.post("/prior-year-tax-summary/apply", async (c) => {
  if (c.get("firmRole") !== "owner" && c.get("firmRole") !== "preparer") return c.json({ error: "Only an owner or preparer can import tax-return summaries." }, 403);
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const form = await c.req.formData();
  const file = form.get("file");
  const clientId = typeof form.get("clientId") === "string" ? String(form.get("clientId")) : "";
  if (!file || typeof file === "string" || !clientId) return c.json({ error: "Select a client and a tax-software CSV export." }, 400);
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);
  if ((file as File).size <= 0 || (file as File).size > 5 * 1024 * 1024 || !(file as File).name.toLowerCase().endsWith(".csv")) return c.json({ error: "Import requires a non-empty CSV up to 5 MB." }, 400);
  const csv = await (file as File).text();
  const proof = buildMigrationProof("prior_year_tax_summary", csv);
  if (!proof.readyForMappedImport) return c.json({ error: "Fix the migration proof findings before applying this summary.", code: "MIGRATION_PROOF_FAILED", proof }, 409);
  const rows = (await import("../services/migration-proof")).parseCsvRows(csv);
  const normalized = rows[0].map((header) => header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " "));
  const value = (values: string[], names: string[]) => values[names.map((name) => normalized.indexOf(name)).find((index) => index >= 0) ?? -1]?.trim() ?? "";
  const money = (raw: string, label: string) => { const amount = Number(raw.replace(/[$,\s]/g, "")); if (!Number.isFinite(amount) || amount < 0) throw new Error(`${label} must be a non-negative number`); return amount; };
  let insertedCount = 0; let duplicateCount = 0; const failedRows: Array<{ row: number; message: string }> = [];
  for (const [offset, values] of rows.slice(1).entries()) {
    try {
      const taxYear = Number(value(values, ["tax year"]));
      if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100) throw new Error("Tax year must be between 2000 and 2100");
      const agi = money(value(values, ["adjusted gross income", "agi"]), "Adjusted gross income");
      const totalTax = money(value(values, ["total tax"]), "Total tax");
      const sourceKey = await sha256(`${client.id}|${taxYear}|${agi.toFixed(2)}|${totalTax.toFixed(2)}`);
      const [seen] = await db.query<{ id: string }>(`SELECT id FROM migration_import_records WHERE firm_id=$1 AND source='tax_software_csv' AND source_type='prior_year_tax_summary' AND source_key=$2`, [firm.id, sourceKey]);
      if (seen) { duplicateCount += 1; continue; }
      const [conflict] = await db.query<{ id: string }>(`SELECT id FROM prior_year_tax_summaries WHERE client_id=$1 AND tax_year=$2`, [client.id, taxYear]);
      if (conflict) throw new Error(`A prior-year summary for ${taxYear} already exists; it was not overwritten`);
      const id = newId("pyt");
      await db.transaction([
        { query: `INSERT INTO prior_year_tax_summaries (id, firm_id, client_id, tax_year, adjusted_gross_income, total_tax, source_filename) VALUES ($1,$2,$3,$4,$5,$6,$7)`, params: [id, firm.id, client.id, taxYear, agi, totalTax, (file as File).name] },
        { query: `INSERT INTO migration_import_records (id, firm_id, source, source_type, source_key, target_type, target_id, source_filename) VALUES ($1,$2,'tax_software_csv','prior_year_tax_summary',$3,'prior_year_tax_summary',$4,$5)`, params: [newId("mir"), firm.id, sourceKey, id, (file as File).name] },
      ]);
      insertedCount += 1;
    } catch (error) { failedRows.push({ row: offset + 2, message: error instanceof Error ? error.message : "Unable to import row" }); }
  }
  await db.query(`INSERT INTO audit_events (id, client_id, actor_user_id, action, after_json) VALUES ($1,$2,$3,'prior_year_tax_summary_imported',$4)`, [newId("aud"), client.id, c.get("userId"), { filename: (file as File).name, insertedCount, duplicateCount, failedRows }]);
  return c.json({ insertedCount, duplicateCount, failedRows }, failedRows.length ? 207 : 201);
});

waveImportRoutes.get("/prior-year-tax-summary/:clientId", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const taxYear = Number(c.req.query("taxYear"));
  if (!Number.isInteger(taxYear)) return c.json({ error: "taxYear is required" }, 400);
  const [summary] = await db.query<{ tax_year: number; adjusted_gross_income: string; total_tax: string; source_filename: string }>(`SELECT tax_year, adjusted_gross_income::text, total_tax::text, source_filename FROM prior_year_tax_summaries WHERE client_id=$1 AND tax_year=$2`, [client.id, taxYear]);
  return c.json({ summary: summary ? { taxYear: summary.tax_year, adjustedGrossIncome: Number(summary.adjusted_gross_income), totalTax: Number(summary.total_tax), sourceFilename: summary.source_filename } : null });
});

/** A migration rollback refuses to delete transactions once a professional has reviewed or changed them. */
waveImportRoutes.post("/transactions/:importBatchId/rollback", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = await c.req.json<{ clientId?: string }>().catch((): { clientId?: string } => ({}));
  if (!body.clientId) return c.json({ error: "clientId is required" }, 400);
  const client = await getClient(db, body.clientId, firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const rows = await db.query<{ id: string; triage: string; disposition: string | null; reviewed_at: string | null; disposition_reviewed_at: string | null }>(
    `SELECT id, triage, disposition, reviewed_at, disposition_reviewed_at FROM bank_transactions WHERE client_id=$1 AND raw_json->>'importBatchId'=$2`,
    [client.id, c.req.param("importBatchId")],
  );
  if (!rows.length) return c.json({ error: "Migration batch not found" }, 404);
  if (rows.some((row) => row.reviewed_at || row.disposition_reviewed_at || row.triage !== "unmatched" || (row.disposition && row.disposition !== "unclassified"))) {
    return c.json({ error: "This migration contains reviewed or changed transactions and cannot be rolled back automatically.", code: "ROLLBACK_REVIEW_REQUIRED" }, 409);
  }
  await db.transaction([
    { query: `DELETE FROM bank_transactions WHERE client_id=$1 AND raw_json->>'importBatchId'=$2`, params: [client.id, c.req.param("importBatchId")] },
    { query: `INSERT INTO audit_events (id, client_id, actor_user_id, action, after_json) VALUES ($1,$2,$3,'migration_csv_transactions_rolled_back',$4)`, params: [newId("aud"), client.id, c.get("userId"), { importBatchId: c.req.param("importBatchId"), deletedTransactions: rows.length }] },
  ]);
  return c.json({ ok: true, deletedTransactions: rows.length });
});

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

waveImportRoutes.post("/jobs", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") return c.json({ error: "File required" }, 400);

  const optionsJson = formData.get("options");
  let options: any = {};
  if (optionsJson && typeof optionsJson === "string") {
    try {
      options = JSON.parse(optionsJson);
    } catch {
      return c.json({ error: "Invalid options JSON" }, 400);
    }
  }

  options = importOptionsSchema.parse(options);

  const importService = new WaveImportService(db, c.env.RECEIPTS);
  const jobId = await importService.createImportJob(firm.id, c.get("userId"), {
    firmId: firm.id,
    clientId: options.clientId,
    sourceType: options.sourceType,
    file: file as File,
    fieldMapping: options.fieldMapping,
    options: options.options,
  });

  return c.json({ jobId }, 201);
});

waveImportRoutes.get("/jobs", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const query = z.object({
    status: z.enum(['pending', 'processing', 'completed', 'failed', 'rolled_back']).optional(),
    limit: z.coerce.number().int().positive().max(100).default(50),
    offset: z.coerce.number().int().nonnegative().default(0),
  }).parse(c.req.query());

  let sql = `SELECT * FROM wave_import_jobs WHERE firm_id = $1`;
  const params: any[] = [firm.id];
  let idx = 2;
  if (query.status) { sql += ` AND status = $${idx++}`; params.push(query.status); }
  sql += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(query.limit, query.offset);

  const rows = await db.query<any>(sql, params);
  const total = await db.query<{ count: string }>(`SELECT COUNT(*) as count FROM wave_import_jobs WHERE firm_id = $1`, [firm.id]);

  return c.json({ jobs: rows, total: parseInt(total[0]?.count ?? '0') });
});

waveImportRoutes.get("/jobs/:jobId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const importService = new (await import("../services/wave-import")).WaveImportService(db, c.env.RECEIPTS);
  const job = await importService.getJob(c.req.param("jobId"));
  if (!job || job.firm_id !== firm.id) return c.json({ error: "Not found" }, 404);

  return c.json({ job });
});

waveImportRoutes.get("/jobs/:jobId/rows", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const importService = new (await import("../services/wave-import")).WaveImportService(db, c.env.RECEIPTS);
  const job = await importService.getJob(c.req.param("jobId"));
  if (!job || job.firm_id !== firm.id) return c.json({ error: "Not found" }, 404);

  const rows = await importService.getJobRows(c.req.param("jobId"));
  return c.json({ rows });
});

waveImportRoutes.post("/jobs/:jobId/process", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const importService = new (await import("../services/wave-import")).WaveImportService(db, c.env.RECEIPTS);
  const job = await importService.getJob(c.req.param("jobId"));
  if (!job || job.firm_id !== firm.id) return c.json({ error: "Not found" }, 404);
  if (job.status !== 'pending') return c.json({ error: "Job already processed or in progress" }, 409);

  // For large imports, this should be queued. For now, process synchronously with timeout handling.
  const importService2 = new (await import("../services/wave-import")).WaveImportService(db, c.env.RECEIPTS);
  const result = await importService2.processImport(c.req.param("jobId"));

  return c.json({ result });
});

waveImportRoutes.post("/jobs/:jobId/rollback", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const importService = new (await import("../services/wave-import")).WaveImportService(db, c.env.RECEIPTS);
  const job = await importService.getJob(c.req.param("jobId"));
  if (!job || job.firm_id !== firm.id) return c.json({ error: "Not found" }, 404);

  await importService.rollbackJob(c.req.param("jobId"));
  return c.json({ ok: true });
});

// ========== Upload & Preview (without processing) ==========

const MAX_PREVIEW_ROWS = 50;

waveImportRoutes.post("/preview", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") return c.json({ error: "File required" }, 400);

  const text = await (file as File).text();
  const lines = text.trim().split('\n');
  if (lines.length < 2) return c.json({ error: "CSV must have header and at least one data row" }, 400);

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const sampleRows = lines.slice(1, Math.min(lines.length, MAX_PREVIEW_ROWS + 1)).map(line => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => row[h] = values[i] ?? '');
    return row;
  });

  return c.json({
    filename: "upload.csv",
    headers,
    totalRows: lines.length - 1,
    sampleRows,
  });
});

function parseCsvLine(line: string): string[] {
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

// ========== Default Mappings ==========

waveImportRoutes.get("/defaults/:sourceType", async (c) => {
  const sourceType = c.req.param("sourceType") as 
    'chart_of_accounts' | 'customers' | 'vendors' | 'invoices' | 'bills' | 'transactions' | 'journal_entries';
  
  const defaults = (await import("../services/wave-import")).WaveImportService.DEFAULT_MAPPINGS;
  const mapping = defaults[sourceType] ?? [];

  return c.json({ mapping, sourceType });
});
