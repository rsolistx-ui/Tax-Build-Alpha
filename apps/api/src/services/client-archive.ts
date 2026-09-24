import { strToU8, zipSync } from "fflate";
import type { Db } from "../db";
import type { Env } from "../env";
import { newId } from "../lib/id";
import { sha256Hex } from "./documents";

/**
 * Clean exit archive: everything Truepost holds for one client in a single ZIP, so a
 * firm can leave at any time (service agreement section 9). Originals, signed records
 * and every table the client's work lives in, with a manifest of SHA-256 fingerprints.
 */
const MAX_BYTES = 80 * 1024 * 1024; // stays well inside Worker memory

export class ArchiveError extends Error {
  constructor(message: string, readonly status: 404 | 413 = 413) { super(message); }
}

function csv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "";
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
}

const safeName = (s: string) => s.replace(/[\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120);

export async function buildClientArchive(db: Db, env: Pick<Env, "RECEIPTS">, firmId: string, clientId: string, actorUserId: string) {
  const [client] = await db.query<{ id: string; name: string; legal_name: string | null }>(`SELECT id, name, legal_name FROM clients WHERE id=$1 AND firm_id=$2`, [clientId, firmId]);
  if (!client) throw new ArchiveError("Client not found.", 404);

  const [receipts, bank, documents, mileage, consents, efile, audit] = await Promise.all([
    db.query(`SELECT * FROM receipts WHERE client_id=$1 ORDER BY created_at`, [clientId]),
    db.query(`SELECT * FROM bank_transactions WHERE client_id=$1 ORDER BY 1`, [clientId]),
    db.query(`SELECT * FROM client_documents WHERE client_id=$1 ORDER BY uploaded_at`, [clientId]),
    db.query(`SELECT * FROM mileage_trips WHERE client_id=$1 AND deleted_at IS NULL ORDER BY trip_date`, [clientId]),
    db.query(`SELECT id, consent_kind, taxpayer_name, signature_method, signed_at, expires_on, revoked_at, revocation_note, text_sha256, consent_text FROM taxpayer_consents WHERE client_id=$1 ORDER BY signed_at`, [clientId]),
    db.query(`SELECT ea.id, ea.form_type, ea.tax_year, ea.taxpayer_role, ea.taxpayer_name, ea.status, ev.method, ev.signed_at, ev.signed_hash, ev.signed_r2_key, ev.retain_until, ev.identity_check
              FROM efile_authorizations ea LEFT JOIN efile_signature_evidence ev ON ev.authorization_id = ea.id WHERE ea.client_id=$1 ORDER BY ea.created_at`, [clientId]),
    db.query(`SELECT * FROM audit_events WHERE client_id=$1 ORDER BY created_at`, [clientId]),
  ]);

  const files: Record<string, Uint8Array> = {};
  let total = 0;
  const add = (path: string, data: Uint8Array) => {
    total += data.byteLength;
    if (total > MAX_BYTES) throw new ArchiveError("This client's files are larger than one download can hold (80 MB). Contact support for a bulk export.");
    files[path] = data;
  };
  const addObject = async (path: string, key: unknown) => {
    if (typeof key !== "string" || !key) return;
    const obj = await env.RECEIPTS.get(key);
    if (obj) add(path, new Uint8Array(await obj.arrayBuffer()));
  };

  for (const r of receipts as Array<Record<string, unknown>>) await addObject(`receipts/${r.id}-${safeName(String(r.filename ?? "receipt"))}`, r.r2_key);
  for (const d of documents as Array<Record<string, unknown>>) await addObject(`documents/${d.id}-${safeName(String(d.filename ?? "document"))}`, d.r2_key);
  for (const e of efile as Array<Record<string, unknown>>) await addObject(`signed-forms/Form-${e.form_type}-${e.tax_year}-${e.taxpayer_role}-${e.id}.pdf`, e.signed_r2_key);
  for (const c of consents as Array<Record<string, unknown>>) add(`consents/${c.id}.txt`, strToU8(`${c.consent_text}\n\nRecord SHA-256: ${c.text_sha256}\n`));

  const tables: Record<string, Array<Record<string, unknown>>> = {
    "data/receipts.csv": receipts as Array<Record<string, unknown>>,
    "data/bank-transactions.csv": bank as Array<Record<string, unknown>>,
    "data/documents.csv": documents as Array<Record<string, unknown>>,
    "data/mileage.csv": mileage as Array<Record<string, unknown>>,
    "data/consents.csv": (consents as Array<Record<string, unknown>>).map(({ consent_text, ...rest }) => rest),
    "data/efile-authorizations.csv": efile as Array<Record<string, unknown>>,
    "data/audit-history.csv": audit as Array<Record<string, unknown>>,
  };
  for (const [path, rows] of Object.entries(tables)) add(path, strToU8(csv(rows)));

  const manifestRows: Array<Record<string, unknown>> = [];
  for (const [path, data] of Object.entries(files)) {
    manifestRows.push({ path, bytes: data.byteLength, sha256: await sha256Hex(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer) });
  }
  add("manifest.csv", strToU8(csv(manifestRows)));
  const name = client.legal_name || client.name;
  add("README.txt", strToU8(`Truepost export for ${name}\nCreated ${new Date().toISOString()}\n\nreceipts/        original receipt files (${receipts.length})\ndocuments/       original client documents (${documents.length})\nsigned-forms/    sealed Form 8879/8878 records\nconsents/        signed client consents, full text\ndata/            spreadsheets of receipts, bank lines, mileage, consents, signatures and audit history\nmanifest.csv     SHA-256 fingerprint of every file, to confirm nothing changed\n`));

  const zip = zipSync(files, { level: 6 });
  await db.query(`INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at) VALUES ($1,$2,$3,'client_archive_exported',$4,$5::jsonb,NOW())`,
    [newId("aud"), firmId, clientId, actorUserId, JSON.stringify({ files: Object.keys(files).length, bytes: zip.byteLength })]);
  return { bytes: zip, filename: `Truepost-export-${safeName(name).replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.zip` };
}
