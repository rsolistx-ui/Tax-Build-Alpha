import { describe, expect, it } from "vitest";
import { isDeliveryAccepted, retryDelaySeconds } from "./durable-outbox";

describe("durable outbox retry schedule", () => {
  it("backs off predictably and caps a retry at one hour", () => {
    expect(retryDelaySeconds(1)).toBe(30);
    expect(retryDelaySeconds(2)).toBe(60);
    expect(retryDelaySeconds(3)).toBe(120);
    expect(retryDelaySeconds(20)).toBe(3600);
  });

  it("never treats a local mock as a delivered customer notification", () => {
    expect(isDeliveryAccepted({ success: true, delivered: false, simulated: true })).toBe(false);
    expect(isDeliveryAccepted({ success: true, delivered: true, simulated: false })).toBe(true);
  });
});
