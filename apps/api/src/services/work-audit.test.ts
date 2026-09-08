import { describe, expect, it } from "vitest";
import { workAuditEventStatement } from "./work-audit";

describe("workAuditEventStatement", () => {
  it("builds an insert statement into work_audit_events with a fresh id per call", () => {
    const input = {
      firmId: "firm_1",
      entityType: "engagement",
      entityId: "eng_1",
      action: "engagement_created",
      actorUserId: "user_1",
      afterJson: { title: "Q1 close" },
    };
    const a = workAuditEventStatement(input);
    const b = workAuditEventStatement(input);
    expect(a.query).toContain("INSERT INTO work_audit_events");
    expect(a.params?.[0]).not.toBe(b.params?.[0]);
  });

  it("preserves before/after json for a traceable audit chain", () => {
    const statement = workAuditEventStatement({
      firmId: "firm_1",
      entityType: "client_request",
      entityId: "creq_1",
      action: "request_satisfied",
      actorUserId: "user_1",
      beforeJson: { status: "responded" },
      afterJson: { status: "satisfied" },
    });
    expect(statement.params?.[6]).toEqual({ status: "responded" });
    expect(statement.params?.[7]).toEqual({ status: "satisfied" });
    expect(statement.params?.[1]).toBe("firm_1");
    expect(statement.params?.[2]).toBe("client_request");
    expect(statement.params?.[3]).toBe("creq_1");
    expect(statement.params?.[4]).toBe("request_satisfied");
  });
});
