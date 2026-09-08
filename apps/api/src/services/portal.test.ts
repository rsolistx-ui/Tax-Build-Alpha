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
    const captured: { params?: unknown[] } = {};
    const db: Db = {
      async query<T>(sql: string, params: unknown[] = []) {
        if (sql.startsWith("INSERT INTO client_portal_links")) {
          captured.params = params;
          return [] as T[];
        }
        return [] as T[];
      },
      async transaction<T>() {
        return [] as T[][];
      },
    };

    const { token } = await createPortalLink(db, "firm_1", "cli_1", "user_1", 30);
    const expectedHash = await hashPortalToken(token);

    expect(captured.params).not.toContain(token);
    expect(captured.params).toContain(expectedHash);
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
    const revoked = await revokePortalLink(db, "plink_1", "firm_1");
    expect(revoked).toBe(true);
    expect(updates[0].sql).toContain("firm_id = $2");
    expect(updates[0].sql).toContain("revoked_at IS NULL");
  });
});
