import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { requireOwner } from "../middleware/beta";
import { adminUnlockRoutes } from "../routes/admin-unlock";
import { ADMIN_UNLOCK_COOKIE, issueAdminUnlock, isValidAdminUnlock } from "./admin-unlock";

vi.mock("../middleware/session", () => ({
  requireSession: async (c: any, next: () => Promise<void>) => {
    c.set("userEmail", "owner@example.com");
    c.set("userId", "user_1");
    await next();
  },
}));

const MASTER = "a".repeat(64);
const env = {
  OWNER_EMAIL: "owner@example.com",
  ADMIN_MASTER_TOKEN: MASTER,
  BETTER_AUTH_SECRET: "test-secret-at-least-32-chars-long",
  BETTER_AUTH_URL: "https://example.test",
  CF_TURNSTILE_SITE_KEY: "0x4AAAAAAAMockSiteKey",
  CF_TURNSTILE_SECRET_KEY: "0x4AAAAAAAMockSecret",
} as Env;

function ownerApp() {
  const app = new Hono<{ Bindings: Env; Variables: { userEmail: string; userId: string; userName: string } }>();
  app.use("*", async (c, next) => {
    c.set("userEmail", "owner@example.com");
    c.set("userId", "user_1");
    c.set("userName", "Owner");
    await next();
  });
  app.get("/admin", requireOwner, (c) => c.json({ ok: true }));
  return app;
}

afterEach(() => vi.restoreAllMocks());

describe("admin panel pass", () => {
  it("is valid only for the user it was issued to, and only until it expires", async () => {
    const now = Date.UTC(2026, 8, 23);
    const pass = await issueAdminUnlock(env, "user_1", now);
    expect(await isValidAdminUnlock(env, "user_1", pass, now)).toBe(true);
    expect(await isValidAdminUnlock(env, "user_2", pass, now)).toBe(false);
    expect(await isValidAdminUnlock(env, "user_1", pass, now + 9 * 60 * 60 * 1000)).toBe(false);
    expect(await isValidAdminUnlock(env, "user_1", pass.replace(/.$/, (ch) => (ch === "0" ? "1" : "0")), now)).toBe(false);
  });
});

describe("requireOwner with Turnstile configured", () => {
  it("refuses the owner session and master token without the pass", async () => {
    const res = await ownerApp().request("https://example.test/admin", { headers: { "x-admin-token": MASTER } }, env);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "ADMIN_UNLOCK_REQUIRED" });
  });

  it("allows the owner once the pass cookie is present", async () => {
    const pass = await issueAdminUnlock(env, "user_1");
    const res = await ownerApp().request("https://example.test/admin", { headers: { "x-admin-token": MASTER, Cookie: `${ADMIN_UNLOCK_COOKIE}=${pass}` } }, env);
    expect(res.status).toBe(200);
  });

  it("does not ask for the pass when Turnstile is not configured", async () => {
    const res = await ownerApp().request("https://example.test/admin", { headers: { "x-admin-token": MASTER } }, { ...env, CF_TURNSTILE_SECRET_KEY: undefined });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/admin-unlock", () => {
  const post = (body: unknown, token = MASTER) =>
    adminUnlockRoutes.request("/", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-token": token }, body: JSON.stringify(body) }, env);

  it("requires the master token", async () => {
    const res = await post({ turnstileToken: "t" }, "b".repeat(64));
    expect(res.status).toBe(403);
  });

  it("requires a Turnstile token", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
  });

  it("refuses when Cloudflare rejects the check", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: false })));
    const res = await post({ turnstileToken: "forged" });
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("issues an HttpOnly pass when Cloudflare accepts the check", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: true })));
    const res = await post({ turnstileToken: "good" });
    expect(res.status).toBe(200);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("challenges.cloudflare.com/turnstile/v0/siteverify");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${ADMIN_UNLOCK_COOKIE}=`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });
});
