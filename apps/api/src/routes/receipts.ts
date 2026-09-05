import { Hono } from "hono";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { newId } from "../lib/id";
import { getLlmProvider } from "../providers/llm";

export const receiptRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

receiptRoutes.use("*", requireSession);

receiptRoutes.get("/:clientId/receipts", async (c) => {
  const firm = await ensureFirm(c.env.DB, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(c.env.DB, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const status = c.req.query("status");
  let q = `SELECT * FROM receipts WHERE client_id = ?`;
  const binds: string[] = [clientId];
  if (status) {
    q += ` AND status = ?`;
    binds.push(status);
  }
  q += ` ORDER BY created_at DESC LIMIT 200`;

  const stmt = c.env.DB.prepare(q);
  const { results } = await stmt.bind(...binds).all();
  return c.json({ receipts: results ?? [] });
});

/**
 * Upload skeleton: multipart file → R2 → receipt row → job stub → LLM extract (inline for alpha).
 * Queues: when JOBS_QUEUE is bound, enqueue instead of inline extract.
 */
receiptRoutes.post("/:clientId/receipts", async (c) => {
  const firm = await ensureFirm(c.env.DB, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(c.env.DB, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const form = await c.req.formData();
  const entry = form.get("file");
  if (!entry || typeof entry === "string") {
    return c.json({ error: "file is required" }, 400);
  }
  const file = entry as {
    name: string;
    type: string;
    size: number;
    arrayBuffer(): Promise<ArrayBuffer>;
  };

  const receiptId = newId("rcp");
  const key = `${firm.id}/${clientId}/${receiptId}/${file.name}`;
  const bytes = await file.arrayBuffer();

  await c.env.RECEIPTS.put(key, bytes, {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
    customMetadata: { filename: file.name, clientId },
  });

  await c.env.DB.prepare(
    `INSERT INTO receipts (id, client_id, r2_key, filename, content_type, size_bytes, status)
     VALUES (?, ?, ?, ?, ?, ?, 'uploaded')`,
  )
    .bind(receiptId, clientId, key, file.name, file.type || null, file.size)
    .run();

  const jobId = newId("job");
  const payload = { receiptId, clientId, r2Key: key };
  await c.env.DB.prepare(
    `INSERT INTO jobs (id, type, payload_json, status) VALUES (?, 'receipt_extract', ?, 'queued')`,
  )
    .bind(jobId, JSON.stringify(payload))
    .run();

  // Prefer queue when bound; otherwise run thin LLM adapter inline (alpha)
  if (c.env.JOBS_QUEUE) {
    await c.env.JOBS_QUEUE.send({ jobId, type: "receipt_extract", ...payload });
    return c.json({ receiptId, jobId, status: "queued" }, 201);
  }

  // Inline stub path
  try {
    await c.env.DB.prepare(`UPDATE jobs SET status = 'running', updated_at = datetime('now') WHERE id = ?`)
      .bind(jobId)
      .run();
    await c.env.DB.prepare(
      `UPDATE receipts SET status = 'extracting', updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(receiptId)
      .run();

    const obj = await c.env.RECEIPTS.get(key);
    if (!obj) throw new Error("R2 object missing after upload");
    const llm = getLlmProvider(c.env);
    const extraction = await llm.extractReceipt({
      bytes: await obj.arrayBuffer(),
      contentType: file.type || "application/octet-stream",
      filename: file.name,
    });

    await c.env.DB.prepare(
      `UPDATE receipts SET
         status = 'review',
         extracted_date = ?,
         extracted_merchant = ?,
         extracted_amount = ?,
         extracted_currency = ?,
         extracted_category = ?,
         confidence = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(
        extraction.date,
        extraction.merchant,
        extraction.amount,
        extraction.currency,
        extraction.category,
        extraction.confidence,
        receiptId,
      )
      .run();

    await c.env.DB.prepare(
      `UPDATE jobs SET status = 'done', result_json = ?, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(JSON.stringify(extraction), jobId)
      .run();

    const receipt = await c.env.DB.prepare(`SELECT * FROM receipts WHERE id = ?`)
      .bind(receiptId)
      .first();

    return c.json({ receipt, jobId, extraction, provider: llm.name }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "extract failed";
    await c.env.DB.prepare(
      `UPDATE jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(message, jobId)
      .run();
    await c.env.DB.prepare(
      `UPDATE receipts SET status = 'failed', updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(receiptId)
      .run();
    return c.json({ receiptId, jobId, error: message }, 500);
  }
});

receiptRoutes.get("/:clientId/review", async (c) => {
  const firm = await ensureFirm(c.env.DB, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(c.env.DB, clientId, firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM receipts WHERE client_id = ? AND status = 'review' ORDER BY created_at DESC`,
  )
    .bind(clientId)
    .all();

  return c.json({ receipts: results ?? [] });
});
