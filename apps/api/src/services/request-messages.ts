import type { Db } from "../db";
import { newId } from "../lib/id";
import { respondToRequest } from "./client-requests";

export type RequestMessageRow = {
  id: string;
  firm_id: string;
  request_id: string;
  client_id: string;
  author_type: "professional" | "client" | "system";
  author_user_id: string | null;
  body: string;
  created_at: string;
};

export async function listRequestMessages(db: Db, requestId: string): Promise<RequestMessageRow[]> {
  return db.query<RequestMessageRow>(
    `SELECT * FROM request_messages WHERE request_id = $1 ORDER BY created_at ASC`,
    [requestId],
  );
}

/**
 * requestId alone is never trusted as the tenant boundary: both clientId
 * and firmId are required parameters and are written into every row, so
 * the runtime INSERT always satisfies request_messages' NOT NULL tenant
 * columns and the migration's composite FKs
 * (request_id, client_id) -> client_requests and (client_id, firm_id) -> clients.
 */
export async function addRequestMessage(
  db: Db,
  requestId: string,
  firmId: string,
  clientId: string,
  authorType: "professional" | "client" | "system",
  authorUserId: string | null,
  body: string,
): Promise<RequestMessageRow> {
  const id = newId("rmsg");
  await db.query(
    `INSERT INTO request_messages (id, firm_id, request_id, client_id, author_type, author_user_id, body) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, firmId, requestId, clientId, authorType, authorUserId, body],
  );

  if (authorType === "client") {
    await respondToRequest(db, requestId, firmId);
  }

  const [row] = await db.query<RequestMessageRow>(`SELECT * FROM request_messages WHERE id = $1`, [id]);
  if (!row) throw new Error("Request message was not created");
  return row;
}
