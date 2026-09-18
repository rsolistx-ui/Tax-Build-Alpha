import { describe, expect, it } from "vitest";
import type { Db } from "../db";
import { AdminRulesService } from "./admin-rules";
import type { Env } from "../env";

type Route = { match: RegExp; rows: Record<string, unknown>[] };

function fakeDb(routes: Route[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      for (const route of routes) {
        if (route.match.test(sql)) return route.rows as T[];
      }
      return [] as T[];
    },
    async transaction<T>() {
      return [] as T[][];
    },
  };
  return { db, calls };
}

const ruleRow = {
  id: "rule_1",
  firmId: "firm_1",
  clientId: null,
  title: "IRS Schedule C Guidelines",
  ruleType: "categorization",
  markdownContent: "# Schedule C\nAll office supplies under $2500 are Part II Line 22.",
  isActive: true,
  priority: 10,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
};

describe("AdminRulesService", () => {
  it("lists active firm rules in priority order", async () => {
    const { db } = fakeDb([
      { match: /FROM firm_rules/i, rows: [ruleRow] },
    ]);
    const service = new AdminRulesService(db);
    const rules = await service.listRules("firm_1");
    expect(rules).toHaveLength(1);
    expect(rules[0].title).toBe("IRS Schedule C Guidelines");
    expect(rules[0].priority).toBe(10);
  });

  it("creates a new markdown rule with proper defaults", async () => {
    const { db, calls } = fakeDb([
      { match: /INSERT INTO firm_rules/i, rows: [{ ...ruleRow, id: "rule_new" }] },
    ]);
    const service = new AdminRulesService(db);
    const created = await service.createRule("firm_1", {
      title: "Meals 50% Limitation",
      markdownContent: "All client dining is 50% deductible under Part II Line 24b.",
      ruleType: "tax_deduction",
    });

    expect(created.id).toBe("rule_new");
    expect(calls[0].sql).toContain("INSERT INTO firm_rules");
    expect(calls[0].params[1]).toBe("firm_1");
    expect(calls[0].params[3]).toBe("Meals 50% Limitation");
  });

  it("compiles active rules into a combined markdown document", async () => {
    const { db } = fakeDb([
      {
        match: /SELECT title, rule_type/i,
        rows: [
          { title: "Schedule C", ruleType: "categorization", markdownContent: "Supplies < $2500" },
          { title: "Meals", ruleType: "tax_deduction", markdownContent: "50% deductible" },
        ],
      },
    ]);
    const service = new AdminRulesService(db);
    const compiled = await service.compileActiveRulesMarkdown("firm_1", "cli_1");

    expect(compiled).toContain("### Rule: Schedule C (categorization)");
    expect(compiled).toContain("Supplies < $2500");
    expect(compiled).toContain("### Rule: Meals (tax_deduction)");
    expect(compiled).toContain("50% deductible");
  });

  it("evaluates purchase against markdown rules in simulator", async () => {
    const { db } = fakeDb([]);
    const service = new AdminRulesService(db);
    const mockEnv = {} as Env;

    // Test Meals rule matching
    const mealsResult = await service.testRuleMatching(mockEnv, {
      merchant: "Panera Bread",
      description: "Business lunch with client",
      amount: 42.5,
      rulesMarkdown: "Meals are 50% deductible under Schedule C Line 24b.",
    });

    expect(mealsResult.matchedCategory).toBe("Meals & Entertainment");
    expect(mealsResult.taxBucket).toContain("Line 24b");
    expect(mealsResult.deductible).toBe(true);

    // Test De Minimis Safe Harbor rule
    const capitalResult = await service.testRuleMatching(mockEnv, {
      merchant: "Apple Store",
      description: "MacBook Pro M3 Max",
      amount: 3499.0,
      rulesMarkdown: "Items over $2,500 must be capitalized.",
    });

    expect(capitalResult.matchedCategory).toContain("Capital Equipment");
    expect(capitalResult.taxBucket).toContain("Form 4562");

    // Test Personal expense flag
    const personalResult = await service.testRuleMatching(mockEnv, {
      merchant: "Netflix",
      description: "Monthly subscription",
      amount: 19.99,
      rulesMarkdown: "Flag personal subscriptions and owner drawings.",
    });

    expect(personalResult.isPersonal).toBe(true);
    expect(personalResult.deductible).toBe(false);
  });

  it("translates spoken practitioner dictation into structured Markdown rule", async () => {
    const { db } = fakeDb([]);
    const service = new AdminRulesService(db);
    const mockEnv = {} as Env;

    const res = await service.compileDictatedRule(mockEnv, {
      dictatedText: "For ABC Construction, any Home Depot receipt over 500 should go to Job Supplies, but under 100 is Minor Tools.",
      clientName: "ABC Construction",
    });

    expect(res.title).toContain("Home Depot");
    expect(res.markdownContent).toContain("Home Depot");
    expect(res.auditPassed).toBe(true);
    expect(res.auditNotes.length).toBeGreaterThan(0);
  });

  it("audits rule integrity and catches contradictory or invalid values", () => {
    const { db } = fakeDb([]);
    const service = new AdminRulesService(db);

    const validAudit = service.auditRuleIntegrity(`### Target: Home Depot\n- Condition: amount > 500\nCategory: Supplies`);
    expect(validAudit.valid).toBe(true);

    const emptyAudit = service.auditRuleIntegrity("");
    expect(emptyAudit.valid).toBe(false);
    expect(emptyAudit.issues).toContain("Rule content is empty.");

    const negativeAudit = service.auditRuleIntegrity(`### Bad Rule\n- Condition: amount < -500`);
    expect(negativeAudit.valid).toBe(false);
    expect(negativeAudit.issues[0]).toContain("negative amount");
  });

  it("applies rule retroactively to unreviewed receipts matching effective date", async () => {
    const fakeReceipts = [
      {
        id: "rcpt_1",
        clientId: "cli_1",
        merchant: "Home Depot #123",
        date: "2026-08-15",
        total: 750,
        assignedCategory: "Uncategorized",
      },
    ];

    const { db } = fakeDb([
      { match: /FROM firm_rules/i, rows: [{ ...ruleRow, clientId: "cli_1", effectiveFrom: "2026-08-01", markdownContent: "Home Depot over 500 -> Job Supplies & Materials" }] },
      { match: /FROM receipts/i, rows: fakeReceipts },
      { match: /UPDATE receipts/i, rows: [] },
      { match: /INSERT INTO work_audit_events/i, rows: [] },
    ]);

    const service = new AdminRulesService(db);
    const result = await service.applyRuleRetroactively("firm_1", "rule_1");

    expect(result.receiptsEvaluated).toBe(1);
    expect(result.receiptsUpdated).toBe(1);
    expect(result.details[0].newCategory).toBe("Job Supplies & Materials");
  });
});
