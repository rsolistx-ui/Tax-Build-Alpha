import { describe, it, expect, vi, beforeEach } from "vitest";
import { turnstileRoutes } from "./turnstile";
import type { Env } from "../env";

describe("Turnstile Routes", () => {
  const baseEnv: Env = {
    AUTH_DB: {} as any,
    DATABASE_URL: "postgresql://mock",
    RECEIPTS: {} as any,
    BETTER_AUTH_SECRET: "test-secret-at-least-32-chars-long",
    BETTER_AUTH_URL: "http://localhost:8787",
    VAPID_PUBLIC_KEY: "pub",
    VAPID_PRIVATE_KEY: "priv",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns enabled=false when CF_TURNSTILE_SITE_KEY is not configured", async () => {
    const res = await turnstileRoutes.request("/config", {}, baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(false);
    expect(body.siteKey).toBeNull();
  });

  it("returns enabled=true and siteKey when configured", async () => {
    const envWithTurnstile: Env = {
      ...baseEnv,
      CF_TURNSTILE_SITE_KEY: "0x4AAAAAAAMockSiteKey",
    };
    const res = await turnstileRoutes.request("/config", {}, envWithTurnstile);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.siteKey).toBe("0x4AAAAAAAMockSiteKey");
  });

  it("bypasses verification safely when secret key is unconfigured in dev", async () => {
    const res = await turnstileRoutes.request(
      "/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "any-token" }),
      },
      baseEnv,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.simulated).toBe(true);
  });

  it("verifies token successfully against Cloudflare siteverify endpoint", async () => {
    const envWithSecret: Env = {
      ...baseEnv,
      CF_TURNSTILE_SECRET_KEY: "0x4AAAAAAAMockSecretKey",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as any);

    const res = await turnstileRoutes.request(
      "/verify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": "198.51.100.1",
        },
        body: JSON.stringify({ token: "valid-turnstile-token" }),
      },
      envWithSecret,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.simulated).toBe(false);
  });

  it("rejects invalid tokens from Cloudflare with 403 status", async () => {
    const envWithSecret: Env = {
      ...baseEnv,
      CF_TURNSTILE_SECRET_KEY: "0x4AAAAAAAMockSecretKey",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }),
    } as any);

    const res = await turnstileRoutes.request(
      "/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "invalid-or-expired-token" }),
      },
      envWithSecret,
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.codes).toContain("invalid-input-response");
  });
});
