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

export const waveImportRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
waveImportRoutes.use("*", requireSession);
waveImportRoutes.use("*", requireActiveBeta);

// ========== Field Mappings ==========

waveImportRoutes.get("/mappings", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const sourceType = c.req.query("sourceType");
  const importService = new WaveImportService(db);
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

  const importService = new WaveImportService(db);
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

  const importService = new WaveImportService(db);
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

  const importService = new (await import("../services/wave-import")).WaveImportService(db);
  const job = await importService.getJob(c.req.param("jobId"));
  if (!job || job.firm_id !== firm.id) return c.json({ error: "Not found" }, 404);

  return c.json({ job });
});

waveImportRoutes.get("/jobs/:jobId/rows", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const importService = new (await import("../services/wave-import")).WaveImportService(db);
  const job = await importService.getJob(c.req.param("jobId"));
  if (!job || job.firm_id !== firm.id) return c.json({ error: "Not found" }, 404);

  const rows = await importService.getJobRows(c.req.param("jobId"));
  return c.json({ rows });
});

waveImportRoutes.post("/jobs/:jobId/process", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const importService = new (await import("../services/wave-import")).WaveImportService(db);
  const job = await importService.getJob(c.req.param("jobId"));
  if (!job || job.firm_id !== firm.id) return c.json({ error: "Not found" }, 404);
  if (job.status !== 'pending') return c.json({ error: "Job already processed or in progress" }, 409);

  // For large imports, this should be queued. For now, process synchronously with timeout handling.
  const importService2 = new (await import("../services/wave-import")).WaveImportService(db);
  const result = await importService2.processImport(c.req.param("jobId"));

  return c.json({ result });
});

waveImportRoutes.post("/jobs/:jobId/rollback", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const importService = new (await import("../services/wave-import")).WaveImportService(db);
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

// ========== Saved Mappings Management ==========

waveImportRoutes.get("/mappings", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const sourceType = c.req.query("sourceType");
  let sql = `SELECT * FROM wave_field_mappings WHERE firm_id = $1`;
  const params: any[] = [firm.id];
  if (sourceType) { sql += ` AND source_type = $2`; }
  sql += ` ORDER BY is_default DESC, name`;
  const rows = await db.query<any>(sql, [firm.id]);

  return c.json({ mappings: rows });
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

  const importService = new (await import("../services/wave-import")).WaveImportService(db);
  const mappingId = await new (await import("../services/wave-import")).WaveImportService(db).saveMapping(firm.id, {
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

// ========== Default Mappings ==========

waveImportRoutes.get("/defaults/:sourceType", async (c) => {
  const sourceType = c.req.param("sourceType") as 
    'chart_of_accounts' | 'customers' | 'vendors' | 'invoices' | 'bills' | 'transactions' | 'journal_entries';
  
  const defaults = (await import("../services/wave-import")).WaveImportService.DEFAULT_MAPPINGS;
  const mapping = defaults[sourceType] ?? [];

  return c.json({ mapping, sourceType });
});