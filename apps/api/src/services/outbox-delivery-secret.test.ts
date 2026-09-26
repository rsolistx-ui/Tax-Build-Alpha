import { describe, expect, it } from "vitest";
import { decryptOutboxDeliverySecret, encryptOutboxDeliverySecret } from "./outbox-delivery-secret";

describe("outbox delivery secret", () => {
  it("encrypts a signing token and binds it to exactly one operation", async () => {
    const encrypted = await encryptOutboxDeliverySecret("bearer-token", "app-secret", "outbox_1");
    expect(encrypted.ciphertext).not.toContain("bearer-token");
    await expect(decryptOutboxDeliverySecret(encrypted.ciphertext, encrypted.iv, "app-secret", "outbox_1")).resolves.toBe("bearer-token");
    await expect(decryptOutboxDeliverySecret(encrypted.ciphertext, encrypted.iv, "app-secret", "outbox_2")).rejects.toThrow();
  });
});
