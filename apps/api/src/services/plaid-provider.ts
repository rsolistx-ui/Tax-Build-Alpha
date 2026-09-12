import type { Db } from "../db";
import { newId } from "../lib/id";
import {
  BankFeedProvider,
  ProviderAccount,
  ProviderBalance,
  ProviderTransaction,
  ProviderInstitution,
} from "./bank-feed";

interface PlaidConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: 'sandbox' | 'development' | 'production';
}

interface PlaidTokens {
  access_token: string;
  item_id: string;
  request_id: string;
}

interface PlaidAccount {
  account_id: string;
  name: string;
  official_name?: string;
  type: string;
  subtype: string;
  mask?: string;
  balances: {
    current: number;
    available?: number;
    iso_currency_code: string;
    unofficial_currency_code?: string;
  };
}

interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  date: string;
  authorized_date?: string;
  name: string;
  merchant_name?: string;
  amount: number;
  iso_currency_code: string;
  category?: string[];
  category_id?: string;
  pending: boolean;
  transaction_type?: string;
  payment_channel?: string;
  location?: {
    address?: string;
    city?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
  counterparties?: Array<{
    name: string;
    type: string;
    entity_id?: string;
  }>;
  payment_meta?: {
    reference_number?: string;
    ppp?: string;
    payment_processor?: string;
    payment_method?: string;
  };
}

interface PlaidInstitution {
  institution_id: string;
  name: string;
  logo?: string;
  primary_color?: string;
  url?: string;
  country_codes: string[];
  products: string[];
  routing_numbers?: string[];
}

interface PlaidLinkTokenResponse {
  link_token: string;
  expiration: string;
  request_id: string;
}

interface PlaidPublicTokenExchangeResponse {
  access_token: string;
  item_id: string;
  request_id: string;
}

interface PlaidAccountsResponse {
  accounts: PlaidAccount[];
  request_id: string;
}

interface PlaidBalancesResponse {
  accounts: Array<{
    account_id: string;
    balances: {
      current: number;
      available?: number;
      iso_currency_code: string;
      unofficial_currency_code?: string;
      limit?: number;
      last_updated_datetime?: string;
    };
  }>;
  request_id: string;
}

interface PlaidTransactionsResponse {
  transactions: PlaidTransaction[];
  next_cursor?: string;
  has_more: boolean;
  request_id: string;
}

interface PlaidInstitutionsResponse {
  institutions: PlaidInstitution[];
  request_id: string;
}

interface PlaidLinkTokenCreateRequest {
  client_name: string;
  country_codes: string[];
  language: string;
  products: string[];
  redirect_uri?: string;
  webhook?: string;
  user: {
    client_user_id: string;
  };
}

export class PlaidBankFeedProvider implements BankFeedProvider {
  readonly providerName = 'plaid' as const;
  readonly supportedInstitutionsUrl = 'https://cdn.plaid.com/institutions/current';

  private config: PlaidConfig;
  private baseUrl: string;

  constructor(config: PlaidConfig) {
    this.config = config;
    this.baseUrl = config.environment === 'sandbox'
      ? 'https://sandbox.plaid.com'
      : config.environment === 'development'
        ? 'https://development.plaid.com'
        : 'https://production.plaid.com';
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Plaid-Version': '2020-09-14',
        'PLAID-CLIENT-ID': this.config.clientId,
        'PLAID-SECRET': this.config.clientSecret,
        'Accept': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Plaid API error: ${response.status} ${error}`);
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
    const body = {
      client_name: config.clientName,
      country_codes: config.countryCodes,
      language: config.language,
      products: config.products.map(p => this.mapProduct(p)),
      redirect_uri: config.redirectUri || this.config.redirectUri,
      webhook: config.webhookUrl,
      user: {
        client_user_id: config.userId,
      },
    };

    const response = await this.request<PlaidLinkTokenResponse>('/link/token/create', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return {
      linkToken: response.link_token,
      expiration: new Date(response.expiration),
    };
  }

  async exchangePublicToken(publicToken: string): Promise<{
    accessToken: string;
    itemId: string;
    accounts: ProviderAccount[];
  }> {
    const response = await this.request<PlaidPublicTokenExchangeResponse>('/item/public_token/exchange', {
      method: 'POST',
      body: JSON.stringify({ public_token: publicToken }),
    });

    const accountsResponse = await this.request<PlaidAccountsResponse>('/accounts/get', {
      method: 'POST',
      body: JSON.stringify({ access_token: response.access_token }),
    });

    const accounts: ProviderAccount[] = accountsResponse.accounts.map(acc => ({
      providerAccountId: acc.account_id,
      name: acc.name,
      officialName: acc.official_name,
      type: this.mapAccountType(acc.type),
      subtype: acc.subtype,
      mask: acc.mask,
      currentBalance: acc.balances.current,
      availableBalance: acc.balances.available,
      currency: acc.balances.iso_currency_code || acc.balances.unofficial_currency_code || 'USD',
      status: 'active',
    }));

    return {
      accessToken: response.access_token,
      itemId: response.item_id,
      accounts,
    };
  }

  async getAccounts(accessToken: string): Promise<ProviderAccount[]> {
    const response = await this.request<PlaidAccountsResponse>('/accounts/get', {
      method: 'POST',
      body: JSON.stringify({ access_token: accessToken }),
    });

    return response.accounts.map(acc => ({
      providerAccountId: acc.account_id,
      name: acc.name,
      officialName: acc.official_name,
      type: this.mapAccountType(acc.type),
      subtype: acc.subtype,
      mask: acc.mask,
      currentBalance: acc.balances.current,
      availableBalance: acc.balances.available,
      currency: acc.balances.iso_currency_code || acc.balances.unofficial_currency_code || 'USD',
      status: 'active',
    }));
  }

  async getBalance(accessToken: string, accountIds: string[]): Promise<ProviderBalance[]> {
    const response = await this.request<any>('/accounts/balance/get', {
      method: 'POST',
      body: JSON.stringify({ access_token: accessToken, options: { account_ids: accountIds } }),
    });

    return response.accounts
      .filter((a: any) => accountIds.includes(a.account_id))
      .map((a: any) => ({
        accountId: a.account_id,
        current: a.balances.current,
        available: a.balances.available,
        currency: a.balances.iso_currency_code || a.balances.unofficial_currency_code || 'USD',
        asOfDate: a.balances.last_updated_datetime || new Date().toISOString().split('T')[0],
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
    const body: any = {
      access_token: accessToken,
      cursor,
    };
    if (options?.startDate) body.options = { ...body.options, start_date: options.startDate };
    if (options?.endDate) body.options = { ...body.options, end_date: options.endDate };
    if (options?.accountIds) body.options = { ...body.options, account_ids: options.accountIds };
    if (options?.count) body.options = { ...body.options, count: options.count };

    const response = await this.request<PlaidTransactionsResponse>('/transactions/sync', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const transactions: ProviderTransaction[] = response.transactions.map(txn => ({
      providerTransactionId: txn.transaction_id,
      accountId: txn.account_id,
      date: txn.date,
      authorizedDate: txn.authorized_date,
      description: txn.name,
      merchantName: txn.merchant_name,
      amount: -txn.amount,
      currency: txn.iso_currency_code,
      category: txn.category,
      categoryId: txn.category_id,
      pending: txn.pending,
      rawCategory: txn.category?.[0],
      location: txn.location,
      providerMetadata: {
        transaction_type: txn.transaction_type,
        payment_channel: txn.payment_channel,
        counterparties: txn.counterparties,
        payment_meta: txn.payment_meta,
      },
    }));

    return {
      transactions,
      nextCursor: response.next_cursor,
      hasMore: response.has_more,
    };
  }

  async refreshConnection(accessToken: string): Promise<{ success: boolean; newAccessToken?: string; error?: string }> {
    try {
      await this.request<any>('/item/get', {
        method: 'POST',
        body: JSON.stringify({ access_token: accessToken }),
      });
      return { success: true };
    } catch (error) {
      if (error instanceof Error && error.message.includes('ITEM_LOGIN_REQUIRED')) {
        return { success: false, error: 'ITEM_LOGIN_REQUIRED' };
      }
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async removeConnection(accessToken: string): Promise<void> {
    await this.request<any>('/item/remove', {
      method: 'POST',
      body: JSON.stringify({ access_token: accessToken }),
    });
  }

  async searchInstitutions(query: string, countryCodes: string[], products: string[]): Promise<ProviderInstitution[]> {
    const response = await this.request<PlaidInstitutionsResponse>('/institutions/search', {
      method: 'POST',
      body: JSON.stringify({
        query,
        country_codes: countryCodes,
        products: products.map(p => this.mapProduct(p)),
      }),
    });

    return response.institutions.map(inst => ({
      institutionId: inst.institution_id,
      name: inst.name,
      logo: inst.logo,
      primaryColor: inst.primary_color,
      url: inst.url,
      countryCodes: inst.country_codes,
      products: inst.products,
      routingNumbers: inst.routing_numbers,
    }));
  }

  async getInstitution(institutionId: string): Promise<ProviderInstitution | null> {
    try {
      const response = await this.request<{ institution: PlaidInstitution }>('/institutions/get_by_id', {
        method: 'POST',
        body: JSON.stringify({ institution_id: institutionId, country_codes: ['US'] }),
      });
      const inst = response.institution;
      return {
        institutionId: inst.institution_id,
        name: inst.name,
        logo: inst.logo,
        primaryColor: inst.primary_color,
        url: inst.url,
        countryCodes: inst.country_codes,
        products: inst.products,
        routingNumbers: inst.routing_numbers,
      };
    } catch {
      return null;
    }
  }

  private mapAccountType(plaidType: string): 'checking' | 'savings' | 'credit' | 'investment' | 'loan' | 'other' {
    switch (plaidType) {
      case 'depository':
        return 'checking';
      case 'credit':
        return 'credit';
      case 'loan':
        return 'loan';
      case 'investment':
        return 'investment';
      case 'other':
        return 'other';
      default:
        return 'other';
    }
  }

  private mapProduct(product: string): string {
    const map: Record<string, string> = {
      'transactions': 'transactions',
      'auth': 'auth',
      'identity': 'identity',
      'balance': 'balance',
      'assets': 'assets',
      'investments': 'investments',
      'liabilities': 'liabilities',
    };
    return map[product] || product;
  }
}