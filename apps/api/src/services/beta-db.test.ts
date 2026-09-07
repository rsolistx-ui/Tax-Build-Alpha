import { describe, expect, it } from "vitest";
import { betaAccessEventStatement } from "./beta-db";

describe("betaAccessEventStatement", () => {
  it("returns a plain DbStatement that can be embedded in a db.transaction() array", () => {
    const statement = betaAccessEventStatement({
      action: "beta_invite_redeemed",
      actorUserId: "user-1",
      affectedUserId: "user-1",
      affectedEmail: "person@example.com",
      afterJson: { status: "redeemed" },
    });
    expect(statement.query).toContain("INSERT INTO beta_access_events");
    expect(Array.isArray(statement.params)).toBe(true);
    expect(statement.params).toHaveLength(8);
  });

  it("never embeds a plaintext token in the generated statement", () => {
    const statement = betaAccessEventStatement({
      action: "beta_access_activated",
      actorUserId: "user-1",
      affectedUserId: "user-1",
      affectedEmail: "person@example.com",
      afterJson: { status: "active" },
    });
    const serialized = JSON.stringify(statement.params);
    expect(serialized).not.toMatch(/token/i);
  });

  it("generates a fresh event id on every call", () => {
    const input = {
      action: "beta_invite_created",
      actorUserId: "owner-1",
      affectedUserId: null,
      affectedEmail: "invitee@example.com",
    };
    const a = betaAccessEventStatement(input);
    const b = betaAccessEventStatement(input);
    expect(a.params?.[0]).not.toBe(b.params?.[0]);
  });
});
