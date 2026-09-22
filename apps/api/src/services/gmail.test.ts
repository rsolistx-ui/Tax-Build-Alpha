import { describe, expect, it, vi, beforeEach } from "vitest";
import { createGmailDraft, sendGmailMessage } from "./gmail";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return atob(padded);
}

describe("Gmail raw-message encoding", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "draft_1", message: {} }) });
  });

  it("uses Gmail-compatible base64url encoding without stripping punctuation from the message", async () => {
    await createGmailDraft("access-token", {
      to: "client@example.com",
      subject: "Receipt needed: August",
      body: "Hi Ana,\n\nPlease upload the receipt for $42.50.",
    });
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    const decoded = decodeBase64Url(request.message.raw);
    expect(decoded).toContain("To: client@example.com");
    expect(decoded).toContain("Subject: Receipt needed: August");
    expect(decoded).toContain("Please upload the receipt for $42.50.");
  });

  it("encodes sent messages with the same safe format", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "msg_1" }) });
    await sendGmailMessage("access-token", { to: "client@example.com", subject: "Question", body: "Can you confirm this?" });
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(decodeBase64Url(request.raw)).toContain("Can you confirm this?");
  });
});
