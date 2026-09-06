import { describe, expect, it } from "vitest";
import app from "./index";
import type { Env } from "./env";

const testEnv: Env = {
  AUTH_DB: {} as unknown as Env["AUTH_DB"],
  DATABASE_URL: "postgresql://user:pass@localhost/db",
  RECEIPTS: {} as unknown as Env["RECEIPTS"],
  BETTER_AUTH_SECRET: "test-secret-at-least-32-chars-long!!",
  BETTER_AUTH_URL: "https://folio-api.rsolistx.workers.dev",
};

describe("security headers", () => {
  it("applies a locked-down CSP, nosniff, referrer policy, HSTS, and frame denial to every response", async () => {
    const res = await app.request("/api/health", {}, testEnv);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).toBeTruthy();
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
  });

  it("does not use a wildcard CSP source", async () => {
    const res = await app.request("/api/health", {}, testEnv);
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).not.toContain("*");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("applies security headers even to a 404 response", async () => {
    const res = await app.request("/api/nonexistent-route", {}, testEnv);
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("production error responses", () => {
  it("returns a safe generic body when session lookup fails, never the raw adapter/database error", async () => {
    // The mock AUTH_DB binding is not a real D1 database, so Better Auth's
    // session lookup throws internally. This is exactly the scenario item 9
    // guards against: the response must stay generic regardless of what
    // broke server-side.
    const res = await app.request("/api/clients", {}, testEnv);
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("postgresql://");
    expect(serialized).not.toContain("adapter");
    expect(serialized).not.toContain("BetterAuthError");
    expect(body).toMatchObject({ error: "Internal server error", code: "INTERNAL_ERROR" });
    expect(typeof body.requestId).toBe("string");
  });
});
