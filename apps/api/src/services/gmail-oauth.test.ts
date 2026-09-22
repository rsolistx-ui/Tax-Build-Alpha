import { describe, expect, it } from "vitest";
import { buildGmailOAuthUrl, decryptGmailRefreshToken, encryptGmailRefreshToken } from "./gmail-oauth";

function key(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

describe("Gmail OAuth security", () => {
  it("encrypts refresh tokens with a distinct random IV and decrypts only with the same key", async () => {
    const secret = key();
    const first = await encryptGmailRefreshToken("refresh-token-value", secret);
    const second = await encryptGmailRefreshToken("refresh-token-value", secret);
    expect(first.ciphertext).not.toBe("refresh-token-value");
    expect(first.iv).not.toBe(second.iv);
    await expect(decryptGmailRefreshToken(first.ciphertext, first.iv, secret)).resolves.toBe("refresh-token-value");
    await expect(decryptGmailRefreshToken(first.ciphertext, first.iv, key())).rejects.toThrow();
  });

  it("requests only read, compose, and send Gmail scopes", () => {
    const url = new URL(buildGmailOAuthUrl({ clientId: "client", redirectUri: "https://app.example/api/gmail/oauth/callback", state: "state" }));
    const scopes = url.searchParams.get("scope") ?? "";
    expect(scopes).toContain("gmail.readonly");
    expect(scopes).toContain("gmail.compose");
    expect(scopes).toContain("gmail.send");
    expect(scopes).not.toContain("gmail.modify");
    expect(scopes).not.toContain("gmail.settings");
  });
});
