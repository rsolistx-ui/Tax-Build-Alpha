import { describe, expect, it } from "vitest";
import type { Db } from "../db";
import { createPortalLink, hashPortalToken, resolvePortalToken, revokePortalLink } from "./portal";

function fakeDb(linkRow: Record<string, unknown> | null): { db: Db; updates: { sql: string; params: unknown[] }[] } {
  const updates: { sql: string; params: unknown[] }[] = [];
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      if (sql.startsWith("UPDATE")) {
        updates.push({ sql, params });
        return [] as T[];
      }
      if (sql.includes("FROM client_portal_links WHERE token_hash")) {
        return (linkRow ? [linkRow] : []) as T[];
      }
      return [] as T[];
    },
    async transaction<T>() {
      return [] as T[][];
    },
  };
  return { db, updates };
}

describe("resolvePortalToken", () => {
  it("resolves firmId and clientId only from the token, never from caller input", async () => {
    const link = {
      id: "plink_1",
      firm_id: "firm_1",
      client_id: "cli_1",
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      revoked_at: null,
    };
    const { db } = fakeDb(link);
    const resolved = await resolvePortalToken(db, "any-token-value");
    expect(resolved).toEqual({ firmId: "firm_1", clientId: "cli_1", linkId: "plink_1" });
  });

  it("returns null for an unknown token", async () => {
    const { db } = fakeDb(null);
    const resolved = await resolvePortalToken(db, "does-not-exist");
    expect(resolved).toBeNull();
  });

  it("returns null for a revoked link even if not yet expired", async () => {
    const link = {
      id: "plink_1", firm_id: "firm_1", client_id: "cli_1",
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      revoked_at: new Date().toISOString(),
    };
    const { db } = fakeDb(link);
    const resolved = await resolvePortalToken(db, "revoked-token");
    expect(resolved).toBeNull();
  });

  it("returns null for an expired link even if not revoked", async () => {
    const link = {
      id: "plink_1", firm_id: "firm_1", client_id: "cli_1",
      expires_at: new Date(Date.now() - 1000).toISOString(),
      revoked_at: null,
    };
    const { db } = fakeDb(link);
    const resolved = await resolvePortalToken(db, "expired-token");
    expect(resolved).toBeNull();
  });
});

describe("createPortalLink and resolvePortalToken round-trip", () => {
  it("hashes the token before storage; the plaintext token is never persisted", async () => {
    let insertParams: unknown[] | undefined;
    const db: Db = {
      async query<T>() {
        return [] as T[];
      },
      async transaction<T>(statements: { query: string; params?: unknown[] }[]) {
        const insert = statements.find((s) => s.query.includes("INSERT INTO client_portal_links"));
        insertParams = insert?.params;
        return statements.map(() => []) as T[][];
      },
    };

    const { token } = await createPortalLink(db, "firm_1", "cli_1", "user_1", 30);
    const expectedHash = await hashPortalToken(token);

    expect(insertParams).not.toContain(token);
    expect(insertParams).toContain(expectedHash);
  });

  it("writes a work_audit_events row in the SAME transaction as the link insert, so issuing a client's access token is never silently unaudited", async () => {
    let statements: { query: string; params?: unknown[] }[] = [];
    const db: Db = {
      async query<T>() {
        return [] as T[];
      },
      async transaction<T>(stmts: { query: string; params?: unknown[] }[]) {
        statements = stmts;
        return stmts.map(() => []) as T[][];
      },
    };

    await createPortalLink(db, "firm_1", "cli_1", "user_1", 30);

    expect(statements).toHaveLength(2);
    const auditInsert = statements.find((s) => s.query.includes("INSERT INTO work_audit_events"));
    expect(auditInsert).toBeDefined();
    expect(auditInsert?.params).toContain("portal_link_created");
    expect(auditInsert?.params).toContain("user_1");
  });
});

describe("revokePortalLink", () => {
  it("scopes the revoke by firm_id and only affects a still-active link", async () => {
    const updates: { sql: string; params: unknown[] }[] = [];
    const db: Db = {
      async query<T>(sql: string, params: unknown[] = []) {
        updates.push({ sql, params });
        return [{ id: "plink_1" }] as T[];
      },
      async transaction<T>() {
        return [] as T[][];
      },
    };
    const revoked = await revokePortalLink(db, "plink_1", "firm_1", "user_1");
    expect(revoked).toBe(true);
    expect(updates[0].sql).toContain("firm_id = $2");
    expect(updates[0].sql).toContain("revoked_at IS NULL");
  });

  it("writes a work_audit_events row atomically with the revoke, in the same statement, so revoking a client's access token is never silently unaudited", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const db: Db = {
      async query<T>(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        return [{ id: "plink_1" }] as T[];
      },
      async transaction<T>() {
        return [] as T[][];
      },
    };

    await revokePortalLink(db, "plink_1", "firm_1", "user_1");

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("INSERT INTO work_audit_events");
    expect(calls[0].sql).toContain("portal_link_revoked");
    expect(calls[0].params).toContain("user_1");
  });

  it("does not write an audit event when there was no active link to revoke (the FROM revoked CTE conditions the insert)", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const db: Db = {
      async query<T>(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        return [] as T[]; // no row revoked
      },
      async transaction<T>() {
        return [] as T[][];
      },
    };

    const revoked = await revokePortalLink(db, "plink_1", "firm_1", "user_1");

    expect(revoked).toBe(false);
    const insertIndex = calls[0].sql.indexOf("INSERT INTO work_audit_events");
    const fromRevokedIndex = calls[0].sql.indexOf("FROM revoked", insertIndex);
    expect(insertIndex).toBeGreaterThan(-1);
    expect(fromRevokedIndex).toBeGreaterThan(insertIndex);
  });
});