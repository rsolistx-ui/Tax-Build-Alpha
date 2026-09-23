import { describe, expect, it, vi } from "vitest";
import { sendEmail } from "./signature-reminders";

const message = { to: "client@example.com", fromName: "Firm", subject: "Hi", text: "Hi", html: "<p>Hi</p>" };

describe("sendEmail", () => {
  it("sends replies to REPLY_TO_EMAIL when it is set", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await sendEmail({ RESEND_API_KEY: "k", SENDER_EMAIL: "Truepost <notifications@example.com>", REPLY_TO_EMAIL: "owner@example.com" }, message, { fetch });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.reply_to).toBe("owner@example.com");
    expect(body.from).toBe("Truepost <notifications@example.com>");
  });

  it("omits reply_to when it is not set", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await sendEmail({ RESEND_API_KEY: "k" }, message, { fetch });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty("reply_to");
  });
});
