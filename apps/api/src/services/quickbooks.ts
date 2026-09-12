import type { Db } from "../db";
import { newId } from "../lib/id";

export interface QuickBooksConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: 'sandbox' | 'production';
}

export interface QuickBooksTokens {
  accessToken: string;
  refreshToken: string;
  realmId: string;
  expiresAt: Date;
  tokenType: string;
  xRefreshTokenExpiresIn?: number;
}

export interface QuickBooksCompanyInfo {
  id: string;
  companyName: string;
  legalName: string;
  email: string;
  address: any;
  country: string;
  fiscalYearStartMonth: string;
  taxYearMonth: string;
}

export interface QuickBooksAccount {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType: string;
  Classification: string;
  CurrentBalance: number;
  CurrencyRef: { value: string };
  Active: boolean;
  SubAccount: boolean;
  ParentRef?: { value: string };
  FullyQualifiedName: string;
}

export interface QuickBooksCustomer {
  Id: string;
  DisplayName: string;
  GivenName: string;
  FamilyName: string;
  CompanyName: string;
  PrimaryEmailAddr: { Address: string };
  PrimaryPhone: { FreeFormNumber: string };
  BillAddr: any;
  ShipAddr: any;
  Active: boolean;
  Balance: number;
  CurrencyRef: { value: string };
}

export interface QuickBooksVendor {
  Id: string;
  DisplayName: string;
  CompanyName: string;
  PrimaryEmailAddr: { Address: string };
  PrimaryPhone: { FreeFormNumber: string };
  BillAddr: any;
  Active: boolean;
  Balance: number;
  CurrencyRef: { value: string };
}

export interface QuickBooksInvoice {
  Id: string;
  DocNumber: string;
  CustomerRef: { value: string };
  TxnDate: string;
  DueDate: string;
  Line: QuickBooksInvoiceLine[];
  TotalAmt: number;
  Balance: number;
  Status: string;
  CurrencyRef: { value: string };
}

export interface QuickBooksInvoiceLine {
  Id: string;
  LineNum: number;
  Description: string;
  Amount: number;
  DetailType: string;
  SalesItemLineDetail?: {
    ItemRef: { value: string };
    UnitPrice: number;
    Qty: number;
    TaxCodeRef: { value: string };
  };
}

export interface QuickBooksBill {
  Id: string;
  DocNumber: string;
  VendorRef: { value: string };
  TxnDate: string;
  DueDate: string;
  Line: QuickBooksBillLine[];
  TotalAmt: number;
  Balance: number;
  CurrencyRef: { value: string };
}

export interface QuickBooksBillLine {
  Id: string;
  LineNum: number;
  Description: string;
  Amount: number;
  DetailType: string;
  AccountBasedExpenseLineDetail?: {
    AccountRef: { value: string };
    UnitPrice: number;
    Qty: number;
    TaxCodeRef: { value: string };
  };
}

export interface QuickBooksJournalEntry {
  Id: string;
  DocNumber: string;
  TxnDate: string;
  Line: QuickBooksJournalLine[];
  CurrencyRef: { value: string };
}

export interface QuickBooksJournalLine {
  Id: string;
  LineNum: number;
  Description: string;
  Amount: number;
  DetailType: string;
  JournalEntryLineDetail: {
    PostingType: 'Debit' | 'Credit';
    AccountRef: { value: string };
  };
}

export interface QuickBooksReportResponse {
  Header: {
    ReportName: string;
    Time: string;
    ReportBasis: string;
    StartPeriod: string;
    EndPeriod: string;
  };
  Rows: {
    Row: any[];
  };
}

export class QuickBooksClient {
  private config: QuickBooksConfig;
  private tokens: QuickBooksTokens | null = null;

  constructor(config: QuickBooksConfig) {
    this.config = config;
  }

  setTokens(tokens: QuickBooksTokens): void {
    this.tokens = tokens;
  }

  getTokens(): QuickBooksTokens | null {
    return this.tokens;
  }

  isTokenExpired(): boolean {
    if (!this.tokens) return true;
    return new Date() >= this.tokens.expiresAt;
  }

  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: 'com.intuit.quickbooks.accounting',
      response_type: 'code',
      state,
      access_type: 'offline',
    });
    const base = this.config.environment === 'sandbox'
      ? 'https://appcenter.intuit.com/connect/oauth2'
      : 'https://appcenter.intuit.com/connect/oauth2';
    return `${base}?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string): Promise<QuickBooksTokens> {
    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
    });

    const response = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${error}`);
    }

    const data: any = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      realmId: data.realmId,
      expiresAt: new Date(Date.now() + (data.expires_in * 1000)),
      tokenType: data.token_type,
      xRefreshTokenExpiresIn: data.x_refresh_token_expires_in,
    };
  }

  async refreshAccessToken(): Promise<QuickBooksTokens> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.tokens.refreshToken,
    });

    const response = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${response.status} ${error}`);
    }

    const data: any = await response.json();
    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      realmId: data.realmId,
      expiresAt: new Date(Date.now() + (data.expires_in * 1000)),
      tokenType: data.token_type,
      xRefreshTokenExpiresIn: data.x_refresh_token_expires_in,
    };
    return this.tokens;
  }

  private getBaseUrl(): string {
    return this.config.environment === 'sandbox'
      ? 'https://sandbox-quickbooks.api.intuit.com'
      : 'https://quickbooks.api.intuit.com';
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    if (!this.tokens) throw new Error('No tokens set. Call setTokens first.');
    if (this.isTokenExpired()) {
      await this.refreshAccessToken();
    }

    const url = `${this.getBaseUrl()}/v3/company/${this.tokens!.realmId}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.tokens!.accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (response.status === 401) {
      await this.refreshAccessToken();
      const retryResponse = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.tokens!.accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
      if (!retryResponse.ok) {
        const error = await retryResponse.text();
        throw new Error(`QBO API error after refresh: ${retryResponse.status} ${error}`);
      }
      return retryResponse.json();
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`QBO API error: ${response.status} ${error}`);
    }

    return response.json();
  }

  // Company Info
  async getCompanyInfo(): Promise<QuickBooksCompanyInfo> {
    const response = await this.request<any>('/companyinfo/' + this.tokens!.realmId);
    return response.QueryResponse.CompanyInfo[0];
  }

  // Accounts
  async getAccounts(): Promise<QuickBooksAccount[]> {
    const response = await this.request<any>('/query?query=SELECT * FROM Account WHERE Active = true');
    return response.QueryResponse.Account || [];
  }

  async getAccount(id: string): Promise<QuickBooksAccount | null> {
    const response = await this.request<any>(`/account/${id}`);
    return response.Account || null;
  }

  async createAccount(account: Partial<QuickBooksAccount>): Promise<QuickBooksAccount> {
    const response = await this.request<any>('/account', {
      method: 'POST',
      body: JSON.stringify(account),
    });
    return response.Account;
  }

  async updateAccount(account: QuickBooksAccount): Promise<QuickBooksAccount> {
    const response = await this.request<any>(`/account/${account.Id}`, {
      method: 'POST',
      body: JSON.stringify({
        ...account,
        sparse: true,
      }),
    });
    return response.Account;
  }

  // Customers
  async getCustomers(maxResults = 1000): Promise<QuickBooksCustomer[]> {
    let all: QuickBooksCustomer[] = [];
    let startPosition = 1;
    const maxPerRequest = 100;

    while (true) {
      const response = await this.request<any>(`/query?query=SELECT * FROM Customer WHERE Active = true STARTPOSITION ${startPosition} MAXRESULTS ${maxPerRequest}`);
      const customers = response.QueryResponse.Customer || [];
      all.push(...customers);
      if (customers.length < maxPerRequest) break;
      startPosition += maxPerRequest;
      if (all.length >= maxResults) break;
    }
    return all;
  }

  async getCustomer(id: string): Promise<QuickBooksCustomer | null> {
    const response = await this.request<any>(`/customer/${id}`);
    return response.Customer || null;
  }

  async createCustomer(customer: Partial<QuickBooksCustomer>): Promise<QuickBooksCustomer> {
    const response = await this.request<any>('/customer', {
      method: 'POST',
      body: JSON.stringify(customer),
    });
    return response.Customer;
  }

  async updateCustomer(customer: QuickBooksCustomer): Promise<QuickBooksCustomer> {
    const response = await this.request<any>(`/customer/${customer.Id}`, {
      method: 'POST',
      body: JSON.stringify({ ...customer, sparse: true }),
    });
    return response.Customer;
  }

  // Vendors
  async getVendors(maxResults = 1000): Promise<QuickBooksVendor[]> {
    let all: QuickBooksVendor[] = [];
    let startPosition = 1;
    const maxPerRequest = 100;

    while (true) {
      const response = await this.request<any>(`/query?query=SELECT * FROM Vendor WHERE Active = true STARTPOSITION ${startPosition} MAXRESULTS ${maxPerRequest}`);
      const vendors = response.QueryResponse.Vendor || [];
      all.push(...vendors);
      if (vendors.length < maxPerRequest) break;
      startPosition += maxPerRequest;
      if (all.length >= maxResults) break;
    }
    return all;
  }

  async getVendor(id: string): Promise<QuickBooksVendor | null> {
    const response = await this.request<any>(`/vendor/${id}`);
    return response.Vendor || null;
  }

  async createVendor(vendor: Partial<QuickBooksVendor>): Promise<QuickBooksVendor> {
    const response = await this.request<any>('/vendor', {
      method: 'POST',
      body: JSON.stringify(vendor),
    });
    return response.Vendor;
  }

  async updateVendor(vendor: QuickBooksVendor): Promise<QuickBooksVendor> {
    const response = await this.request<any>(`/vendor/${vendor.Id}`, {
      method: 'POST',
      body: JSON.stringify({ ...vendor, sparse: true }),
    });
    return response.Vendor;
  }

  // Invoices
  async getInvoices(maxResults = 500): Promise<QuickBooksInvoice[]> {
    let all: QuickBooksInvoice[] = [];
    let startPosition = 1;
    const maxPerRequest = 100;

    while (true) {
      const response = await this.request<any>(`/query?query=SELECT * FROM Invoice STARTPOSITION ${startPosition} MAXRESULTS ${maxPerRequest}`);
      const invoices = response.QueryResponse.Invoice || [];
      all.push(...invoices);
      if (invoices.length < maxPerRequest) break;
      startPosition += maxPerRequest;
      if (all.length >= maxResults) break;
    }
    return all;
  }

  async getInvoice(id: string): Promise<QuickBooksInvoice | null> {
    const response = await this.request<any>(`/invoice/${id}`);
    return response.Invoice || null;
  }

  async createInvoice(invoice: Partial<QuickBooksInvoice>): Promise<QuickBooksInvoice> {
    const response = await this.request<any>('/invoice', {
      method: 'POST',
      body: JSON.stringify(invoice),
    });
    return response.Invoice;
  }

  async updateInvoice(invoice: QuickBooksInvoice): Promise<QuickBooksInvoice> {
    const response = await this.request<any>(`/invoice/${invoice.Id}`, {
      method: 'POST',
      body: JSON.stringify({ ...invoice, sparse: true }),
    });
    return response.Invoice;
  }

  // Bills
  async getBills(maxResults = 500): Promise<QuickBooksBill[]> {
    let all: QuickBooksBill[] = [];
    let startPosition = 1;
    const maxPerRequest = 100;

    while (true) {
      const response = await this.request<any>(`/query?query=SELECT * FROM Bill STARTPOSITION ${startPosition} MAXRESULTS ${maxPerRequest}`);
      const bills = response.QueryResponse.Bill || [];
      all.push(...bills);
      if (bills.length < maxPerRequest) break;
      startPosition += maxPerRequest;
      if (all.length >= maxResults) break;
    }
    return all;
  }

  async getBill(id: string): Promise<QuickBooksBill | null> {
    const response = await this.request<any>(`/bill/${id}`);
    return response.Bill || null;
  }

  async createBill(bill: Partial<QuickBooksBill>): Promise<QuickBooksBill> {
    const response = await this.request<any>('/bill', {
      method: 'POST',
      body: JSON.stringify(bill),
    });
    return response.Bill;
  }

  async updateBill(bill: QuickBooksBill): Promise<QuickBooksBill> {
    const response = await this.request<any>(`/bill/${bill.Id}`, {
      method: 'POST',
      body: JSON.stringify({ ...bill, sparse: true }),
    });
    return response.Bill;
  }

  // Journal Entries
  async getJournalEntries(maxResults = 500): Promise<QuickBooksJournalEntry[]> {
    let all: QuickBooksJournalEntry[] = [];
    let startPosition = 1;
    const maxPerRequest = 100;

    while (true) {
      const response = await this.request<any>(`/query?query=SELECT * FROM JournalEntry STARTPOSITION ${startPosition} MAXRESULTS ${maxPerRequest}`);
      const entries = response.QueryResponse.JournalEntry || [];
      all.push(...entries);
      if (entries.length < maxPerRequest) break;
      startPosition += maxPerRequest;
      if (all.length >= maxResults) break;
    }
    return all;
  }

  async getJournalEntry(id: string): Promise<QuickBooksJournalEntry | null> {
    const response = await this.request<any>(`/journalentry/${id}`);
    return response.JournalEntry || null;
  }

  async createJournalEntry(entry: Partial<QuickBooksJournalEntry>): Promise<QuickBooksJournalEntry> {
    const response = await this.request<any>('/journalentry', {
      method: 'POST',
      body: JSON.stringify(entry),
    });
    return response.JournalEntry;
  }

  // Reports
  async getProfitAndLoss(startDate: string, endDate: string): Promise<QuickBooksReportResponse> {
    return this.request<any>(`/reports/ProfitAndLoss?start_date=${startDate}&end_date=${endDate}&summarize_column_by=Month`);
  }

  async getBalanceSheet(date: string): Promise<QuickBooksReportResponse> {
    return this.request<any>(`/reports/BalanceSheet?date_macro=${date}`);
  }

  async getTrialBalance(date: string): Promise<QuickBooksReportResponse> {
    return this.request<any>(`/reports/TrialBalance?date_macro=${date}`);
  }

  // Batch operations (limited to 30 entities per request, 40 requests/minute)
  async batchCreate(entities: { operation: 'create' | 'update' | 'delete'; entity: string; data: any }[]): Promise<any> {
    return this.request<any>('/batch', {
      method: 'POST',
      body: JSON.stringify({ BatchItemRequest: entities.map((e, i) => ({
        bId: `bid${i}`,
        operation: e.operation,
        [e.entity]: e.data,
      })) }),
    });
  }
}

export class QuickBooksTokenStore {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async saveTokens(firmId: string, tokens: QuickBooksTokens): Promise<void> {
    await this.db.query(
      `INSERT INTO quickbooks_tokens (id, firm_id, access_token, refresh_token, realm_id, expires_at, token_type, x_refresh_token_expires_in)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (firm_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         realm_id = EXCLUDED.realm_id,
         expires_at = EXCLUDED.expires_at,
         token_type = EXCLUDED.token_type,
         x_refresh_token_expires_in = EXCLUDED.x_refresh_token_expires_in,
         updated_at = NOW()`,
      [newId("qbt"), firmId, tokens.accessToken, tokens.refreshToken, tokens.realmId,
       tokens.expiresAt.toISOString(), tokens.tokenType, tokens.xRefreshTokenExpiresIn ?? null],
    );
  }

  async getTokens(firmId: string): Promise<QuickBooksTokens | null> {
    const [row] = await this.db.query<any>(
      `SELECT * FROM quickbooks_tokens WHERE firm_id = $1`,
      [firmId],
    );
    if (!row) return null;
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      realmId: row.realm_id,
      expiresAt: new Date(row.expires_at),
      tokenType: row.token_type,
      xRefreshTokenExpiresIn: row.x_refresh_token_expires_in,
    };
  }

  async deleteTokens(firmId: string): Promise<void> {
    await this.db.query(`DELETE FROM quickbooks_tokens WHERE firm_id = $1`, [firmId]);
  }
}

export interface QuickBooksSyncCursor {
  entityType: string;
  lastSync: Date;
  lastChangeId?: string;
}

export class QuickBooksSyncCursorStore {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async saveCursor(firmId: string, cursor: QuickBooksSyncCursor): Promise<void> {
    await this.db.query(
      `INSERT INTO quickbooks_sync_cursors (id, firm_id, entity_type, last_sync, last_change_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (firm_id, entity_type) DO UPDATE SET
         last_sync = EXCLUDED.last_sync,
         last_change_id = EXCLUDED.last_change_id,
         updated_at = NOW()`,
      [newId("qbs"), firmId, cursor.entityType, cursor.lastSync.toISOString(), cursor.lastChangeId ?? null],
    );
  }

  async getCursor(firmId: string, entityType: string): Promise<QuickBooksSyncCursor | null> {
    const [row] = await this.db.query<any>(
      `SELECT * FROM quickbooks_sync_cursors WHERE firm_id = $1 AND entity_type = $2`,
      [firmId, entityType],
    );
    if (!row) return null;
    return {
      entityType: row.entity_type,
      lastSync: new Date(row.last_sync),
      lastChangeId: row.last_change_id,
    };
  }
}

export interface QuickBooksAccountMapping {
  folioAccountId: string;
  qboAccountId: string;
  mappingType: 'direct' | 'category' | 'default';
}

export class QuickBooksAccountMappingStore {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async saveMapping(firmId: string, mapping: QuickBooksAccountMapping): Promise<void> {
    await this.db.query(
      `INSERT INTO quickbooks_account_mappings (id, firm_id, folio_account_id, qbo_account_id, mapping_type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (firm_id, folio_account_id) DO UPDATE SET
         qbo_account_id = EXCLUDED.qbo_account_id,
         mapping_type = EXCLUDED.mapping_type,
         updated_at = NOW()`,
      [newId("qam"), firmId, mapping.folioAccountId, mapping.qboAccountId, mapping.mappingType],
    );
  }

  async getMapping(firmId: string, folioAccountId: string): Promise<QuickBooksAccountMapping | null> {
    const [row] = await this.db.query<any>(
      `SELECT * FROM quickbooks_account_mappings WHERE firm_id = $1 AND folio_account_id = $2`,
      [firmId, folioAccountId],
    );
    if (!row) return null;
    return {
      folioAccountId: row.folio_account_id,
      qboAccountId: row.qbo_account_id,
      mappingType: row.mapping_type,
    };
  }

  async getAllMappings(firmId: string): Promise<QuickBooksAccountMapping[]> {
    const rows = await this.db.query<any>(
      `SELECT * FROM quickbooks_account_mappings WHERE firm_id = $1`,
      [firmId],
    );
    return rows.map(r => ({
      folioAccountId: r.folio_account_id,
      qboAccountId: r.qbo_account_id,
      mappingType: r.mapping_type,
    }));
  }
}

export interface QuickBooksSyncConflict {
  id: string;
  firmId: string;
  entityType: string;
  qboEntityId: string;
  folioEntityId?: string;
  conflictType: 'update_update' | 'delete_update' | 'update_delete' | 'create_create';
  qboVersion: string;
  folioData: any;
  qboData: any;
  status: 'pending' | 'resolved_folio_wins' | 'resolved_qbo_wins' | 'merged';
  resolvedAt?: Date;
  resolvedByUserId?: string;
  createdAt: Date;
}

export class QuickBooksSyncConflictStore {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async saveConflict(conflict: Omit<QuickBooksSyncConflict, 'id' | 'createdAt'>): Promise<QuickBooksSyncConflict> {
    const id = newId("qbc");
    await this.db.query(
      `INSERT INTO quickbooks_sync_conflicts (id, firm_id, entity_type, qbo_entity_id, folio_entity_id, conflict_type, qbo_version, folio_data, qbo_data, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, 'pending')`,
      [id, conflict.firmId, conflict.entityType, conflict.qboEntityId, conflict.folioEntityId ?? null,
       conflict.conflictType, conflict.qboVersion, conflict.folioData, conflict.qboData],
    );
    return { ...conflict, id, createdAt: new Date() };
  }

  async getConflict(id: string): Promise<QuickBooksSyncConflict | null> {
    const [row] = await this.db.query<any>(
      `SELECT * FROM quickbooks_sync_conflicts WHERE id = $1`,
      [id],
    );
    if (!row) return null;
    return {
      id: row.id,
      firmId: row.firm_id,
      entityType: row.entity_type,
      qboEntityId: row.qbo_entity_id,
      folioEntityId: row.folio_entity_id,
      conflictType: row.conflict_type,
      qboVersion: row.qbo_version,
      folioData: row.folio_data,
      qboData: row.qbo_data,
      status: row.status,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
      resolvedByUserId: row.resolved_by_user_id,
      createdAt: new Date(row.created_at),
    };
  }

  async getPendingConflicts(firmId: string): Promise<QuickBooksSyncConflict[]> {
    const rows = await this.db.query<any>(
      `SELECT * FROM quickbooks_sync_conflicts WHERE firm_id = $1 AND status = 'pending' ORDER BY created_at`,
      [firmId],
    );
    return rows.map(r => ({
      id: r.id,
      firmId: r.firm_id,
      entityType: r.entity_type,
      qboEntityId: r.qbo_entity_id,
      folioEntityId: r.folio_entity_id,
      conflictType: r.conflict_type,
      qboVersion: r.qbo_version,
      folioData: r.folio_data,
      qboData: r.qbo_data,
      status: r.status,
      resolvedAt: r.resolved_at ? new Date(r.resolved_at) : undefined,
      resolvedByUserId: r.resolved_by_user_id,
      createdAt: new Date(r.created_at),
    }));
  }

  async resolveConflict(id: string, resolution: 'folio_wins' | 'qbo_wins' | 'merged', actorUserId: string, mergedData?: any): Promise<void> {
    const [conflict] = await this.db.query<any>(
      `SELECT * FROM quickbooks_sync_conflicts WHERE id = $1`,
      [id],
    );
    if (!conflict) throw new Error('Conflict not found');

    const resolvedAt = new Date();
    await this.db.query(
      `UPDATE quickbooks_sync_conflicts SET status = $1, resolved_at = $2, resolved_by_user_id = $3, folio_data = $4 WHERE id = $5`,
      [resolution === 'folio_wins' ? 'resolved_folio_wins' : resolution === 'qbo_wins' ? 'resolved_qbo_wins' : 'merged',
       resolvedAt, actorUserId, mergedData ? JSON.stringify(mergedData) : conflict.folio_data, id],
    );
  }
}