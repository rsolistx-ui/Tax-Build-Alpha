import type { Env } from "./env";

export type DbStatement = {
  query: string;
  params?: unknown[];
};

export type Db = {
  query<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>;
  transaction<T = Record<string, unknown>>(statements: DbStatement[]): Promise<T[][]>;
};

type NeonField = { name: string; dataTypeID: number };
type NeonRawResult = { fields?: NeonField[]; rows?: unknown[][] };

/**
 * Minimal Neon HTTPS client for Cloudflare Workers.
 *
 * We intentionally keep Better Auth on D1 for this milestone. All business,
 * receipt, line-item, audit, correction-memory, and reporting data lives in
 * Neon Postgres. This uses Neon's documented HTTP proxy protocol without
 * adding another runtime dependency to the alpha.
 */
export function createDb(env: Pick<Env, "DATABASE_URL">): Db {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

  const parsed = new URL(env.DATABASE_URL);
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection string");
  }

  const apiHost = parsed.hostname.replace(/^[^.]+\./, "api.");
  const endpoint = `https://${apiHost}/sql`;

  async function request(body: unknown): Promise<unknown> {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Neon-Connection-String": env.DATABASE_URL,
        "Neon-Raw-Text-Output": "true",
        "Neon-Array-Mode": "true",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let detail = await res.text();
      try {
        const parsedError = JSON.parse(detail) as { message?: string };
        detail = parsedError.message || detail;
      } catch {
        // Preserve the raw Neon error body.
      }
      throw new Error(`Neon query failed (${res.status}): ${detail.slice(0, 800)}`);
    }

    return res.json();
  }

  return {
    async query<T>(query: string, params: unknown[] = []): Promise<T[]> {
      const raw = (await request({ query, params: params.map(prepareParam) })) as NeonRawResult;
      return rowsToObjects<T>(raw);
    },

    async transaction<T>(statements: DbStatement[]): Promise<T[][]> {
      if (statements.length === 0) return [];
      const raw = (await request({
        queries: statements.map((statement) => ({
          query: statement.query,
          params: (statement.params ?? []).map(prepareParam),
        })),
      })) as { results?: NeonRawResult[] };

      if (!Array.isArray(raw.results)) {
        throw new Error("Neon transaction returned an unexpected response");
      }
      return raw.results.map((result) => rowsToObjects<T>(result));
    },
  };
}

function prepareParam(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function rowsToObjects<T>(raw: NeonRawResult): T[] {
  const fields = raw.fields ?? [];
  const rows = raw.rows ?? [];
  return rows.map((row) =>
    Object.fromEntries(
      row.map((value, index) => [fields[index]?.name ?? String(index), parseValue(value, fields[index]?.dataTypeID)]),
    ),
  ) as T[];
}

function parseValue(value: unknown, oid?: number): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;

  switch (oid) {
    case 16: // bool
      return value === "t" || value === "true";
    case 20: // int8
    case 21: // int2
    case 23: // int4
    case 700: // float4
    case 701: // float8
    case 1700: // numeric
      return Number(value);
    case 114: // json
    case 3802: // jsonb
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    default:
      return value;
  }
}
