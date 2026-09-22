import { describe, expect, it } from "vitest";
import { constantTimeEqual, hasValidTwilioSignature, isPermittedTwilioMediaUrl, twilioSignatureFor } from "./sms-webhook-security";

describe("Twilio webhook security", () => {
  const form = { Body: "receipt", From: "+15555550123", MediaUrl0: "https://api.twilio.com/media/receipt" };

  it("accepts only a signature calculated over the complete sorted payload", async () => {
    const signature = await twilioSignatureFor("test-token", "https://example.test/api/sms/inbound", form);
    await expect(hasValidTwilioSignature({ authToken: "test-token", requestUrl: "https://example.test/api/sms/inbound", signature, form })).resolves.toBe(true);
    await expect(hasValidTwilioSignature({ authToken: "test-token", requestUrl: "https://example.test/api/sms/inbound", signature, form: { ...form, Body: "changed" } })).resolves.toBe(false);
    await expect(hasValidTwilioSignature({ authToken: undefined, requestUrl: "https://example.test/api/sms/inbound", signature, form })).resolves.toBe(false);
  });

  it("does not allow arbitrary media hosts", () => {
    expect(isPermittedTwilioMediaUrl("https://api.twilio.com/2010-04-01/Accounts/x/Media/y")).toBe(true);
    expect(isPermittedTwilioMediaUrl("https://media.twilio.com/receipt")).toBe(true);
    expect(isPermittedTwilioMediaUrl("https://twilio.com.evil.example/receipt")).toBe(false);
    expect(isPermittedTwilioMediaUrl("http://api.twilio.com/receipt")).toBe(false);
  });

  it("compares signature strings without accepting mismatches", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "ab")).toBe(false);
  });
});
