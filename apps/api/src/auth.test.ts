import { describe, expect, it, vi } from "vitest";
import { sendSignInCode } from "./auth";
import type { Env } from "./env";

const env = { RESEND_API_KEY: "k", SENDER_EMAIL: "Truepost <notifications@example.org>", REPLY_TO_EMAIL: "owner@example.org" } as Env;

describe("sendSignInCode", () => {
  it("emails the 6-digit code to the account address", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await sendSignInCode(env, "preparer@firm.test", "482913", { fetch })).toBe(true);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.to).toEqual(["preparer@firm.test"]);
    expect(body.subject).toContain("482913");
    expect(body.text).toContain("expires in 10 minutes");
  });

  it("never sends to the reserved example.com test domain", async () => {
    const fetch = vi.fn();
    expect(await sendSignInCode(env, "folio-smoke-abc@example.com", "123456", { fetch })).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
