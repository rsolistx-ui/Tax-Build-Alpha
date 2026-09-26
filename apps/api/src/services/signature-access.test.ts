import { describe, expect, it } from "vitest";
import { prepareSigningAccessLink } from "./signature-access";

const input = {
  firmId: "firm_1",
  clientId: "client_1",
  requestId: "request_1",
  recipientEmail: "person@example.com",
  issuedByUserId: "user_1",
};

describe("prepareSigningAccessLink", () => {
  it("keeps the existing signing link usable while an outbox replacement awaits delivery", async () => {
    const staged = await prepareSigningAccessLink({ ...input, revokeExisting: false });
    expect(staged.linkId).toMatch(/^siglink_/);
    expect(staged.statements).toHaveLength(1);
    expect(staged.statements[0].query).toContain("INSERT INTO signature_access_links");
  });

  it("continues to revoke predecessors for an explicitly issued replacement link", async () => {
    const immediate = await prepareSigningAccessLink(input);
    expect(immediate.statements).toHaveLength(2);
    expect(immediate.statements[0].query).toContain("status='cancelled'");
    expect(immediate.statements[0].query).toContain("status IN ('pending','processing')");
    expect(immediate.statements[0].query).toContain("UPDATE signature_access_links SET revoked_at");
    expect(immediate.statements[0].query).toContain("NOT EXISTS (\n           SELECT 1 FROM outbox_delivery_secrets");
  });

});
