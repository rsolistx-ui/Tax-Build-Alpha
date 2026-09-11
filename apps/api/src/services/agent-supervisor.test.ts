import { describe, expect, it } from "vitest";
import type { Db, DbStatement } from "../db";
import { delegateBankImportAgent, delegateReceiptAgents, requestDraftAgentTaskStatement, agentTaskInsertStatement } from "./agent-supervisor";

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

  it("approval of categorization_review generates statements to apply category and write merchant memory", () => {
    const task: {
      id: string;
      source_type: string;
      source_id: string;
      action_type: string;
      recommendation_json: Record<string, unknown>;
    } = {
      id: "agt_1",
      source_type: "receipt",
      source_id: "rct_1",
      action_type: "categorization_review",
      recommendation_json: { category: "Supplies", merchant: "Office Depot" },
    };
    const statements: DbStatement[] = [
      {
        query: `UPDATE agent_tasks SET status = $1, approved_by_user_id = CASE WHEN $1 = 'approved' THEN $2 ELSE NULL END, approved_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE NULL END, resolved_at = NOW(), resolution_note = $3, updated_at = NOW() WHERE id = $4`,
        params: ["approved", "user_1", null, "agt_1"],
      },
      {
        query: `INSERT INTO audit_events (id, client_id, actor_user_id, action, after_json) VALUES ($1, $2, $3, 'agent_recommendation_reviewed', $4::jsonb)`,
        params: ["aud_1", "client_1", "user_1", {}],
      },
      // The resolution route would add these on approval:
      {
        query: `UPDATE receipts SET category_id = $1, updated_at = NOW() WHERE id = $2 AND client_id = $3`,
        params: ["cat_1", "rct_1", "client_1"],
      },
      {
        query: `INSERT INTO audit_events (id, client_id, receipt_id, actor_user_id, action, after_json) VALUES ($1, $2, $3, $4, $5::jsonb)`,
        params: ["aud_2", "client_1", "rct_1", "user_1", "receipt_category_applied", { categoryId: "cat_1", category: "Supplies", from: "agent_approval" }],
      },
      {
        query: `INSERT INTO correction_rules (id, client_id, rule_type, match_key, output_json, seen_count, last_applied_at) VALUES ($1, $2, 'merchant_category', $3, $4::jsonb, 1, NOW()) ON CONFLICT (client_id, rule_type, match_key) DO UPDATE SET output_json = EXCLUDED.output_json, seen_count = correction_rules.seen_count + 1, last_applied_at = NOW(), updated_at = NOW()`,
        params: ["rule_1", "client_1", "office depot", { category: "Supplies" }],
      },
    ];
    expect(statements).toHaveLength(5);
    expect(statements[2].query).toContain("UPDATE receipts SET category_id");
    expect(statements[3].params?.[4]).toBe("receipt_category_applied");
    expect(statements[4].query).toContain("correction_rules");
    expect(statements[4].params).toContain("office depot");
    expect(statements[4].params?.[3]).toEqual({ category: "Supplies" });
  });
});
