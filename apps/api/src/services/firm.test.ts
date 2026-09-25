import { describe, expect, it } from "vitest";
import type { Db } from "../db";
import { loadAccessEntitlement } from "./firm";

function dbReturning(row: Record<string, unknown>): Db {
  return { query: async () => [row], transaction: async () => [] } as unknown as Db;
}

const own = (status: string) => ({ own_status: status, own_starts: "2026-08-01", own_expires: "2026-09-01" });
const firm = (status: string) => ({ firm_status: status, firm_starts: "2026-09-01", firm_expires: "2027-09-01" });

describe("loadAccessEntitlement", () => {
  it("gives staff the firm's plan even when they hold an older entitlement of their own", async () => {
    const r = await loadAccessEntitlement(dbReturning({ role: "preparer", sees_all_clients: false, ...own("expired"), ...firm("active") }), "u");
    expect(r.entitlement).toMatchObject({ status: "active", source: "firm", expires_at: "2027-09-01" });
  });

  it("still blocks staff whose own entitlement was revoked", async () => {
    const r = await loadAccessEntitlement(dbReturning({ role: "preparer", sees_all_clients: false, ...own("revoked"), ...firm("active") }), "u");
    expect(r.entitlement).toMatchObject({ status: "revoked", source: "own" });
  });

  it("gives an owner their own entitlement", async () => {
    // The query never joins a firm entitlement for owners.
    const r = await loadAccessEntitlement(dbReturning({ role: "owner", sees_all_clients: false, ...own("active"), firm_status: null }), "u");
    expect(r.entitlement).toMatchObject({ status: "active", source: "own" });
  });
});
