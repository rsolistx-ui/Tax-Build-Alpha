import type { Db } from "../db";
import { newId } from "../lib/id";
import {
  BankFeedProvider,
  ProviderAccount,
  ProviderBalance,
  ProviderTransaction,
  ProviderInstitution,
  BankFeedSyncCursor,
  BankConnection,
  BankAccount,
  BankTransaction,
  BankFeedSyncResult,
} from "./bank-feed";

interface TellerConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: 'sandbox' | 'production';
}

interface TellerTokens {
  access_token: string;
  id_token?: string;
}

interface TellerAccount {
  id: string;
  name: string;
  type: string;
  subtype: string;
  mask?: string;
  balance: {
    current: number;
    available?: number;
    currency: string;
  };
  institution_id: string;
  institution_name: string;
}

interface TellerTransaction {
  id: string;
  account_id: string;
  date: string;
  authorized_date?: string;
  description: string;
  merchant_name?: string;
  amount: number;
  currency: string;
  category?: string[];
  category_id?: string;
  pending: boolean;
  raw_category?: string;
  location?: {
    address?: string;
    city?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
  metadata?: Record<string, any>;
}

interface TellerInstitution {
  id: string;
  name: string;
  logo?: string;
  primary_color?: string;
  url?: string;
  country_codes: string[];
  products: string[];
}

interface TellerLinkTokenResponse {
  token: string;
  expiration: string;
}

interface TellerEnrollmentResponse {
  access_token: string;
  enrollment_id: string;
  institution: {
    id: string;
    name: string;
    logo?: string;
    primary_color?: string;
  };
  accounts: TellerAccount[];
}

interface TellerAccountsResponse {
  accounts: TellerAccount[];
}

interface TellerBalancesResponse {
  balances: {
    account_id: string;
    current: number;
    available?: number;
    currency: string;
    date: string;
  }[];
}

interface TellerTransactionsResponse {
  transactions: TellerTransaction[];
  next_cursor?: string;
  has_more: boolean;
}

interface TellerInstitutionsResponse {
  institutions: TellerInstitution[];
}

export class TellerBankFeedProvider implements BankFeedProvider {
  readonly providerName = 'teller' as const;
  readonly supportedInstitutionsUrl = 'https://api.teller.io/institutions';

  private config: TellerConfig;
  private baseUrl: string;

  constructor(config: TellerConfig) {
    this.config = config;
    this.baseUrl = config.environment === 'sandbox'
      ? 'https://api.teller.io/sandbox'
      : 'https://api.teller.io';
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.config.clientSecret}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Teller API error: ${response.status} ${error}`);
    }

    return response.json();
  }

  async createLinkToken(config: {
    firmId: string;
    clientId?: string;
    userId: string;
    clientName: string;
    products: ('transactions' | 'auth' | 'identity' | 'balance' | 'assets' | 'investments' | 'liabilities')[];
    countryCodes: string[];
    language: string;
    redirectUri?: string;
    webhookUrl?: string;
  }): Promise<{ linkToken: string; expiration: Date }> {
    // Teller uses enrollment tokens, not link tokens
    const response = await this.request<TellerLinkTokenResponse>('/enrollments', {
      method: 'POST',
      body: JSON.stringify({
        client_name: config.clientName,
        products: config.products,
        country_codes: config.countryCodes,
        redirect_uri: config.redirectUri || this.config.redirectUri,
        webhook_url: config.webhookUrl,
      }),
    });

    return {
      linkToken: response.token,
      expiration: new Date(response.expiration),
    };
  }

  async exchangePublicToken(publicToken: string): Promise<{
    accessToken: string;
    itemId: string;
    accounts: ProviderAccount[];
  }> {
    // Teller doesn't use public tokens; enrollment is direct
    // This is called after the user completes the Link flow
    // The publicToken here is actually the enrollment token
    const response = await this.request<TellerEnrollmentResponse>(`/enrollments/${publicToken}`);

    const accounts: ProviderAccount[] = response.accounts.map(acc => ({
      providerAccountId: acc.id,
      name: acc.name,
      officialName: acc.name,
      type: this.mapAccountType(acc.type),
      subtype: acc.subtype,
      mask: acc.mask,
      currentBalance: acc.balance.current,
      availableBalance: acc.balance.available,
      currency: acc.balance.currency,
      status: 'active',
    }));

    return {
      accessToken: response.access_token,
      itemId: response.enrollment_id,
      accounts,
    };
  }

  async getAccounts(accessToken: string): Promise<ProviderAccount[]> {
    const response = await this.request<TellerAccountsResponse>('/accounts', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    return response.accounts.map(acc => ({
      providerAccountId: acc.id,
      name: acc.name,
      officialName: acc.name,
      type: this.mapAccountType(acc.type),
      subtype: acc.subtype,
      mask: acc.mask,
      currentBalance: acc.balance.current,
      availableBalance: acc.balance.available,
      currency: acc.balance.currency,
      status: 'active',
    }));
  }

  async getBalance(accessToken: string, accountIds: string[]): Promise<ProviderBalance[]> {
    const response = await this.request<TellerBalancesResponse>('/accounts/balances', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    return response.balances
      .filter(b => accountIds.includes(b.account_id))
      .map(b => ({
        accountId: b.account_id,
        current: b.current,
        available: b.available,
        currency: b.currency,
        asOfDate: b.date,
      }));
  }

  async syncTransactions(
    accessToken: string,
    cursor?: string,
    options?: {
      startDate?: string;
      endDate?: string;
      accountIds?: string[];
      count?: number;
    }
  ): Promise<{
    transactions: ProviderTransaction[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (options?.startDate) params.set('start_date', options.startDate);
    if (options?.endDate) params.set('end_date', options.endDate);
    if (options?.accountIds) params.set('account_ids', options.accountIds.join(','));
    if (options?.count) params.set('count', String(options.count));

    const path = `/transactions${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await this.request<TellerTransactionsResponse>(`/transactions${params.toString() ? `?${params.toString()}` : ''}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    const transactions: ProviderTransaction[] = response.transactions.map(txn => ({
      providerTransactionId: txn.id,
      accountId: txn.account_id,
      date: txn.date,
      authorizedDate: txn.authorized_date,
      description: txn.description,
      merchantName: txn.merchant_name,
      amount: txn.amount, // Teller: positive = debit/outflow
      currency: txn.currency,
      category: txn.category,
      categoryId: txn.category_id,
      pending: txn.pending,
      rawCategory: txn.raw_category,
      location: txn.location,
      providerMetadata: txn.metadata,
    }));

    return {
      transactions,
      nextCursor: response.next_cursor,
      hasMore: response.has_more,
    };
  }

  async refreshConnection(accessToken: string): Promise<{ success: boolean; newAccessToken?: string; error?: string }> {
    // Teller tokens don't expire; this is a no-op check
    try {
      await this.getAccounts(accessToken);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async removeConnection(accessToken: string): Promise<void> {
    // Teller doesn't have a revoke endpoint; just delete the token from our DB
    // The enrollment will eventually expire on Teller's side
  }

  async searchInstitutions(query: string, countryCodes: string[], products: string[]): Promise<ProviderInstitution[]> {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    if (countryCodes.length) params.set('country_codes', countryCodes.join(','));
    if (products.length) params.set('products', products.join(','));

    const response = await this.request<TellerInstitutionsResponse>(`/institutions?${new URLSearchParams({ query, country_codes: countryCodes.join(',') }).toString()}`);

    return response.institutions.map(inst => ({
      institutionId: inst.id,
      name: inst.name,
      logo: inst.logo,
      primaryColor: inst.primary_color,
      url: inst.url,
      countryCodes: inst.country_codes,
      products: inst.products,
    }));
  }

  async getInstitution(institutionId: string): Promise<ProviderInstitution | null> {
    try {
      const response = await this.request<{ institution: TellerInstitution }>(`/institutions/${institutionId}`);
      const inst = response.institution;
      return {
        institutionId: inst.id,
        name: inst.name,
        logo: inst.logo,
        primaryColor: inst.primary_color,
        url: inst.url,
        countryCodes: inst.country_codes,
        products: inst.products,
      };
    } catch {
      return null;
    }
  }

  private mapAccountType(tellerType: string): 'checking' | 'savings' | 'credit' | 'investment' | 'loan' | 'other' {
    switch (tellerType.toLowerCase()) {
      case 'checking': return 'checking';
      case 'savings': return 'savings';
      case 'credit': return 'credit';
      case 'investment': return 'investment';
      case 'loan': return 'loan';
      default: return 'other';
    }
  }
}