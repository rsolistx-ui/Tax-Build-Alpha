import type { Db } from "../db";
import { newId } from "../lib/id";
import { FolioNativeAccountingProvider } from "./folio-native-accounting";

export interface Project {
  id: string;
  firmId: string;
  clientId: string;
  engagementId: string | null;
  name: string;
  description: string | null;
  status: 'active' | 'on_hold' | 'completed' | 'cancelled';
  startDate: string | null;
  endDate: string | null;
  budgetAmount: number | null;
  budgetCurrency: string;
  color: string;
  isBillable: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectTag {
  id: string;
  projectId: string;
  name: string;
  color: string;
  createdAt: Date;
}

export interface TransactionTag {
  id: string;
  transactionId: string;
  transactionType: 'bank_transaction' | 'invoice' | 'estimate' | 'receipt' | 'payment' | 'journal_entry';
  tagId: string;
  createdAt: Date;
}

export interface AutoTagRule {
  id: string;
  firmId: string;
  projectId: string;
  tagId: string;
  ruleType: 'merchant' | 'category' | 'description' | 'amount_range';
  matchValue: string;
  matchOperator: 'equals' | 'contains' | 'starts_with' | 'ends_with' | 'regex' | 'between';
  priority: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectBudgetSnapshot {
  id: string;
  projectId: string;
  periodStart: string;
  periodEnd: string;
  budgetRevenue: number;
  budgetExpenses: number;
  actualRevenue: number;
  actualExpenses: number;
  createdAt: Date;
}

export interface ProjectPnL {
  project: Project;
  periodStart: string;
  periodEnd: string;
  revenue: number;
  expenses: number;
  netIncome: number;
  budgetRevenue: number;
  budgetExpenses: number;
  varianceRevenue: number;
  varianceExpenses: number;
  transactions: Array<{
    id: string;
    date: string;
    description: string;
    amount: number;
    type: 'revenue' | 'expense';
    tag?: string;
  }>;
}

export interface AutoTagRuleInput {
  projectId: string;
  tagId: string;
  ruleType: 'merchant' | 'category' | 'description' | 'amount_range';
  matchValue: string;
  matchOperator?: 'equals' | 'contains' | 'starts_with' | 'ends_with' | 'regex' | 'between';
  priority?: number;
}

export interface CreateProjectInput {
  clientId: string;
  engagementId?: string | null;
  name: string;
  description?: string;
  status?: 'active' | 'on_hold' | 'completed' | 'cancelled';
  startDate?: string | null;
  endDate?: string | null;
  budgetAmount?: number | null;
  budgetCurrency?: string;
  color?: string;
  isBillable?: boolean;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  status?: 'active' | 'on_hold' | 'completed' | 'cancelled';
  startDate?: string | null;
  endDate?: string | null;
  budgetAmount?: number | null;
  budgetCurrency?: string;
  color?: string;
  isBillable?: boolean;
}

export class ProjectsService {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async createProject(firmId: string, input: CreateProjectInput): Promise<Project> {
    const id = newId("prj");
    const now = new Date().toISOString();

    await this.db.query(
      `INSERT INTO projects (id, firm_id, client_id, engagement_id, name, description, status, start_date, end_date, budget_amount, budget_currency, color, is_billable)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE)`,
      [id, firmId, input.clientId, input.engagementId ?? null, input.name, input.description ?? null,
       input.status ?? 'active', input.startDate ?? null, input.endDate ?? null, input.budgetAmount ?? null,
       input.budgetCurrency ?? 'USD', input.color ?? '#3B82F6'],
    );

    return (await this.getProject(id))!;
  }

  async getProject(id: string): Promise<Project | null> {
    const [row] = await this.db.query<any>(`SELECT * FROM projects WHERE id = $1`, [id]);
    return row ? this.mapProject(row) : null;
  }

  async getProjectsByClient(clientId: string): Promise<Project[]> {
    const rows = await this.db.query<any>(`SELECT * FROM projects WHERE client_id = $1 ORDER BY created_at DESC`, [clientId]);
    return rows.map(this.mapProject);
  }

  async getProjectsByFirm(firmId: string, options?: { status?: string; clientId?: string }): Promise<Project[]> {
    let sql = `SELECT * FROM projects WHERE firm_id = $1`;
    const params: any[] = [firmId];
    let idx = 2;
    if (options?.status) { sql += ` AND status = $${idx++}`; params.push(options.status); }
    if (options?.clientId) { sql += ` AND client_id = $${idx++}`; params.push(options.clientId); }
    sql += ` ORDER BY created_at DESC`;
    const rows = await this.db.query<any>(sql, params);
    return rows.map(this.mapProject);
  }

  async updateProject(id: string, patch: UpdateProjectInput): Promise<Project | null> {
    const sets: string[] = [];
    const params: any[] = [id];
    let idx = 2;
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        sets.push(`${col} = $${idx++}`);
        params.push(value);
      }
    }
    if (sets.length === 0) return this.getProject(id);
    sets.push(`updated_at = NOW()`);
    await this.db.query(`UPDATE projects SET ${sets.join(', ')} WHERE id = $1`, params);
    return this.getProject(id);
  }

  async deleteProject(id: string): Promise<void> {
    await this.db.query(`DELETE FROM projects WHERE id = $1`, [id]);
  }

  // Tags
  async createTag(projectId: string, name: string, color?: string): Promise<ProjectTag> {
    const id = newId("ptg");
    await this.db.query(
      `INSERT INTO project_tags (id, project_id, name, color) VALUES ($1,$2,$3,$4)`,
      [id, projectId, name, color ?? '#6B7280'],
    );
    return (await this.getTag(id))!;
  }

  async getTag(id: string): Promise<ProjectTag | null> {
    const [row] = await this.db.query<any>(`SELECT * FROM project_tags WHERE id = $1`, [id]);
    return row ? this.mapTag(row) : null;
  }

  async getTagsByProject(projectId: string): Promise<ProjectTag[]> {
    const rows = await this.db.query<any>(`SELECT * FROM project_tags WHERE project_id = $1 ORDER BY name`, [projectId]);
    return rows.map(this.mapTag);
  }

  async updateTag(id: string, patch: { name?: string; color?: string }): Promise<ProjectTag | null> {
    const sets: string[] = [];
    const params: any[] = [id];
    let idx = 2;
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        sets.push(`${col} = $${idx++}`);
        params.push(value);
      }
    }
    if (sets.length === 0) return this.getTag(id);
    await this.db.query(`UPDATE project_tags SET ${sets.join(', ')} WHERE id = $1`, params);
    return this.getTag(id);
  }

  async deleteTag(id: string): Promise<void> {
    await this.db.query(`DELETE FROM project_tags WHERE id = $1`, [id]);
  }

  // Transaction tagging
  async tagTransaction(transactionId: string, transactionType: 'bank_transaction' | 'invoice' | 'estimate' | 'receipt' | 'payment' | 'journal_entry', tagId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO transaction_tags (id, transaction_id, transaction_type, tag_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (transaction_id, transaction_type, tag_id) DO NOTHING`,
      [newId("txt"), transactionId, transactionType, tagId],
    );
  }

  async untagTransaction(transactionId: string, transactionType: string, tagId: string): Promise<void> {
    await this.db.query(
      `DELETE FROM transaction_tags WHERE transaction_id = $1 AND transaction_type = $2 AND tag_id = $3`,
      [transactionId, transactionType, tagId],
    );
  }

  async getTransactionTags(transactionId: string, transactionType: string): Promise<ProjectTag[]> {
    const rows = await this.db.query<any>(
      `SELECT pt.* FROM project_tags pt
       JOIN transaction_tags tt ON tt.tag_id = pt.id
       WHERE tt.transaction_id = $1 AND tt.transaction_type = $2`,
      [transactionId, transactionType],
    );
    return rows.map(this.mapTag);
  }

  // Auto-tagging rules
  async createAutoTagRule(firmId: string, input: AutoTagRuleInput): Promise<AutoTagRule> {
    const id = newId("atr");
    await this.db.query(
      `INSERT INTO auto_tag_rules (id, firm_id, project_id, tag_id, rule_type, match_value, match_operator, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, firmId, input.projectId, input.tagId, input.ruleType, input.matchValue,
       input.matchOperator ?? 'contains', input.priority ?? 0],
    );
    return (await this.getAutoTagRule(id))!;
  }

  async getAutoTagRule(id: string): Promise<AutoTagRule | null> {
    const [row] = await this.db.query<any>(`SELECT * FROM auto_tag_rules WHERE id = $1`, [id]);
    return row ? this.mapAutoTagRule(row) : null;
  }

  async getAutoTagRulesByFirm(firmId: string): Promise<AutoTagRule[]> {
    const rows = await this.db.query<any>(`SELECT * FROM auto_tag_rules WHERE firm_id = $1 ORDER BY priority DESC, created_at`, [firmId]);
    return rows.map(this.mapAutoTagRule);
  }

  async updateAutoTagRule(id: string, patch: Partial<AutoTagRuleInput & { isActive?: boolean }>): Promise<AutoTagRule | null> {
    const sets: string[] = [];
    const params: any[] = [id];
    let idx = 2;
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        sets.push(`${col} = $${idx++}`);
        params.push(value);
      }
    }
    if (sets.length === 0) return this.getAutoTagRule(id);
    sets.push(`updated_at = NOW()`);
    await this.db.query(`UPDATE auto_tag_rules SET ${sets.join(', ')} WHERE id = $1`, params);
    return this.getAutoTagRule(id);
  }

  async deleteAutoTagRule(id: string): Promise<void> {
    await this.db.query(`DELETE FROM auto_tag_rules WHERE id = $1`, [id]);
  }

  async applyAutoTagRules(firmId: string, transaction: {
    id: string;
    type: 'bank_transaction' | 'invoice' | 'estimate' | 'receipt' | 'payment' | 'journal_entry';
    merchant?: string | null;
    category?: string | null;
    description?: string | null;
    amount?: number;
  }): Promise<string[]> {
    const rules = await this.getAutoTagRulesByFirm(firmId);
    const appliedTagIds: string[] = [];

    for (const rule of rules) {
      if (!rule.isActive) continue;

      let matches = false;
      const value = this.getRuleValue(transaction, rule.ruleType);

      if (value !== null) {
        matches = this.matchRule(value, rule.matchValue, rule.matchOperator);
      }

      if (matches) {
        await this.tagTransaction(transaction.id, transaction.type, rule.tagId);
        appliedTagIds.push(rule.tagId);
      }
    }

    return appliedTagIds;
  }

  private getRuleValue(transaction: any, ruleType: string): string | null {
    switch (ruleType) {
      case 'merchant': return transaction.merchant ?? null;
      case 'category': return transaction.category ?? null;
      case 'description': return transaction.description ?? null;
      case 'amount_range': return transaction.amount !== undefined ? String(transaction.amount) : null;
      default: return null;
    }
  }

  private matchRule(value: string, matchValue: string, operator: string): boolean {
    switch (operator) {
      case 'equals': return value === matchValue;
      case 'contains': return value.toLowerCase().includes(matchValue.toLowerCase());
      case 'starts_with': return value.toLowerCase().startsWith(matchValue.toLowerCase());
      case 'ends_with': return value.toLowerCase().endsWith(matchValue.toLowerCase());
      case 'regex':
        try { return new RegExp(matchValue).test(value); } catch { return false; }
      case 'between':
        const [min, max] = matchValue.split(',').map(Number);
        const num = Number(value);
        return !isNaN(num) && num >= min && num <= max;
      default: return false;
    }
  }

  // Budget & P&L
  async createBudgetSnapshot(projectId: string, periodStart: string, periodEnd: string,
                             budgetRevenue: number, budgetExpenses: number): Promise<ProjectBudgetSnapshot> {
    const id = newId("pbs");
    await this.db.query(
      `INSERT INTO project_budget_snapshots (id, project_id, period_start, period_end, budget_revenue, budget_expenses)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (project_id, period_start, period_end) DO UPDATE SET
         budget_revenue = EXCLUDED.budget_revenue,
         budget_expenses = EXCLUDED.budget_expenses`,
      [id, projectId, periodStart, periodEnd, budgetRevenue, budgetExpenses],
    );
    return (await this.getBudgetSnapshotByPeriod(projectId, periodStart, periodEnd))!;
  }

  async getBudgetSnapshotByPeriod(projectId: string, periodStart: string, periodEnd: string): Promise<ProjectBudgetSnapshot | null> {
    const [row] = await this.db.query<any>(
      `SELECT * FROM project_budget_snapshots WHERE project_id = $1 AND period_start = $2 AND period_end = $3`,
      [projectId, periodStart, periodEnd],
    );
    return row ? this.mapBudgetSnapshot(row) : null;
  }

  async getBudgetSnapshot(id: string): Promise<ProjectBudgetSnapshot | null> {
    const [row] = await this.db.query<any>(`SELECT * FROM project_budget_snapshots WHERE id = $1`, [id]);
    return row ? this.mapBudgetSnapshot(row) : null;
  }

  async getBudgetSnapshotsByProject(projectId: string): Promise<ProjectBudgetSnapshot[]> {
    const rows = await this.db.query<any>(`SELECT * FROM project_budget_snapshots WHERE project_id = $1 ORDER BY period_start`, [projectId]);
    return rows.map(this.mapBudgetSnapshot);
  }

  async getProjectPnL(projectId: string, periodStart: string, periodEnd: string): Promise<ProjectPnL | null> {
    const project = await this.getProject(projectId);
    if (!project) return null;

    // Get budget
    const budgetRows = await this.db.query<any>(
      `SELECT * FROM project_budget_snapshots WHERE project_id = $1 AND period_start <= $2 AND period_end >= $3 ORDER BY period_start DESC LIMIT 1`,
      [projectId, periodEnd, periodStart],
    );
    const budget = budgetRows[0] ? this.mapBudgetSnapshot(budgetRows[0]) : null;

    // Get transactions with tags
    const transactions = await this.getProjectTransactions(projectId, periodStart, periodEnd);

    const revenue = transactions.filter(t => t.type === 'revenue').reduce((sum, t) => sum + t.amount, 0);
    const expenses = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);

    return {
      project,
      periodStart,
      periodEnd,
      revenue,
      expenses,
      netIncome: revenue - expenses,
      budgetRevenue: budget?.budgetRevenue ?? 0,
      budgetExpenses: budget?.budgetExpenses ?? 0,
      varianceRevenue: revenue - (budget?.budgetRevenue ?? 0),
      varianceExpenses: expenses - (budget?.budgetExpenses ?? 0),
      transactions,
    };
  }

  async getProjectTransactions(projectId: string, periodStart: string, periodEnd: string): Promise<Array<{
    id: string;
    date: string;
    description: string;
    amount: number;
    type: 'revenue' | 'expense';
    tag?: string;
  }>> {
    // This would join transactions from various sources (invoices, payments, bank transactions, journal entries)
    // tagged with this project's tags. Simplified for now.
    const projectTags = await this.getTagsByProject(projectId);
    const tagIds = projectTags.map(t => t.id);

    if (tagIds.length === 0) return [];

    const transactions: Array<{ id: string; date: string; description: string; amount: number; type: 'revenue' | 'expense'; tag?: string }> = [];

    // Check invoices
    const invoices = await this.db.query<any>(
      `SELECT i.id, i.issue_date as date, i.memo as description, i.total as amount, 'revenue' as type
       FROM invoices i
       JOIN transaction_tags tt ON tt.transaction_id = i.id AND tt.transaction_type = 'invoice'
       WHERE tt.tag_id = ANY($1) AND i.issue_date >= $2 AND i.issue_date <= $3`,
      [tagIds, periodStart, periodEnd],
    );
    transactions.push(...invoices);

    // Check payments
    const payments = await this.db.query<any>(
      `SELECT p.id, p.received_date as date, p.notes as description, p.amount, 'revenue' as type
       FROM payments p
       JOIN transaction_tags tt ON tt.transaction_id = p.id AND tt.transaction_type = 'payment'
       WHERE tt.tag_id = ANY($1) AND p.received_date >= $2 AND p.received_date <= $3`,
      [tagIds, periodStart, periodEnd],
    );
    transactions.push(...payments);

    // Check bank transactions (only those with a professional-confirmed business disposition)
    const bankTxns = await this.db.query<any>(
      `SELECT bt.id, bt.txn_date as date, bt.description, ABS(bt.amount) as amount,
              CASE WHEN bt.disposition = 'business_income' THEN 'revenue' ELSE 'expense' END as type
       FROM bank_transactions bt
       JOIN transaction_tags tt ON tt.transaction_id = bt.id AND tt.transaction_type = 'bank_transaction'
       WHERE tt.tag_id = ANY($1) AND bt.txn_date >= $2 AND bt.txn_date <= $3
         AND bt.disposition IN ('business_income', 'business_expense')`,
      [tagIds, periodStart, periodEnd],
    );
    transactions.push(...bankTxns);

    // Check journal entries
    const journals = await this.db.query<any>(
      `SELECT je.id, je.period_end as date, je.memo as description,
              jl.debit as amount, 'expense' as type
       FROM journal_lines jl
       JOIN journals je ON je.id = jl.journal_id
       JOIN transaction_tags tt ON tt.transaction_id = je.id AND tt.transaction_type = 'journal_entry'
       WHERE tt.tag_id = ANY($1) AND je.period_end >= $2 AND je.period_end <= $3 AND jl.debit > 0`,
      [tagIds, periodStart, periodEnd],
    );
    transactions.push(...journals);

    return transactions.map(t => ({
      id: t.id,
      date: t.date,
      description: t.description ?? '',
      amount: Math.abs(Number(t.amount)),
      type: t.type,
      tag: undefined, // Would need to join tags
    })).sort((a, b) => a.date.localeCompare(b.date));
  }

  // Mappers
  private mapProject(row: any): Project {
    return {
      id: row.id,
      firmId: row.firm_id,
      clientId: row.client_id,
      engagementId: row.engagement_id,
      name: row.name,
      description: row.description,
      status: row.status,
      startDate: row.start_date,
      endDate: row.end_date,
      budgetAmount: row.budget_amount ? Number(row.budget_amount) : null,
      budgetCurrency: row.budget_currency,
      color: row.color,
      isBillable: row.is_billable,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapTag(row: any): ProjectTag {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      color: row.color,
      createdAt: new Date(row.created_at),
    };
  }

  private mapAutoTagRule(row: any): AutoTagRule {
    return {
      id: row.id,
      firmId: row.firm_id,
      projectId: row.project_id,
      tagId: row.tag_id,
      ruleType: row.rule_type,
      matchValue: row.match_value,
      matchOperator: row.match_operator,
      priority: row.priority,
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapBudgetSnapshot(row: any): ProjectBudgetSnapshot {
    return {
      id: row.id,
      projectId: row.project_id,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      budgetRevenue: Number(row.budget_revenue),
      budgetExpenses: Number(row.budget_expenses),
      actualRevenue: Number(row.actual_revenue ?? 0),
      actualExpenses: Number(row.actual_expenses ?? 0),
      createdAt: new Date(row.created_at),
    };
  }
}