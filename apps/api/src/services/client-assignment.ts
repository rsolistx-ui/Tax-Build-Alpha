import type { Db } from "../db";

/**
 * Client assignment. A staff member without the owner's "sees all clients"
 * switch is scoped: they reach a client only when the owner assigned it to
 * them. requireActiveBeta enforces it for every gated request:
 *
 * - A URL naming a client (any "cli_" path segment, or a "cli_" query value)
 *   passes only when every named client is assigned to the caller.
 * - A URL naming no client passes only when it is listed in
 *   SCOPED_FIRM_WIDE below; those handlers filter their rows with
 *   visibleClientSql. Anything else is refused, so a new firm-wide route
 *   stays closed to scoped staff until it is made assignment-aware.
 *
 * Handlers that take a second client id in the request body check it with
 * isClientVisible.
 */

const SCOPED_FIRM_WIDE: Array<{ method: string; path: RegExp; needsClientQuery?: boolean }> = [
  { method: "GET", path: /^\/api\/me$/ },
  { method: "GET", path: /^\/api\/clients\/?$/ },
  // Creating a client assigns it to its creator (routes/clients.ts).
  { method: "POST", path: /^\/api\/clients\/?$/ },
  { method: "GET", path: /^\/api\/dashboard\/?$/ },
  { method: "GET", path: /^\/api\/documents\/review$/ },
  { method: "PATCH", path: /^\/api\/documents\/review\/[^/]+$/ },
  { method: "GET", path: /^\/api\/work-queue\/?$/ },
  { method: "POST", path: /^\/api\/work-queue\/?$/ },
  { method: "PATCH", path: /^\/api\/work-queue\/[^/]+\/status$/ },
  { method: "GET", path: /^\/api\/agent-tasks\/?$/ },
  { method: "GET", path: /^\/api\/workbench\/[^/]+$/ },
  { method: "GET", path: /^\/api\/firm\/staff$/ },
  // The caller's own push subscriptions; the firm-wide sync feed stays closed.
  { method: "GET", path: /^\/api\/push\/(subscriptions|vapid-public-key)$/ },
  { method: "POST", path: /^\/api\/push\/subscriptions$/ },
  { method: "DELETE", path: /^\/api\/push\/subscriptions$/ },
  // Firm-level workflow templates hold no client data.
  { method: "GET", path: /^\/api\/workflow-templates\/templates$/ },
  // Only for one named client; the firm-wide calendar is not filtered.
  { method: "GET", path: /^\/api\/calendar\/upcoming$/, needsClientQuery: true },
];

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Client ids named in the path or query string. Every client id is "cli_...". */
export function clientIdsInRequest(path: string, query: Record<string, string[]>): { pathIds: string[]; queryIds: string[] } {
  const pathIds = path.split("/").map(decodeSegment).filter((s) => s.startsWith("cli_"));
  const queryIds = Object.values(query).flat().filter((v) => v.startsWith("cli_"));
  return { pathIds, queryIds };
}

/** Whether a scoped staff member may call a URL that names no client in its path. */
export function scopedFirmWideAllowed(method: string, path: string, hasClientQuery: boolean): boolean {
  const m = method.toUpperCase() === "HEAD" ? "GET" : method.toUpperCase();
  return SCOPED_FIRM_WIDE.some((r) => r.method === m && r.path.test(path) && (!r.needsClientQuery || hasClientQuery));
}

/** True when every id is assigned to the user. */
export async function allClientsAssigned(db: Db, userId: string, clientIds: string[]): Promise<boolean> {
  const unique = [...new Set(clientIds)];
  if (unique.length === 0) return true;
  const rows = await db.query<{ client_id: string }>(
    `SELECT client_id FROM client_assignments WHERE user_id = $1 AND client_id IN (SELECT jsonb_array_elements_text($2::jsonb))`,
    [userId, unique],
  );
  return rows.length === unique.length;
}

/**
 * SQL condition, true for a client the caller may see. `param` is the
 * placeholder holding c.get("clientScopeUserId"): NULL for owners and
 * sees-all staff (no filter), the user id for scoped staff.
 */
export function visibleClientSql(column: string, param: string): string {
  return `(${param}::text IS NULL OR ${column} IN (SELECT ca.client_id FROM client_assignments ca WHERE ca.user_id = ${param}::text))`;
}

/** For a client id taken from a request body. Unscoped callers see every client in their firm. */
export async function isClientVisible(db: Db, scopeUserId: string | null | undefined, clientId: string): Promise<boolean> {
  if (!scopeUserId) return true;
  return allClientsAssigned(db, scopeUserId, [clientId]);
}
