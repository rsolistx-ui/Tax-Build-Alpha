import { describe, expect, it } from "vitest";
import { loadPublicStatus } from "./public-status";

describe("public status", () => {
  it("never calls an old check operational", async () => {
    const db = { query: async () => [{ checked_at: "2026-09-25T00:00:00.000Z", postgres_ok: true, auth_ok: true, overall_healthy: true }] } as any;
    await expect(loadPublicStatus(db, new Date("2026-09-26T03:00:00.000Z"))).resolves.toMatchObject({
      status: "unknown",
      components: [{ status: "unknown" }, { status: "unknown" }],
    });
  });

  it("reports only the recorded component flags", async () => {
    const db = { query: async () => [{ checked_at: "2026-09-26T12:00:00.000Z", postgres_ok: true, auth_ok: false, overall_healthy: false }] } as any;
    await expect(loadPublicStatus(db, new Date("2026-09-26T12:30:00.000Z"))).resolves.toMatchObject({
      status: "degraded",
      components: [{ name: "Application database", status: "operational" }, { name: "Sign-in service", status: "degraded" }],
      supportTarget: "First human response by the end of the same business day.",
    });
  });
});
