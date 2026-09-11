import { describe, expect, it } from "vitest";
import type { Db, DbStatement } from "../db";
import {
  delegateBankImportAgent,
  delegateReceiptAgents,
  requestDraftAgentTaskStatement,
  agentTaskInsertStatement,
  agentTaskResolveClaimStatement,
  agentResolveAuditStatement,
  categorizationApprovalStatements,
  normalizeMerchant,
} from "./agent-supervisor";

function fakeDb() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      return [] as T[];
    },
    async transaction<T>() { return [] as T[][]; },
  };
  return { db, calls };
}

describe("event-driven agent supervisor", () => {
  it("delegates upload work with an autonomous extraction record and an approval-gated categorization record", async () => {
    const { db, calls } = fakeDb();
    await delegateReceiptAgents(db, {
      firmId: "firm_1", clientId: "client_1", receiptId: "receipt_1", confidence: 0.91,
      merchant: "Folio Supply", category: "Supplies", total: 64.95, validationStatus: "pass",
    });

    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.sql.includes("ON CONFLICT (client_id, source_type, source_id, agent_name) DO NOTHING"))).toBe(true);
    const autonomy = calls.map((call) => call.params[7]);
    const statuses = calls.map((call) => call.params[8]);
    expect(autonomy).toEqual(expect.arrayContaining(["autonomous", "approval_required"]));
    expect(statuses).toEqual(expect.arrayContaining(["completed", "awaiting_approval"]));
  });

  it("never auto-approves bank triage or a bank disposition", async () => {
    const { db, calls } = fakeDb();
    await delegateBankImportAgent(db, {
      firmId: "firm_1", clientId: "client_1", importBatchId: "import_1", insertedCount: 4, duplicateCount: 1,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].params[7]).toBe("approval_required");
    expect(calls[0].params[8]).toBe("awaiting_approval");
    expect(calls[0].params[11]).toMatchObject({ humanApprovalRequired: true });
  });

  it("records a prepared request draft as completed autonomous work tied to the request", () => {
    const statement = requestDraftAgentTaskStatement({
      firmId: "firm_1", clientId: "client_1", requestId: "creq_1", requestType: "missing_receipt",
      title: "Receipt needed: Acme", relatedBankTransactionId: "btx_1",
    });
    expect(statement.query).toContain("INSERT INTO agent_tasks");
    expect(statement.query).toContain("ON CONFLICT (client_id, source_type, source_id, agent_name) DO NOTHING");
    const params = statement.params as unknown[];
    expect(params[3]).toBe("client_request");
    expect(params[4]).toBe("creq_1");
    expect(params[6]).toBe("request_draft");
    expect(params[7]).toBe("autonomous");
    expect(params[8]).toBe("completed");
    expect(params[11]).toMatchObject({ humanApprovalRequired: false });
    expect(params[10]).toMatchObject({ relatedBankTransactionId: "btx_1", status: "draft" });
  });

  it("approval of categorization_review generates statements via the real builder", () => {
    const task = {
      id: "agt_1",
      source_type: "receipt",
      source_id: "rct_1",
      action_type: "categorization_review",
      recommendation_json: { category: "Supplies", merchant: "Office Depot" },
    };
    const claim = agentTaskResolveClaimStatement({
      taskId: task.id,
      clientId: "client_1",
      firmId: "firm_1",
      newStatus: "approved",
      actorUserId: "user_1",
      note: null,
    });
    expect(claim.query).toContain("UPDATE agent_tasks");
    expect(claim.query).toContain("WHERE id = $4 AND client_id = $5 AND firm_id = $6 AND status = 'awaiting_approval'");
    expect(claim.params).toEqual(["approved", "user_1", null, "agt_1", "client_1", "firm_1"]);

    const audit = agentResolveAuditStatement({
      clientId: "client_1",
      actorUserId: "user_1",
      decision: "approve",
      task,
    });
    expect(audit.query).toContain("INSERT INTO audit_events");
    expect(audit.params?.[3]).toMatchObject({ agentTaskId: "agt_1", decision: "approve", actionType: "categorization_review" });

    const side = categorizationApprovalStatements({
      clientId: "client_1",
      actorUserId: "user_1",
      receiptId: "rct_1",
      merchant: "Office Depot",
      categoryHint: "Supplies",
      categoryId: "cat_1",
    });
    expect(side).toHaveLength(3);
    expect(side[0].query).toContain("UPDATE receipts SET category_id");
    expect(side[0].params).toEqual(["cat_1", "rct_1", "client_1"]);
    expect(side[1].params).toHaveLength(5);
    expect(side[1].params?.[4]).toEqual({ categoryId: "cat_1", category: "Supplies", from: "agent_approval" });
    expect(side[2].query).toContain("correction_rules");
    expect(side[2].params).toContain("office depot");
    expect(side[2].params?.[3]).toEqual({ category: "Supplies" });

    // Dismiss produces no side effects
    const dismissClaim = agentTaskResolveClaimStatement({
      taskId: task.id,
      clientId: "client_1",
      firmId: "firm_1",
      newStatus: "dismissed",
      actorUserId: "user_1",
      note: "dismissed",
    });
    // The params array still contains the actorUserId; the SQL CASE makes it NULL when status != 'approved'
    expect(dismissClaim.params?.[0]).toBe("dismissed");
    expect(dismissClaim.params?.[1]).toBe("user_1");
    expect(dismissClaim.query).toContain("CASE WHEN $1 = 'approved' THEN $2 ELSE NULL END");
  });
});
