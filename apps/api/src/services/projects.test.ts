import { describe, expect, it } from "vitest";
import type { Db } from "../db";
import { ProjectsService } from "./projects";

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

const projectRow = {
  id: "prj_1",
  firm_id: "firm_1",
  client_id: "cli_1",
  engagement_id: null,
  name: "Bookkeeping 2026",
  description: null,
  status: "active",
  start_date: "2026-01-01",
  end_date: null,
  budget_amount: "12000",
  budget_currency: "USD",
  color: "#3B82F6",
  is_billable: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const tagRow = {
  id: "tag_1",
  project_id: "prj_1",
  name: "Q1 Work",
  color: "#6B7280",
  created_at: "2026-01-02T00:00:00Z",
};

function ruleRow(overrides: Record<string, unknown>) {
  return {
    id: "atr_1",
    firm_id: "firm_1",
    project_id: "prj_1",
    tag_id: "tag_1",
    rule_type: "merchant",
    match_value: "office",
    match_operator: "contains",
    priority: 0,
    is_active: true,
    created_at: "2026-01-02T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

describe("project profitability service", () => {
  it("creates a project with the requested status bound as a parameter, not hardcoded", async () => {
    const { db, calls } = fakeDb([{ match: /FROM projects WHERE id = \$1/, rows: [projectRow] }]);
    const service = new ProjectsService(db);
    await service.createProject("firm_1", {
      clientId: "cli_1",
      name: "Bookkeeping 2026",
      status: "completed",
    });

    const insert = calls.find((call) => call.sql.includes("INSERT INTO projects"));
    expect(insert).toBeDefined();
    expect(insert!.sql).not.toContain("'active'");
    expect(insert!.params[6]).toBe("completed");
  });

  it("upserts a budget snapshot without touching a nonexistent updated_at column and returns the surviving row", async () => {
    const snapshotRow = {
      id: "pbs_existing",
      project_id: "prj_1",
      period_start: "2026-01-01",
      period_end: "2026-01-31",
      budget_revenue: "10000",
      budget_expenses: "6000",
      actual_revenue: "0",
      actual_expenses: "0",
      created_at: "2026-01-01T00:00:00Z",
    };
    const { db, calls } = fakeDb([
      { match: /project_budget_snapshots WHERE project_id = \$1 AND period_start = \$2 AND period_end = \$3/, rows: [snapshotRow] },
    ]);
    const service = new ProjectsService(db);
    const snapshot = await service.createBudgetSnapshot("prj_1", "2026-01-01", "2026-01-31", 10000, 6000);

    const insert = calls.find((call) => call.sql.includes("INSERT INTO project_budget_snapshots"));
    expect(insert).toBeDefined();
    expect(insert!.sql).not.toContain("updated_at");
    expect(insert!.sql).toContain("ON CONFLICT (project_id, period_start, period_end) DO UPDATE");
    // The row that comes back is the one the period lookup found (an upsert on
    // conflict keeps the pre-existing id, so the fresh id must not be trusted).
    expect(snapshot.id).toBe("pbs_existing");
    expect(snapshot.budgetRevenue).toBe(10000);
    expect(snapshot.budgetExpenses).toBe(6000);
  });

  it("aggregates project P&L across invoices, payments, bank transactions and journal lines", async () => {
    const budgetRow = {
      id: "pbs_1",
      project_id: "prj_1",
      period_start: "2026-01-01",
      period_end: "2026-12-31",
      budget_revenue: "10000",
      budget_expenses: "6000",
      actual_revenue: "0",
      actual_expenses: "0",
      created_at: "2026-01-01T00:00:00Z",
    };
    const { db, calls } = fakeDb([
      { match: /FROM projects WHERE id = \$1/, rows: [projectRow] },
      { match: /FROM project_tags WHERE project_id/, rows: [tagRow] },
      { match: /project_budget_snapshots WHERE project_id = \$1 AND period_start <=/, rows: [budgetRow] },
      { match: /FROM invoices i/, rows: [{ id: "inv_1", date: "2026-02-01", description: "Consulting", amount: "2000", type: "revenue" }] },
      { match: /FROM payments p/, rows: [{ id: "pay_1", date: "2026-02-05", description: "Retainer", amount: "1000", type: "revenue" }] },
      { match: /FROM bank_transactions bt/, rows: [{ id: "bt_1", date: "2026-02-06", description: "Software", amount: "-800", type: "expense" }] },
      { match: /FROM journal_lines jl/, rows: [{ id: "je_1", date: "2026-02-28", description: "Adjustment", amount: "200", type: "expense" }] },
    ]);
    const service = new ProjectsService(db);
    const pnl = await service.getProjectPnL("prj_1", "2026-01-01", "2026-12-31");

    expect(pnl).not.toBeNull();
    expect(pnl!.revenue).toBe(3000);
    expect(pnl!.expenses).toBe(1000);
    expect(pnl!.netIncome).toBe(2000);
    expect(pnl!.budgetRevenue).toBe(10000);
    expect(pnl!.varianceRevenue).toBe(-7000);
    expect(pnl!.varianceExpenses).toBe(-5000);
    expect(pnl!.transactions).toHaveLength(4);

    const bank = calls.find((call) => call.sql.includes("FROM bank_transactions bt"));
    expect(bank!.sql).toContain("bt.txn_date");
    expect(bank!.sql).toContain("bt.disposition IN ('business_income', 'business_expense')");
    expect(bank!.params[0]).toEqual(["tag_1"]);

    const invoices = calls.find((call) => call.sql.includes("FROM invoices i"));
    expect(invoices!.sql).toContain("i.memo");
    const payments = calls.find((call) => call.sql.includes("FROM payments p"));
    expect(payments!.sql).toContain("p.notes");
  });

  it("returns an empty transaction list when the project has no tags", async () => {
    const { db, calls } = fakeDb([
      { match: /FROM projects WHERE id = \$1/, rows: [projectRow] },
      { match: /FROM project_tags WHERE project_id/, rows: [] },
    ]);
    const service = new ProjectsService(db);
    const transactions = await service.getProjectTransactions("prj_1", "2026-01-01", "2026-12-31");
    expect(transactions).toEqual([]);
    expect(calls.filter((call) => call.sql.includes("ANY($1)"))).toHaveLength(0);
  });

  it("applies auto-tag rules by operator and skips inactive rules", async () => {
    const rows = [
      ruleRow({ id: "atr_contains", tag_id: "tag_contains", rule_type: "merchant", match_value: "office", match_operator: "contains" }),
      ruleRow({ id: "atr_inactive", tag_id: "tag_inactive", is_active: false }),
      ruleRow({ id: "atr_regex", tag_id: "tag_regex", rule_type: "description", match_value: "^Acme", match_operator: "regex" }),
      ruleRow({ id: "atr_between", tag_id: "tag_between", rule_type: "amount_range", match_value: "100,500", match_operator: "between" }),
      ruleRow({ id: "atr_equals_miss", tag_id: "tag_miss", rule_type: "category", match_value: "travel", match_operator: "equals" }),
    ];
    const { db, calls } = fakeDb([{ match: /FROM auto_tag_rules WHERE firm_id/, rows }]);
    const service = new ProjectsService(db);
    const appliedTags = await service.applyAutoTagRules("firm_1", {
      id: "txn_1",
      type: "bank_transaction",
      merchant: "Office Depot 4419",
      category: "supplies",
      description: "Acme monthly service",
      amount: 250,
    });

    expect(appliedTags).toEqual(["tag_contains", "tag_regex", "tag_between"]);
    const tagInserts = calls.filter((call) => call.sql.includes("INSERT INTO transaction_tags"));
    expect(tagInserts).toHaveLength(3);
    for (const insert of tagInserts) {
      expect(insert.params[1]).toBe("txn_1");
      expect(insert.params[2]).toBe("bank_transaction");
    }
    expect(tagInserts.map((insert) => insert.params[3])).toEqual(["tag_contains", "tag_regex", "tag_between"]);
  });

  it("does not crash or tag when the rule field is missing from the transaction", async () => {
    const { db } = fakeDb([{ match: /FROM auto_tag_rules WHERE firm_id/, rows: [ruleRow({ rule_type: "merchant" })] }]);
    const service = new ProjectsService(db);
    const appliedTags = await service.applyAutoTagRules("firm_1", {
      id: "txn_2",
      type: "invoice",
      merchant: null,
    });
    expect(appliedTags).toEqual([]);
  });

  it("translates camelCase patch keys into snake_case columns on update", async () => {
    const { db, calls } = fakeDb([{ match: /FROM projects WHERE id = \$1/, rows: [projectRow] }]);
    const service = new ProjectsService(db);
    await service.updateProject("prj_1", { status: "completed", budgetAmount: 5000 });

    const update = calls.find((call) => call.sql.startsWith("UPDATE projects"));
    expect(update!.sql).toContain("status = $2");
    expect(update!.sql).toContain("budget_amount = $3");
    expect(update!.params).toEqual(["prj_1", "completed", 5000]);
  });
});
