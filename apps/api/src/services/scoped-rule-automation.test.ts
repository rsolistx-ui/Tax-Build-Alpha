import { describe, expect, it } from "vitest";
import type { Db } from "../db";
import { activateSafeScopedRule } from "./scoped-rule-automation";

describe("scoped rule automation", () => {
  it("keeps tax directives review-gated without querying or creating a rule", async () => {
    const db = { query: async () => [], transaction: async () => [] } as unknown as Db;
    await expect(activateSafeScopedRule({
      db, env: {} as never, firmId: "firm_1", clientId: "client_1", directiveText: "Deduct every meal.",
      ruleType: "tax_deduction", actorUserId: "user_1",
    })).resolves.toEqual(expect.objectContaining({ status: "review_required" }));
  });

  it("activates a validated, client-scoped categorization rule for future work", async () => {
    const calls: string[] = [];
    const db = {
      query: async (query: string) => {
        calls.push(query);
        if (query.includes("SELECT id FROM clients")) return [{ id: "client_1" }];
        if (query.includes("INSERT INTO firm_rules")) return [{ id: "rule_1", title: "Custom Expense Rule", clientId: "client_1" }];
        return [];
      },
      transaction: async () => [],
    } as unknown as Db;
    const result = await activateSafeScopedRule({
      db, env: {} as never, firmId: "firm_1", clientId: "client_1", clientName: "Acme",
      directiveText: "Put all Shell purchases over $100 in Car and Truck.", ruleType: "categorization", actorUserId: "user_1",
    });
    expect(result).toMatchObject({ status: "activated", ruleId: "rule_1" });
    expect(calls.some((query) => query.includes("INSERT INTO firm_rules"))).toBe(true);
  });
});
