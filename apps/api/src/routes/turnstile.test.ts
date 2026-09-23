import { describe, it, expect, vi, beforeEach } from "vitest";
import { turnstileRoutes } from "./turnstile";
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
  const configured: Env = { ...baseEnv, CF_TURNSTILE_SITE_KEY: "0x4AAAAAAAMockSiteKey", CF_TURNSTILE_SECRET_KEY: "0x4AAAAAAAMockSecret" };

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
});
