/**
 * AccountingProvider: canonical interface for chart of accounts, journals,
 * trial balance, balance sheet, period close, reconciliation.
 * Implementations: FolioNativeAccountingProvider (Milestone 2), QuickBooksOnlineAccountingProvider (Milestone 3).
 * A firm picks one active provider; Folio's domain model stays canonical.
 */

export interface Account {
  id: string;
  firmId: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  subtype?: string;
  parentId?: string;
  isSystem: boolean;
  normalBalance: 'debit' | 'credit';
  description?: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Journal {
  id: string;
  firmId: string;
  clientId?: string;
  engagementId?: string;
  sourceType: string;
  sourceId?: string;
  memo?: string;
  periodStart: Date;
  periodEnd: Date;
  postedAt?: Date;
  postedByUserId?: string;
  reversedJournalId?: string;
  status: 'draft' | 'posted' | 'reversed';
  createdAt: Date;
  updatedAt: Date;
  lines?: JournalLine[];
}

export interface JournalLine {
  id: string;
  journalId: string;
  accountId: string;
  description?: string;
  debit: number;
  credit: number;
  currency: string;
  exchangeRate: number;
  createdAt: Date;
}

export interface TrialBalanceEntry {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debitBalance: number;
  creditBalance: number;
  netBalance: number;
}

export interface BalanceSheetEntry {
  accountId: string;
  code: string;
  name: string;
  type: string;
  balance: number;
}

export interface Reconciliation {
  id: string;
  firmId: string;
  clientId: string;
  accountId: string;
  periodEnd: Date;
  bankBalance: number;
  ledgerBalance: number;
  difference: number;
  status: 'open' | 'reconciled' | 'investigating';
  reconciledAt?: Date;
  reconciledByUserId?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PeriodClose {
  id: string;
  firmId: string;
  clientId?: string;
  periodEnd: Date;
  closedAt: Date;
  closedByUserId: string;
  status: 'closed' | 'reopened';
}

export interface SystemAccountKey {
  key: string;
  accountId: string;
}

export interface ChartOfAccountsSeedEntry {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  subtype?: string;
  normalBalance: 'debit' | 'credit';
  isSystem?: boolean;
  parentCode?: string;
  description?: string;
}

export interface AccountingProvider {
  // Chart of Accounts
  getAccount(firmId: string, accountId: string): Promise<Account | undefined>;
  getAccountByCode(firmId: string, code: string): Promise<Account | undefined>;
  listAccounts(firmId: string, type?: string): Promise<Account[]>;
  createAccount(firmId: string, input: Omit<Account, 'id' | 'firmId' | 'createdAt' | 'updatedAt'>): Promise<Account>;
  updateAccount(firmId: string, accountId: string, patch: Partial<Account>): Promise<Account>;
  deleteAccount(firmId: string, accountId: string): Promise<void>;

  // Journals
  createJournal(firmId: string, input: Omit<Journal, 'id' | 'createdAt' | 'updatedAt' | 'lines'> & { lines: Omit<JournalLine, 'id' | 'createdAt' | 'journalId'>[] }): Promise<Journal>;
  getJournal(firmId: string, journalId: string): Promise<Journal | undefined>;
  listJournals(firmId: string, filters?: { clientId?: string; status?: string; periodStart?: Date; periodEnd?: Date }): Promise<Journal[]>;
  postJournal(firmId: string, journalId: string, actorUserId: string): Promise<Journal>;
  reverseJournal(firmId: string, journalId: string, actorUserId: string, memo: string): Promise<Journal>;

  // Trial Balance & Balance Sheet
  getTrialBalance(firmId: string, clientId: string | undefined, periodEnd: Date): Promise<TrialBalanceEntry[]>;
  getBalanceSheet(firmId: string, clientId: string | undefined, periodEnd: Date): Promise<{ assets: BalanceSheetEntry[]; liabilities: BalanceSheetEntry[]; equity: BalanceSheetEntry[] }>;

  // Period Close
  closePeriod(firmId: string, clientId: string | undefined, periodEnd: Date, actorUserId: string): Promise<PeriodClose>;
  reopenPeriod(firmId: string, clientId: string | undefined, periodEnd: Date, actorUserId: string): Promise<PeriodClose>;
  isPeriodClosed(firmId: string, clientId: string | undefined, periodEnd: Date): Promise<boolean>;

  // Reconciliation
  createReconciliation(input: Omit<Reconciliation, 'id' | 'createdAt' | 'updatedAt' | 'difference'>): Promise<Reconciliation>;
  getReconciliation(firmId: string, clientId: string, accountId: string, periodEnd: Date): Promise<Reconciliation | undefined>;
  listReconciliations(firmId: string, clientId: string, periodEnd?: Date): Promise<Reconciliation[]>;
  updateReconciliation(firmId: string, reconciliationId: string, patch: Partial<Reconciliation>): Promise<Reconciliation>;

  // System Accounts
  getSystemAccount(firmId: string, key: string): Promise<Account | undefined>;
  setSystemAccount(firmId: string, key: string, accountId: string): Promise<void>;

  // Chart of Accounts Seeding
  seedDefaultChartOfAccounts(firmId: string): Promise<Account[]>;
  getDefaultChartOfAccountsTemplate(): ChartOfAccountsSeedEntry[];
}

export type AccountingProviderType = 'folio_native' | 'quickbooks_online';