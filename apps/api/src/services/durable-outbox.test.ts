import { describe, expect, it } from "vitest";
import { isDeliveryAccepted, retryDelaySeconds, signatureReminderCompletionStatement, signatureReminderStageStatement } from "./durable-outbox";

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

  it("retires an earlier signing link and purges the encrypted token only after fenced delivery completion", () => {
    const statement = signatureReminderCompletionStatement({
      id: "outbox_1", firm_id: "firm_1", operation_kind: "signature_reminder", idempotency_key: "idempotency_1",
      attempt_count: 1, claim_token: "claim_1", payload: { requestId: "request_1", taxpayerEmail: "taxpayer@example.com" },
    }, "provider_1");
    expect(statement.query).toContain("WHERE id = $1 AND status = 'processing' AND claim_token = $3");
    expect(statement.query).toContain("UPDATE signature_access_links sal");
    expect(statement.query).toContain("sal.id <> r.signing_link_id");
    expect(statement.query).toContain("sal.created_at < r.created_at");
    expect(statement.query).toContain("DELETE FROM outbox_delivery_secrets");
    expect(statement.params).toEqual(["outbox_1", "provider_1", "claim_1", "request_1", "taxpayer@example.com"]);
  });

  it("stages a reminder link and its encrypted capability behind one row-locked claim", () => {
    const statement = signatureReminderStageStatement(
      { query: "INSERT", params: ["link_1", "firm_1", "client_1", "request_1", "taxpayer@example.com", null, "hash", "2099-01-01", "system"] },
      { id: "outbox_1", firm_id: "firm_1", operation_kind: "signature_reminder", idempotency_key: "idempotency_1", attempt_count: 1, claim_token: "claim_1", payload: {} },
      { ciphertext: "cipher", iv: "iv" },
    );
    expect(statement.query).toContain("FOR UPDATE");
    expect(statement.query).toContain("status='processing' AND claim_token=$11");
    expect(statement.query).toContain("INSERT INTO outbox_delivery_secrets");
    expect(statement.params?.slice(9)).toEqual(["outbox_1", "claim_1", "cipher", "iv", "v1"]);
  });
});
