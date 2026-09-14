import type { Db } from "../db";
import { newId } from "../lib/id";

export async function listVersions(db: Db, documentId: string) {
  return db.query<any>(`SELECT * FROM document_versions WHERE document_id=$1 ORDER BY version`, [documentId]);
}

export async function createVersion(db: Db, firmId: string, documentId: string, r2Key: string, userId: string) {
  const rows = await db.query<any>(`SELECT max(version) as m FROM document_versions WHERE document_id=$1`, [documentId]);
  const version = Number(rows[0]?.m ?? 0) + 1;
  const id = newId("docv");
  const [row] = await db.query<any>(`INSERT INTO document_versions (id,firm_id,document_id,version,r2_key,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [id, firmId, documentId, version, r2Key, userId]);
  return row;
}

export async function listSignatureRequests(db: Db, firmId: string, clientId: string) {
  return db.query<any>(`SELECT * FROM signature_requests WHERE firm_id=$1 AND client_id=$2 ORDER BY created_at DESC`, [firmId, clientId]);
}

export async function createSignatureRequest(db: Db, firmId: string, clientId: string, input: { engagementId?: string; documentId?: string; formType: string; recipients: any[] }) {
  const id = newId("sigr");
  const [row] = await db.query<any>(`INSERT INTO signature_requests (id,firm_id,client_id,engagement_id,document_id,form_type,recipients) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`, [id, firmId, clientId, input.engagementId ?? null, input.documentId ?? null, input.formType, JSON.stringify(input.recipients)]);
  return row;
}
