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
  const sourceType = z.enum(["transactions", "customers", "vendors", "invoices", "bills", "chart_of_accounts"]).safeParse(formData.get("sourceType"));
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
    sourceType: parsed.data,
    filename: (file as File).name,
    csv,
    defaultClientId,
  });
  await db.query(
    `INSERT INTO audit_events (id, firm_id, actor_user_id, action, after_json) VALUES ($1,$2,$3,'migration_wave_csv_imported',$4)`,
    [newId("aud"), firm.id, c.get("userId"), { filename: (file as File).name, ...result }],
  );
  return c.json({ result }, result.failedRows.length ? 207 : 201);
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
