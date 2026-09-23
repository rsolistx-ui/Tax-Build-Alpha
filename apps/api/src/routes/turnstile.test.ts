import { describe, it, expect, vi, beforeEach } from "vitest";
import { turnstileRoutes } from "./turnstile";
import { createAuth } from "../auth";
import type { Env } from "../env";

describe("Turnstile", () => {
  const baseEnv: Env = {
    AUTH_DB: {} as any,
    DATABASE_URL: "postgresql://mock",
    RECEIPTS: {} as any,
    BETTER_AUTH_SECRET: "test-secret-at-least-32-chars-long",
    BETTER_AUTH_URL: "http://localhost:8787",
    VAPID_PUBLIC_KEY: "pub",
    VAPID_PRIVATE_KEY: "priv",
  };
  // Minimal D1 stand-in: the Turnstile check runs before any query, so nothing is ever read.
  const stmt: any = { bind: () => stmt, all: async () => ({ results: [] }), run: async () => ({}), first: async () => null, raw: async () => [] };
  const fakeD1 = { prepare: () => stmt, batch: async () => [], exec: async () => ({}), dump: async () => new ArrayBuffer(0) } as any;
  const configured: Env = { ...baseEnv, AUTH_DB: fakeD1, CF_TURNSTILE_SITE_KEY: "0x4AAAAAAAMockSiteKey", CF_TURNSTILE_SECRET_KEY: "0x4AAAAAAAMockSecret" };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns enabled=false when no keys are configured", async () => {
    const res = await turnstileRoutes.request("/config", {}, baseEnv);
    const body = (await res.json()) as any;
    expect(body).toEqual({ enabled: false, siteKey: null });
  });

  it("stays disabled with only a site key, since the server could not verify", async () => {
    const res = await turnstileRoutes.request("/config", {}, { ...baseEnv, CF_TURNSTILE_SITE_KEY: "0x4AAAAAAAMockSiteKey" });
    expect(((await res.json()) as any).enabled).toBe(false);
  });

  it("returns enabled=true and the site key when both keys are configured", async () => {
    const res = await turnstileRoutes.request("/config", {}, configured);
    expect(await res.json()).toEqual({ enabled: true, siteKey: "0x4AAAAAAAMockSiteKey" });
  });

  it("rejects a sign-in request that carries no Turnstile token, before any password check", async () => {
    const res = await createAuth(configured).handler(new Request("http://localhost:8787/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
      body: JSON.stringify({ email: "someone@example.com", password: "whatever-password" }),
    }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/captcha/i);
  });

  it("rejects a sign-in request whose token Cloudflare says is invalid", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] })));
    const res = await createAuth(configured).handler(new Request("http://localhost:8787/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:5173", "x-captcha-response": "forged" },
      body: JSON.stringify({ email: "someone@example.com", password: "whatever-password" }),
    }));
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(res.status).toBe(403);
  });
});
