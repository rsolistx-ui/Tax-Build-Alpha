import { describe, expect, it } from "vitest";
import {
  decryptOutboxDeliverySecret,
  encryptOutboxDeliverySecret,
  LEGACY_OUTBOX_DELIVERY_KEY_VERSION,
  OUTBOX_DELIVERY_KEY_VERSION,
  outboxDeliveryKeyForVersion,
} from "./outbox-delivery-secret";

describe("outbox delivery secret", () => {
  it("encrypts a signing token and binds it to exactly one operation", async () => {
    const encrypted = await encryptOutboxDeliverySecret("bearer-token", "app-secret", "outbox_1");
    expect(encrypted.ciphertext).not.toContain("bearer-token");
    await expect(decryptOutboxDeliverySecret(encrypted.ciphertext, encrypted.iv, "app-secret", "outbox_1")).resolves.toBe("bearer-token");
    await expect(decryptOutboxDeliverySecret(encrypted.ciphertext, encrypted.iv, "app-secret", "outbox_2")).rejects.toThrow();
  });

  it("uses a dedicated versioned key for new rows and can still read legacy rows", async () => {
    expect(outboxDeliveryKeyForVersion({ BETTER_AUTH_SECRET: "auth", OUTBOX_DELIVERY_KEY_V1: "delivery" }, OUTBOX_DELIVERY_KEY_VERSION)).toBe("delivery");
    expect(outboxDeliveryKeyForVersion({ BETTER_AUTH_SECRET: "auth" }, LEGACY_OUTBOX_DELIVERY_KEY_VERSION)).toBe("auth");
    expect(outboxDeliveryKeyForVersion({ BETTER_AUTH_SECRET: "new-auth", OUTBOX_DELIVERY_LEGACY_AUTH_KEY: "old-auth" }, LEGACY_OUTBOX_DELIVERY_KEY_VERSION)).toBe("old-auth");
    expect(() => outboxDeliveryKeyForVersion({ BETTER_AUTH_SECRET: "auth" }, OUTBOX_DELIVERY_KEY_VERSION)).toThrow("OUTBOX_DELIVERY_KEY_V1");

    const legacy = await encryptOutboxDeliverySecret("old-token", "auth", "outbox_legacy", LEGACY_OUTBOX_DELIVERY_KEY_VERSION);
    await expect(decryptOutboxDeliverySecret(legacy.ciphertext, legacy.iv, "auth", "outbox_legacy", LEGACY_OUTBOX_DELIVERY_KEY_VERSION)).resolves.toBe("old-token");
  });
});
