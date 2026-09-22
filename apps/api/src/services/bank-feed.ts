import type { Db } from "../db";

export interface BankConnection {
  id: string;
  firmId: string;
  clientId?: string; // nullable: firm-level connections
  provider: 'plaid' | 'finicity' | 'mx' | 'akoya' | 'teller';
  providerConnectionId: string; // Plaid's access_token, Finicity's accountId, etc.
  providerItemId?: string;
  institutionId: string;
  institutionName: string;
  institutionLogo?: string;
  status: 'active' | 'needs_reauth' | 'error' | 'disconnected';
  lastSyncAt?: Date;
  lastSuccessfulSyncAt?: Date;
  errorMessage?: string;
  accounts: BankAccount[];
  createdAt: Date;
  updatedAt: Date;
}

export interface BankAccount {
  id: string;
  providerAccountId: string;
  name: string;
  officialName?: string;
  type: 'checking' | 'savings' | 'credit' | 'investment' | 'loan' | 'other';
  subtype: string;
  mask?: string;
  currentBalance: number;
  availableBalance?: number;
  currency: string;
  status: 'active' | 'inactive' | 'closed';
  isVisible: boolean;
  createdAt: Date;
  updatedAt: Date;
  connectionId?: string; // optional: set by service when upserting
}

export interface BankTransaction {
  id: string;
  connectionId: string;
  accountId: string;
  providerTransactionId: string;
  date: string; // YYYY-MM-DD
  authorizedDate?: string;
  description: string;
  merchantName?: string;
  amount: number; // positive = money out (debit), negative = money in (credit)
  currency: string;
  category?: string[];
  categoryId?: string;
  pending: boolean;
  rawCategory?: string;
  location?: {
    address?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface BankFeedSyncResult {
  newTransactions: number;
  updatedTransactions: number;
  removedTransactions: number;
  errors: string[];
}

export interface BankFeedProvider {
  readonly providerName: 'plaid' | 'finicity' | 'mx' | 'akoya' | 'teller';
  readonly supportedInstitutionsUrl: string; // URL to fetch institution list

  // OAuth / Link flow
  createLinkToken(config: {
    firmId: string;
    clientId?: string;
    userId: string;
    clientName: string;
    products: ('transactions' | 'auth' | 'identity' | 'balance' | 'assets' | 'investments' | 'liabilities')[];
    countryCodes: string[];
    language: string;
    redirectUri?: string;
    webhookUrl?: string;
  }): Promise<{ linkToken: string; expiration: Date }>;

  exchangePublicToken(publicToken: string): Promise<{
    accessToken: string;
    itemId: string;
    accounts: ProviderAccount[];
  }>;

  // Account management
  getAccounts(accessToken: string): Promise<ProviderAccount[]>;
  getBalance(accessToken: string, accountIds: string[]): Promise<ProviderBalance[]>;

  // Transaction sync
  syncTransactions(accessToken: string, cursor?: string, options?: {
    startDate?: string; // YYYY-MM-DD
    endDate?: string;
    accountIds?: string[];
    count?: number;
  }): Promise<{
    transactions: ProviderTransaction[];
    nextCursor?: string;
    hasMore: boolean;
  }>;

  // Connection management
  refreshConnection(accessToken: string): Promise<{ success: boolean; newAccessToken?: string; error?: string }>;
  removeConnection(accessToken: string): Promise<void>;

  // Institution search
  searchInstitutions(query: string, countryCodes: string[], products: string[]): Promise<ProviderInstitution[]>;
  getInstitution(institutionId: string): Promise<ProviderInstitution | null>;
}

export interface ProviderAccount {
  providerAccountId: string;
  name: string;
  officialName?: string;
  type: 'checking' | 'savings' | 'credit' | 'investment' | 'loan' | 'other';
  subtype: string;
  mask?: string;
  currentBalance: number;
  availableBalance?: number;
  currency: string;
  status: 'active' | 'inactive' | 'closed';
}

export interface ProviderBalance {
  accountId: string;
  current: number;
  available?: number;
  currency: string;
  asOfDate: string;
}

export interface ProviderTransaction {
  providerTransactionId: string;
  accountId: string;
  date: string; // YYYY-MM-DD
  authorizedDate?: string;
  description: string;
  merchantName?: string;
  amount: number;
  currency: string;
  category?: string[];
  categoryId?: string;
  pending: boolean;
  rawCategory?: string;
  location?: {
    address?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  };
  providerMetadata?: Record<string, any>;
}

export interface ProviderInstitution {
  institutionId: string;
  name: string;
  logo?: string;
  primaryColor?: string;
  url?: string;
  countryCodes: string[];
  products: string[];
  routingNumbers?: string[];
}

export interface BankFeedSyncCursor {
  connectionId: string;
  accountId: string;
  cursor: string; // provider-specific cursor (Plaid's cursor, Finicity's lastTransactionId, etc.)
  lastSyncAt: Date;
  lastSuccessfulSyncAt?: Date;
}

// Service for managing bank connections
export class BankConnectionService {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async createConnection(connection: Omit<BankConnection, 'id' | 'createdAt' | 'updatedAt'>): Promise<BankConnection> {
    const id = newId("bnk");
    const now = new Date();
    const providerConnectionId = await encryptToken(connection.providerConnectionId, this.db);
    await this.db.query(
      `INSERT INTO bank_connections (id, firm_id, client_id, provider, provider_connection_id, provider_item_id, institution_id, institution_name, institution_logo, status, last_sync_at, last_successful_sync_at, error_message, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())`,
      [id, connection.firmId, connection.clientId ?? null, connection.provider, providerConnectionId, connection.providerItemId ?? null,
       connection.institutionId, connection.institutionName, connection.institutionLogo ?? null,
       connection.status, connection.lastSyncAt?.toISOString() ?? null,
       connection.lastSuccessfulSyncAt?.toISOString() ?? null, connection.errorMessage ?? null],
    );
    const decrypted = await decryptToken(providerConnectionId, this.db);
    return { ...connection, id, providerConnectionId: decrypted, createdAt: new Date(), updatedAt: new Date() };
  }

  async getConnection(id: string): Promise<BankConnection | null> {
    const [row] = await this.db.query<any>(
      `SELECT * FROM bank_connections WHERE id = $1`,
      [id],
    );
    return row ? this.mapConnection(row) : null;
  }

  async getConnectionsByFirm(firmId: string): Promise<BankConnection[]> {
    const rows = await this.db.query<any>(
      `SELECT * FROM bank_connections WHERE firm_id = $1 ORDER BY created_at DESC`,
      [firmId],
    );
    return Promise.all(rows.map(async (row) => await this.mapConnection(row)));
  }

  async getConnectionsByClient(clientId: string): Promise<BankConnection[]> {
    const rows = await this.db.query<any>(
      `SELECT * FROM bank_connections WHERE client_id = $1 ORDER BY created_at DESC`,
      [clientId],
    );
    return Promise.all(rows.map(async (row) => await this.mapConnection(row)));
  }

  async updateConnection(id: string, patch: Partial<BankConnection>): Promise<BankConnection | null> {
    const sets: string[] = [];
    const params: any[] = [id];
    let idx = 2;
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined && key !== 'id' && key !== 'createdAt') {
        const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        let val = value;
        if (key === 'providerConnectionId') {
          val = await encryptToken(value as string, this.db);
        }
        sets.push(`${col} = $${idx++}`);
        params.push(val instanceof Date ? val.toISOString() : val);
      }
    }
    if (sets.length === 0) return this.getConnection(id);
    sets.push(`updated_at = NOW()`);
    await this.db.query(
      `UPDATE bank_connections SET ${sets.join(', ')} WHERE id = $1`,
      params,
    );
    return this.getConnection(id);
  }

  async deleteConnection(id: string): Promise<void> {
    await this.db.query(`DELETE FROM bank_connections WHERE id = $1`, [id]);
  }

  private async mapConnection(row: any): Promise<BankConnection> {
    const decryptedId = await decryptToken(row.provider_connection_id, this.db);
    return {
      id: row.id,
      firmId: row.firm_id,
      clientId: row.client_id,
      provider: row.provider,
      providerConnectionId: decryptedId,
      providerItemId: row.provider_item_id ?? undefined,
      institutionId: row.institution_id,
      institutionName: row.institution_name,
      institutionLogo: row.institution_logo,
      status: row.status,
      lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at) : undefined,
      lastSuccessfulSyncAt: row.last_successful_sync_at ? new Date(row.last_successful_sync_at) : undefined,
      errorMessage: row.error_message,
      accounts: row.accounts ? JSON.parse(row.accounts) : [],
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

// Account management
export class BankAccountService {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async upsertAccounts(connectionId: string, accounts: Omit<BankAccount, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<BankAccount[]> {
    const results: BankAccount[] = [];
    for (const account of accounts) {
      const [row] = await this.db.query<any>(
        `INSERT INTO bank_accounts (id, connection_id, provider_account_id, name, official_name, type, subtype, mask, current_balance, available_balance, currency, status, is_visible)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (connection_id, provider_account_id) DO UPDATE SET
           name = EXCLUDED.name,
           official_name = EXCLUDED.official_name,
           type = EXCLUDED.type,
           subtype = EXCLUDED.subtype,
           mask = EXCLUDED.mask,
           current_balance = EXCLUDED.current_balance,
           available_balance = EXCLUDED.available_balance,
           currency = EXCLUDED.currency,
           status = EXCLUDED.status,
           is_visible = EXCLUDED.is_visible,
           updated_at = NOW()
         RETURNING *`,
        [newId("bac"), connectionId, account.providerAccountId, account.name, account.officialName ?? null,
         account.type, account.subtype, account.mask ?? null, account.currentBalance,
         account.availableBalance ?? null, account.currency, account.status, account.isVisible],
      );
      results.push(this.mapAccount(row));
    }
    return results;
  }

  async getAccountsByConnection(connectionId: string): Promise<BankAccount[]> {
    const rows = await this.db.query<any>(
      `SELECT * FROM bank_accounts WHERE connection_id = $1 ORDER BY created_at`,
      [connectionId],
    );
    return rows.map(this.mapAccount);
  }

  async getAccount(id: string): Promise<BankAccount | null> {
    const [row] = await this.db.query<any>(`SELECT * FROM bank_accounts WHERE id = $1`, [id]);
    return row ? this.mapAccount(row) : null;
  }

  async getAccountForFirm(id: string, firmId: string): Promise<BankAccount | null> {
    const [row] = await this.db.query<any>(
      `SELECT a.* FROM bank_accounts a
       JOIN bank_connections c ON c.id = a.connection_id
       WHERE a.id = $1 AND c.firm_id = $2`,
      [id, firmId],
    );
    return row ? this.mapAccount(row) : null;
  }

  async updateAccount(id: string, patch: Partial<BankAccount>): Promise<BankAccount | null> {
    const allowed: Array<[keyof BankAccount, string]> = [
      ["isVisible", "is_visible"],
      ["status", "status"],
      ["name", "name"],
    ];
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [key, column] of allowed) {
      if (patch[key] !== undefined) {
        sets.push(`${column} = $${params.length + 1}`);
        params.push(patch[key]);
      }
    }
    if (!sets.length) return this.getAccount(id);
    sets.push("updated_at = NOW()");
    const [row] = await this.db.query<any>(
      `UPDATE bank_accounts SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
      params,
    );
    return row ? this.mapAccount(row) : null;
  }

  private mapAccount(row: any): BankAccount {
    return {
      id: row.id,
      connectionId: row.connection_id,
      providerAccountId: row.provider_account_id,
      name: row.name,
      officialName: row.official_name,
      type: row.type,
      subtype: row.subtype,
      mask: row.mask,
      currentBalance: Number(row.current_balance),
      availableBalance: row.available_balance ? Number(row.available_balance) : undefined,
      currency: row.currency,
      status: row.status,
      isVisible: row.is_visible,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

// Transaction sync
export class BankTransactionService {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async upsertTransactions(connectionId: string, transactions: Omit<BankTransaction, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<{ inserted: number; updated: number; removed: number }> {
    let inserted = 0;
    let updated = 0;

    for (const txn of transactions) {
      const [row] = await this.db.query<any>(
        `INSERT INTO bank_transactions_external (id, connection_id, account_id, provider_transaction_id, date, authorized_date, description, merchant_name, amount, currency, category, category_id, pending, raw_category, location)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (connection_id, provider_transaction_id) DO UPDATE SET
           date = EXCLUDED.date,
           authorized_date = EXCLUDED.authorized_date,
           description = EXCLUDED.description,
           merchant_name = EXCLUDED.merchant_name,
           amount = EXCLUDED.amount,
           currency = EXCLUDED.currency,
           category = EXCLUDED.category,
           category_id = EXCLUDED.category_id,
           pending = EXCLUDED.pending,
           raw_category = EXCLUDED.raw_category,
           location = EXCLUDED.location,
           updated_at = NOW()
         RETURNING (xmax = 0) AS inserted`,
        [newId("btx"), connectionId, txn.accountId, txn.providerTransactionId, txn.date,
         txn.authorizedDate ?? null, txn.description, txn.merchantName ?? null, txn.amount,
         txn.currency, txn.category ?? null, txn.categoryId ?? null, txn.pending,
         txn.rawCategory ?? null, txn.location ? JSON.stringify(txn.location) : null],
      );
      if (row.inserted) inserted++; else updated++;
    }
    return { inserted, updated, removed: 0 };
  }

  async getTransactions(connectionId: string, options?: {
    accountId?: string;
    startDate?: string;
    endDate?: string;
    pending?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<BankTransaction[]> {
    let sql = `SELECT * FROM bank_transactions_external WHERE connection_id = $1`;
    const params: any[] = [connectionId];
    let idx = 2;

    if (options?.accountId) { sql += ` AND account_id = $${idx++}`; params.push(options.accountId); }
    if (options?.startDate) { sql += ` AND date >= $${idx++}`; params.push(options.startDate); }
    if (options?.endDate) { sql += ` AND date <= $${idx++}`; params.push(options.endDate); }
    if (options?.pending !== undefined) { sql += ` AND pending = $${idx++}`; params.push(options.pending); }
    sql += ` ORDER BY date DESC, created_at DESC`;
    if (options?.limit) { sql += ` LIMIT $${idx++}`; params.push(options.limit); }
    if (options?.offset) { sql += ` OFFSET $${idx++}`; params.push(options.offset); }

    const rows = await this.db.query<any>(sql, params);
    return rows.map(this.mapTransaction);
  }

  private mapTransaction(row: any): BankTransaction {
    return {
      id: row.id,
      connectionId: row.connection_id,
      accountId: row.account_id,
      providerTransactionId: row.provider_transaction_id,
      date: row.date,
      authorizedDate: row.authorized_date,
      description: row.description,
      merchantName: row.merchant_name,
      amount: Number(row.amount),
      currency: row.currency,
      category: row.category,
      categoryId: row.category_id,
      pending: row.pending,
      rawCategory: row.raw_category,
      location: row.location ? JSON.parse(row.location) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

// Sync cursor management
export class BankSyncCursorService {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async getCursor(connectionId: string, accountId: string): Promise<BankFeedSyncCursor | null> {
    const [row] = await this.db.query<any>(
      `SELECT * FROM bank_sync_cursors WHERE connection_id = $1 AND account_id = $2`,
      [connectionId, accountId],
    );
    if (!row) return null;
    return {
      connectionId: row.connection_id,
      accountId: row.account_id,
      cursor: row.cursor,
      lastSyncAt: new Date(row.last_sync_at),
      lastSuccessfulSyncAt: row.last_successful_sync_at ? new Date(row.last_successful_sync_at) : undefined,
    };
  }

  async saveCursor(cursor: BankFeedSyncCursor): Promise<void> {
    await this.db.query(
      `INSERT INTO bank_sync_cursors (id, connection_id, account_id, cursor, last_sync_at, last_successful_sync_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (connection_id, account_id) DO UPDATE SET
         cursor = EXCLUDED.cursor,
         last_sync_at = EXCLUDED.last_sync_at,
         last_successful_sync_at = EXCLUDED.last_successful_sync_at,
         updated_at = NOW()`,
      [newId("bsc"), cursor.connectionId, cursor.accountId, cursor.cursor, cursor.lastSyncAt.toISOString(),
       cursor.lastSuccessfulSyncAt?.toISOString() ?? null],
    );
  }
}

async function getActiveEncryptionKey(
  db: Db,
): Promise<Buffer | null> {
  const [row] = await db.query<{ key_data: string }>(
    `SELECT key_data FROM encryption_key_versions WHERE is_active = TRUE LIMIT 1`,
    [],
  );
  if (!row || !row.key_data) return null;
  return Buffer.from(row.key_data, "base64");
}

async function encryptToken(token: string, db: Db): Promise<string> {
  const key = await getActiveEncryptionKey(db);
  if (!key) return token;
  try {
    const cryptoModule = await import("crypto");
    const iv = cryptoModule.randomBytes(12);
    const cipher = cryptoModule.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(token, "utf8", "base64");
    encrypted += cipher.final("base64");
    return `${iv.toString("base64")}.${encrypted}`;
  } catch {
    return token;
  }
}

async function decryptToken(encrypted: string, db: Db): Promise<string> {
  try {
    const key = await getActiveEncryptionKey(db);
    if (!key) return encrypted;
    const cryptoModule = await import("crypto");
    const [ivBase64, ciphertext] = encrypted.split(".");
    const iv = Buffer.from(ivBase64, "base64");
    const decipher = cryptoModule.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(ciphertext, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return encrypted;
  }
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
