import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { getActivationReadiness } from "./activation-readiness";

const baseEnv = {
  AUTH_DB: {} as D1Database,
  DATABASE_URL: "postgresql://example",
  RECEIPTS: {} as R2Bucket,
  BETTER_AUTH_SECRET: "a-test-secret-that-is-long-enough",
  BETTER_AUTH_URL: "https://example.test",
  VAPID_PUBLIC_KEY: "public",
  VAPID_PRIVATE_KEY: "private",
} satisfies Env;

describe("getActivationReadiness", () => {
  it("does not claim unconfigured providers are active", () => {
    const capabilities = getActivationReadiness(baseEnv);
    expect(capabilities.find((item) => item.capability === "Telegram operations alerts")?.state).toBe("setup_required");
    expect(capabilities.find((item) => item.capability === "Return e-file submission")?.state).toBe("partner_required");
  });

  it("recognizes a fully configured Turnstile pair only", () => {
    const partial = getActivationReadiness({ ...baseEnv, CF_TURNSTILE_SITE_KEY: "site" });
    const complete = getActivationReadiness({ ...baseEnv, CF_TURNSTILE_SITE_KEY: "site", CF_TURNSTILE_SECRET_KEY: "secret" });
    expect(partial.find((item) => item.capability === "Turnstile bot protection")?.state).toBe("setup_required");
    expect(complete.find((item) => item.capability === "Turnstile bot protection")?.state).toBe("ready");
  });
});
