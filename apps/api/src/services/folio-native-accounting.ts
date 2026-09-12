import type { Db } from "../db";
import { newId } from "../lib/id";
import type {
  Account,
  Journal,
  JournalLine,
  TrialBalanceEntry,
  BalanceSheetEntry,
  Reconciliation,
  PeriodClose,
  ChartOfAccountsSeedEntry,
  AccountingProvider,
} from "./accounting-provider";

const SYSTEM_ACCOUNT_KEYS = [
  'retained_earnings',
  'ar_control',
  'ap_control',
  'cash_undeposited_funds',
  'sales_tax_payable',
  'payroll_tax_payable',
] as const;

export function getDefaultChartOfAccountsTemplate(): ChartOfAccountsSeedEntry[] {
  return [
    // Assets
    { code: '1000', name: 'Cash - Operating', type: 'asset', subtype: 'current_asset', normalBalance: 'debit', description: 'Primary operating bank account', isSystem: true },
    { code: '1010', name: 'Cash - Savings', type: 'asset', subtype: 'current_asset', normalBalance: 'debit', description: 'Savings account' },
    { code: '1100', name: 'Accounts Receivable', type: 'asset', subtype: 'current_asset', normalBalance: 'debit', isSystem: true, description: 'Control account for AR' },
    { code: '1200', name: 'Undeposited Funds', type: 'asset', subtype: 'current_asset', normalBalance: 'debit', isSystem: true, description: 'Payments received but not yet deposited' },
    { code: '1300', name: 'Inventory', type: 'asset', subtype: 'current_asset', normalBalance: 'debit' },
    { code: '1400', name: 'Prepaid Expenses', type: 'asset', subtype: 'current_asset', normalBalance: 'debit' },
    { code: '1500', name: 'Fixed Assets', type: 'asset', subtype: 'fixed_asset', normalBalance: 'debit' },
    { code: '1510', name: 'Accumulated Depreciation', type: 'asset', subtype: 'fixed_asset', normalBalance: 'credit' },

    // Liabilities
    { code: '2000', name: 'Accounts Payable', type: 'liability', subtype: 'current_liability', normalBalance: 'credit', isSystem: true, description: 'Control account for AP' },
    { code: '2100', name: 'Sales Tax Payable', type: 'liability', subtype: 'current_liability', normalBalance: 'credit', isSystem: true },
    { code: '2200', name: 'Payroll Tax Payable', type: 'liability', subtype: 'current_liability', normalBalance: 'credit', isSystem: true },
    { code: '2300', name: 'Accrued Expenses', type: 'liability', subtype: 'current_liability', normalBalance: 'credit' },
    { code: '2400', name: 'Notes Payable - Current', type: 'liability', subtype: 'current_liability', normalBalance: 'credit' },
    { code: '2500', name: 'Long-Term Debt', type: 'liability', subtype: 'long_term_liability', normalBalance: 'credit' },

    // Equity
    { code: '3000', name: 'Owner Equity', type: 'equity', normalBalance: 'credit' },
    { code: '3100', name: 'Retained Earnings', type: 'equity', normalBalance: 'credit', isSystem: true },
    { code: '3200', name: 'Current Year Earnings', type: 'equity', normalBalance: 'credit', isSystem: true },

    // Revenue
    { code: '4000', name: 'Sales Revenue', type: 'revenue', normalBalance: 'credit' },
    { code: '4100', name: 'Service Revenue', type: 'revenue', normalBalance: 'credit' },
    { code: '4200', name: 'Other Income', type: 'revenue', normalBalance: 'credit' },

    // Expenses
    { code: '5000', name: 'Cost of Goods Sold', type: 'expense', normalBalance: 'debit' },
    { code: '6000', name: 'Advertising & Marketing', type: 'expense', normalBalance: 'debit' },
    { code: '6100', name: 'Bank Fees', type: 'expense', normalBalance: 'debit' },
    { code: '6200', name: 'Contractors', type: 'expense', normalBalance: 'debit' },
    { code: '6300', name: 'Insurance', type: 'expense', normalBalance: 'debit' },
    { code: '6400', name: 'Legal & Professional', type: 'expense', normalBalance: 'debit' },
    { code: '6500', name: 'Meals & Entertainment', type: 'expense', normalBalance: 'debit' },
    { code: '6600', name: 'Office Expenses', type: 'expense', normalBalance: 'debit' },
    { code: '6700', name: 'Rent', type: 'expense', normalBalance: 'debit' },
    { code: '6800', name: 'Software & Subscriptions', type: 'expense', normalBalance: 'debit' },
    { code: '6900', name: 'Travel', type: 'expense', normalBalance: 'debit' },
    { code: '7000', name: 'Utilities', type: 'expense', normalBalance: 'debit' },
    { code: '7100', name: 'Payroll', type: 'expense', normalBalance: 'debit' },
    { code: '7200', name: 'Depreciation', type: 'expense', normalBalance: 'debit' },
  ];
}

export class FolioNativeAccountingProvider {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  // Chart of Accounts
  async getAccount(firmId: string, accountId: string): Promise<Account | undefined> {
    const [row] = await this.db.query<any>(
      `SELECT * FROM accounts WHERE id = $1 AND firm_id = $2`,
      [accountId, firmId],
    );
    return row ? this.mapAccount(row) : undefined;
  }

  async getAccountByCode(firmId: string, code: string): Promise<Account | undefined> {
    const [row] = await this.db.query<any>(
      `SELECT * FROM accounts WHERE code = $1 AND firm_id = $2`,
      [code, firmId],
    );
    return row ? this.mapAccount(row) : undefined;
  }

  async listAccounts(firmId: string, type?: string): Promise<Account[]> {
    if (type) {
      const rows = await this.db.query<any>(
        `SELECT * FROM accounts WHERE firm_id = $1 AND type = $2 AND is_active = TRUE ORDER BY sort_order, code`,
        [firmId, type],
      );
      return rows.map(this.mapAccount);
    }
    const rows = await this.db.query<any>(
      `SELECT * FROM accounts WHERE firm_id = $1 AND is_active = TRUE ORDER BY sort_order, code`,
      [firmId],
    );
    return rows.map(this.mapAccount);
  }

  async createAccount(firmId: string, input: Omit<Account, 'id' | 'firmId' | 'createdAt' | 'updatedAt'>): Promise<Account> {
    const id = newId("acc");
    await this.db.query(
      `INSERT INTO accounts (id, firm_id, code, name, type, subtype, parent_id, is_system, normal_balance, description, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, firmId, input.code, input.name, input.type, input.subtype ?? null, input.parentId ?? null,
       input.isSystem, input.normalBalance, input.description ?? null, input.isActive, input.sortOrder],
    );
    const account = await this.getAccount(firmId, id);
    if (!account) throw new Error(`Account ${id} not found after creation`);
    return account;
  }

  async updateAccount(firmId: string, accountId: string, patch: Partial<Account>): Promise<Account> {
    const sets: string[] = [];
    const params: any[] = [accountId, firmId];
    let idx = 3;
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined && key !== 'id' && key !== 'firmId' && key !== 'createdAt' && key !== 'updatedAt') {
        const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        sets.push(`${col} = $${idx++}`);
        params.push(value);
      }
    }
    if (sets.length === 0) {
      const account = await this.getAccount(firmId, accountId);
      if (!account) throw new Error(`Account ${accountId} not found`);
      return account;
    }
    sets.push(`updated_at = NOW()`);
    await this.db.query(
      `UPDATE accounts SET ${sets.join(', ')} WHERE id = $1 AND firm_id = $2`,
      params,
    );
    const account = await this.getAccount(firmId, accountId);
    if (!account) throw new Error(`Account ${accountId} not found after update`);
    return account;
  }

  async deleteAccount(firmId: string, accountId: string): Promise<void> {
    await this.db.query(`UPDATE accounts SET is_active = FALSE WHERE id = $1 AND firm_id = $2`, [accountId, firmId]);
  }

  // Journals
  async createJournal(firmId: string, input: Omit<Journal, 'id' | 'createdAt' | 'updatedAt' | 'lines'> & { lines: Omit<JournalLine, 'id' | 'journalId' | 'createdAt'>[] }): Promise<Journal> {
    const id = newId("jnl");
    const lines = input.lines;
    const { lines: _, ...journalInput } = input;

    // Validate double-entry
    const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.005) {
      throw new Error(`Journal out of balance: debits ${totalDebit} != credits ${totalCredit}`);
    }

    await this.db.transaction([
      {
        query: `INSERT INTO journals (id, firm_id, client_id, engagement_id, source_type, source_id, memo, period_start, period_end, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        params: [id, firmId, journalInput.clientId ?? null, journalInput.engagementId ?? null, journalInput.sourceType, journalInput.sourceId ?? null, journalInput.memo ?? null, journalInput.periodStart, journalInput.periodEnd, 'draft'],
      },
      ...lines.map((line, i) => ({
        query: `INSERT INTO journal_lines (id, journal_id, account_id, description, debit, credit, currency, exchange_rate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        params: [newId("jnll"), id, line.accountId, line.description ?? null, line.debit, line.credit, line.currency ?? 'USD', line.exchangeRate ?? 1],
      })),
    ]);

    const journal = await this.getJournal(firmId, id);
    if (!journal) throw new Error(`Journal ${id} not found after creation`);
    return journal;
  }

  async getJournal(firmId: string, journalId: string): Promise<Journal | undefined> {
    const [journalRow] = await this.db.query<any>(
      `SELECT * FROM journals WHERE id = $1 AND firm_id = $2`,
      [journalId, firmId],
    );
    if (!journalRow) return undefined;
    const lineRows = await this.db.query<any>(
      `SELECT * FROM journal_lines WHERE journal_id = $1 ORDER BY created_at`,
      [journalId],
    );
    return {
      ...this.mapJournal(journalRow),
      lines: lineRows.map(this.mapJournalLine),
    };
  }

  async listJournals(firmId: string, filters?: { clientId?: string; status?: string; periodStart?: Date; periodEnd?: Date }): Promise<Journal[]> {
    let sql = `SELECT * FROM journals WHERE firm_id = $1`;
    const params: any[] = [firmId];
    let idx = 2;
    if (filters?.clientId) { sql += ` AND client_id = $${idx++}`; params.push(filters.clientId); }
    if (filters?.status) { sql += ` AND status = $${idx++}`; params.push(filters.status); }
    if (filters?.periodStart) { sql += ` AND period_end >= $${idx++}`; params.push(filters.periodStart); }
    if (filters?.periodEnd) { sql += ` AND period_start <= $${idx++}`; params.push(filters.periodEnd); }
    sql += ` ORDER BY period_end DESC, created_at DESC LIMIT 200`;
    const rows = await this.db.query<any>(sql, params);
    return rows.map(this.mapJournal);
  }

  async postJournal(firmId: string, journalId: string, actorUserId: string): Promise<Journal> {
    const journal = await this.getJournal(firmId, journalId);
    if (!journal) throw new Error("Journal not found");
    if (journal.status !== 'draft') throw new Error("Only draft journals can be posted");

    // Double-entry validation
    const totalDebit = journal.lines!.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = journal.lines!.reduce((sum, l) => sum + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.005) {
      throw new Error("Journal debits do not equal credits");
    }

    await this.db.transaction([
      {
        query: `UPDATE journals SET status = 'posted', posted_at = NOW(), posted_by_user_id = $1 WHERE id = $2 AND firm_id = $3`,
        params: [actorUserId, journalId, firmId],
      },
      // Update account balances
      ...journal.lines!.map(line => ({
        query: `INSERT INTO account_balances (id, firm_id, client_id, account_id, period_end, debit_balance, credit_balance)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (firm_id, client_id, account_id, period_end) DO UPDATE SET
                  debit_balance = account_balances.debit_balance + EXCLUDED.debit_balance,
                  credit_balance = account_balances.credit_balance + EXCLUDED.credit_balance,
                  updated_at = NOW()`,
        params: [
          newId("abal"), firmId, journal.clientId ?? null, line.accountId, journal.periodEnd,
          line.debit, line.credit,
        ],
      })),
    ]);

    const updatedJournal = await this.getJournal(firmId, journalId);
    if (!updatedJournal) throw new Error(`Journal ${journalId} not found after posting`);
    return updatedJournal;
  }

  async reverseJournal(firmId: string, journalId: string, actorUserId: string, memo: string): Promise<Journal> {
    const original = await this.getJournal(firmId, journalId);
    if (!original) throw new Error("Journal not found");
    if (original.status !== 'posted') throw new Error("Only posted journals can be reversed");

    const reversalId = newId("jnl");
    const reversedLines = original.lines!.map(l => ({
      ...l,
      id: newId("jnll"),
      journalId: reversalId,
      debit: l.credit,
      credit: l.debit,
      description: `Reversal of ${original.id}: ${l.description ?? ''}`,
    }));

    await this.db.transaction([
      {
        query: `INSERT INTO journals (id, firm_id, client_id, engagement_id, source_type, source_id, memo, period_start, period_end, posted_at, posted_by_user_id, reversed_journal_id, status)
                VALUES ($1, $2, $3, $4, 'reversal', $5, $6, $7, $8, NOW(), $9, $10, 'posted')`,
        params: [reversalId, firmId, original.clientId ?? null, original.engagementId ?? null, original.id, memo, original.periodStart, original.periodEnd, actorUserId, original.id],
      },
      ...reversedLines.map(line => ({
        query: `INSERT INTO journal_lines (id, journal_id, account_id, description, debit, credit, currency, exchange_rate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        params: [line.id, reversalId, line.accountId, line.description, line.debit, line.credit, line.currency, line.exchangeRate],
      })),
      // Update account balances with reversed amounts
      ...original.lines!.map(line => ({
        query: `INSERT INTO account_balances (id, firm_id, client_id, account_id, period_end, debit_balance, credit_balance)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (firm_id, client_id, account_id, period_end) DO UPDATE SET
                  debit_balance = account_balances.debit_balance - EXCLUDED.credit_balance + EXCLUDED.debit_balance,
                  credit_balance = account_balances.credit_balance - EXCLUDED.debit_balance + EXCLUDED.credit_balance,
                  updated_at = NOW()`,
        params: [newId("abal"), firmId, original.clientId ?? null, line.accountId, original.periodEnd, -line.credit, -line.debit],
      })),
      {
        query: `UPDATE journals SET status = 'reversed' WHERE id = $1 AND firm_id = $2`,
        params: [journalId, firmId],
      },
    ]);

    const reversalJournal = await this.getJournal(firmId, reversalId);
    if (!reversalJournal) throw new Error(`Reversal journal ${reversalId} not found after creation`);
    return reversalJournal;
  }

  // Trial Balance & Balance Sheet
  async getTrialBalance(firmId: string, clientId: string | undefined, periodEnd: Date): Promise<TrialBalanceEntry[]> {
    let sql = `
      SELECT a.id, a.code, a.name, a.type,
             COALESCE(ab.debit_balance, 0) AS debit_balance,
             COALESCE(ab.credit_balance, 0) AS credit_balance,
             COALESCE(ab.net_balance, 0) AS net_balance
      FROM accounts a
      LEFT JOIN account_balances ab
        ON ab.account_id = a.id
        AND ab.firm_id = a.firm_id
        AND ab.period_end = $2
        ${clientId ? "AND ab.client_id = $3" : "AND ab.client_id IS NULL"}
      WHERE a.firm_id = $1 AND a.is_active = TRUE
      ORDER BY a.sort_order, a.code
    `;
    const params = clientId ? [firmId, periodEnd.toISOString().split('T')[0], clientId] : [firmId, periodEnd.toISOString().split('T')[0]];
    const rows = await this.db.query<any>(sql, params);
    return rows.map(r => ({
      accountId: r.id,
      code: r.code,
      name: r.name,
      type: r.type,
      debitBalance: Number(r.debit_balance),
      creditBalance: Number(r.credit_balance),
      netBalance: Number(r.net_balance),
    }));
  }

  async getBalanceSheet(firmId: string, clientId: string | undefined, periodEnd: Date): Promise<{ assets: BalanceSheetEntry[]; liabilities: BalanceSheetEntry[]; equity: BalanceSheetEntry[] }> {
    const tb = await this.getTrialBalance(firmId, clientId, periodEnd);
    const mapEntry = (e: TrialBalanceEntry): BalanceSheetEntry => ({
      accountId: e.accountId,
      code: e.code,
      name: e.name,
      type: e.type,
      balance: e.netBalance,
    });
    return {
      assets: tb.filter(e => e.type === 'asset').map(mapEntry),
      liabilities: tb.filter(e => e.type === 'liability').map(mapEntry),
      equity: tb.filter(e => e.type === 'equity').map(mapEntry),
    };
  }

  // Period Close
  async closePeriod(firmId: string, clientId: string | undefined, periodEnd: Date, actorUserId: string): Promise<PeriodClose> {
    const id = newId("pcl");
    await this.db.query(
      `INSERT INTO period_closes (id, firm_id, client_id, period_end, closed_at, closed_by_user_id, status)
       VALUES ($1, $2, $3, $4, NOW(), $5, 'closed')
       ON CONFLICT (firm_id, client_id, period_end) DO UPDATE SET closed_at = NOW(), closed_by_user_id = EXCLUDED.closed_by_user_id, status = 'closed'`,
      [id, firmId, clientId ?? null, periodEnd, actorUserId],
    );
    return { id, firmId, clientId, periodEnd, closedAt: new Date(), closedByUserId: actorUserId, status: 'closed' };
  }

  async reopenPeriod(firmId: string, clientId: string | undefined, periodEnd: Date, actorUserId: string): Promise<PeriodClose> {
    await this.db.query(
      `UPDATE period_closes SET status = 'reopened' WHERE firm_id = $1 AND client_id IS NOT DISTINCT FROM $2 AND period_end = $3`,
      [firmId, clientId ?? null, periodEnd],
    );
    return { id: '', firmId, clientId, periodEnd, closedAt: new Date(), closedByUserId: actorUserId, status: 'reopened' };
  }

  async isPeriodClosed(firmId: string, clientId: string | undefined, periodEnd: Date): Promise<boolean> {
    const [row] = await this.db.query<any>(
      `SELECT 1 FROM period_closes WHERE firm_id = $1 AND client_id IS NOT DISTINCT FROM $2 AND period_end = $3 AND status = 'closed'`,
      [firmId, clientId ?? null, periodEnd],
    );
    return !!row;
  }

  // Reconciliation
  async createReconciliation(input: Omit<Reconciliation, 'id' | 'createdAt' | 'updatedAt' | 'difference'>): Promise<Reconciliation> {
    const id = newId("rec");
    await this.db.query(
      `INSERT INTO reconciliations (id, firm_id, client_id, account_id, period_end, bank_balance, ledger_balance, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, input.firmId, input.clientId, input.accountId, input.periodEnd, input.bankBalance, input.ledgerBalance, 'open', input.notes ?? null],
    );
    const rec = await this.getReconciliation(input.firmId, input.clientId, input.accountId, input.periodEnd);
    if (!rec) throw new Error(`Reconciliation ${id} not found after creation`);
    return rec;
  }

  async getReconciliation(firmId: string, clientId: string, accountId: string, periodEnd: Date): Promise<Reconciliation | undefined> {
    const [row] = await this.db.query<any>(
      `SELECT * FROM reconciliations WHERE firm_id = $1 AND client_id = $2 AND account_id = $3 AND period_end = $4`,
      [firmId, clientId, accountId, periodEnd],
    );
    return row ? this.mapReconciliation(row) : undefined;
  }

  async listReconciliations(firmId: string, clientId: string, periodEnd?: Date): Promise<Reconciliation[]> {
    let sql = `SELECT * FROM reconciliations WHERE firm_id = $1 AND client_id = $2`;
    const params: any[] = [firmId, clientId];
    if (periodEnd) { sql += ` AND period_end = $3`; params.push(periodEnd); }
    sql += ` ORDER BY period_end DESC`;
    const rows = await this.db.query<any>(sql, params);
    return rows.map(this.mapReconciliation);
  }

  async updateReconciliation(firmId: string, reconciliationId: string, patch: Partial<Reconciliation>): Promise<Reconciliation> {
    const sets: string[] = [];
    const params: any[] = [reconciliationId, firmId];
    let idx = 3;
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined && key !== 'id' && key !== 'firmId' && key !== 'clientId' && key !== 'accountId' && key !== 'periodEnd' && key !== 'createdAt' && key !== 'updatedAt' && key !== 'difference') {
        const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        sets.push(`${col} = $${idx++}`);
        params.push(value);
      }
    }
    if (sets.length === 0) {
      const rec = await this.getReconciliation(firmId, '', '', new Date());
      if (!rec) throw new Error(`Reconciliation ${reconciliationId} not found`);
      return rec;
    }
    sets.push(`updated_at = NOW()`);
    await this.db.query(`UPDATE reconciliations SET ${sets.join(', ')} WHERE id = $1 AND firm_id = $2`, params);
    const [row] = await this.db.query<any>(`SELECT * FROM reconciliations WHERE id = $1`, [reconciliationId]);
    return this.mapReconciliation(row);
  }

  // System Accounts
  async getSystemAccount(firmId: string, key: string): Promise<Account | undefined> {
    const [row] = await this.db.query<any>(
      `SELECT a.* FROM accounts a JOIN system_accounts sa ON sa.account_id = a.id WHERE sa.firm_id = $1 AND sa.key = $2`,
      [firmId, key],
    );
    return row ? this.mapAccount(row) : undefined;
  }

  async setSystemAccount(firmId: string, key: string, accountId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO system_accounts (id, firm_id, key, account_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (firm_id, key) DO UPDATE SET account_id = EXCLUDED.account_id`,
      [newId("sysacc"), firmId, key, accountId],
    );
  }

  // Seeding
  async seedDefaultChartOfAccounts(firmId: string): Promise<Account[]> {
    const template = getDefaultChartOfAccountsTemplate();
    const created: Account[] = [];

    // First pass: create all accounts without parents
    for (const entry of template) {
      const existing = await this.getAccountByCode(firmId, entry.code);
      if (existing) { created.push(existing); continue; }
      const account = await this.createAccount(firmId, {
        code: entry.code,
        name: entry.name,
        type: entry.type,
        subtype: entry.subtype,
        parentId: undefined, // Will link in second pass
        isSystem: entry.isSystem ?? false,
        normalBalance: entry.normalBalance,
        description: entry.description,
        isActive: true,
        sortOrder: 0,
      });
      created.push(account);
    }

    // Second pass: link parents
    for (const entry of template) {
      if (entry.parentCode) {
        const child = await this.getAccountByCode(firmId, entry.code);
        const parent = await this.getAccountByCode(firmId, entry.parentCode);
        if (child && parent) {
          await this.updateAccount(firmId, child.id, { parentId: parent.id });
        }
      }
    }

    // Seed system_accounts mapping
    for (const sysKey of SYSTEM_ACCOUNT_KEYS) {
      const account = await this.getAccountByCode(firmId, this.getSystemAccountCode(sysKey));
      if (account) await this.setSystemAccount(firmId, sysKey, account.id);
    }

    return created;
  }

  private getSystemAccountCode(key: string): string {
    switch (key) {
      case 'retained_earnings': return '3100';
      case 'ar_control': return '1100';
      case 'ap_control': return '2000';
      case 'cash_undeposited_funds': return '1200';
      case 'sales_tax_payable': return '2100';
      case 'payroll_tax_payable': return '2200';
      default: return '';
    }
  }

  // Mappers
  private mapAccount(row: any): Account {
    return {
      id: row.id,
      firmId: row.firm_id,
      code: row.code,
      name: row.name,
      type: row.type,
      subtype: row.subtype,
      parentId: row.parent_id,
      isSystem: row.is_system,
      normalBalance: row.normal_balance,
      description: row.description,
      isActive: row.is_active,
      sortOrder: row.sort_order,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapJournal(row: any): Journal {
    return {
      id: row.id,
      firmId: row.firm_id,
      clientId: row.client_id,
      engagementId: row.engagement_id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      memo: row.memo,
      periodStart: new Date(row.period_start),
      periodEnd: new Date(row.period_end),
      postedAt: row.posted_at ? new Date(row.posted_at) : undefined,
      postedByUserId: row.posted_by_user_id,
      reversedJournalId: row.reversed_journal_id,
      status: row.status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      lines: [],
    };
  }

  private mapJournalLine(row: any): JournalLine {
    return {
      id: row.id,
      journalId: row.journal_id,
      accountId: row.account_id,
      description: row.description,
      debit: Number(row.debit),
      credit: Number(row.credit),
      currency: row.currency,
      exchangeRate: Number(row.exchange_rate),
      createdAt: new Date(row.created_at),
    };
  }

  private mapReconciliation(row: any): Reconciliation {
    return {
      id: row.id,
      firmId: row.firm_id,
      clientId: row.client_id,
      accountId: row.account_id,
      periodEnd: new Date(row.period_end),
      bankBalance: Number(row.bank_balance),
      ledgerBalance: Number(row.ledger_balance),
      difference: Number(row.difference),
      status: row.status,
      reconciledAt: row.reconciled_at ? new Date(row.reconciled_at) : undefined,
      reconciledByUserId: row.reconciled_by_user_id,
      notes: row.notes,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}