import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { requireOwner } from "./beta";

function appFor(input: { email: string; token?: string; master?: string }) {
  const app = new Hono<{ Bindings: Env; Variables: { userEmail: string; userId: string; userName: string } }>();
  app.use("*", async (c, next) => {
    c.set("userEmail", input.email);
    c.set("userId", "user_1");
    c.set("userName", "Test Owner");
    await next();
  });
  app.get("/", requireOwner, (c) => c.json({ ok: true }));
  return app.request("https://example.test/", { headers: input.token ? { "x-admin-token": input.token } : {} }, {
    OWNER_EMAIL: "owner@example.com",
    ADMIN_MASTER_TOKEN: input.master,
  } as Env);
}

describe("requireOwner", () => {
  it("does not let a valid master token elevate a non-owner session", async () => {
    const response = await appFor({ email: "member@example.com", token: "a".repeat(64), master: "a".repeat(64) });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "OWNER_REQUIRED" });
  });

  it("requires both the configured owner session and the token", async () => {
    const denied = await appFor({ email: "owner@example.com", master: "a".repeat(64) });
    expect(denied.status).toBe(403);
    const allowed = await appFor({ email: "owner@example.com", token: "a".repeat(64), master: "a".repeat(64) });
    expect(allowed.status).toBe(200);
  });
});
