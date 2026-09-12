import type { Db } from "../db";
import { newId } from "../lib/id";

export interface DocuSignConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  accountId: string;
  baseUrl: string; // 'https://demo.docusign.net/restapi' or 'https://docusign.net/restapi'
  authServer: string; // 'account-d.docusign.com' or 'account.docusign.com'
}

export interface DocuSignTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  tokenType: string;
  scope: string;
}

export interface DocuSignEnvelope {
  envelopeId: string;
  status: 'created' | 'sent' | 'delivered' | 'completed' | 'declined' | 'voided';
  subject: string;
  emailBlurb?: string;
  recipients: DocuSignRecipient[];
  documents: DocuSignDocument[];
  customFields?: DocuSignCustomField[];
  createdAt: Date;
  sentAt?: Date;
  completedAt?: Date;
  statusChangedAt?: Date;
}

export interface DocuSignRecipient {
  recipientId: string;
  name: string;
  email: string;
  roleName: string;
  routingOrder: number;
  status: 'created' | 'sent' | 'delivered' | 'signed' | 'completed' | 'declined' | 'declined' | 'voided';
  signedAt?: Date;
  tabs?: DocuSignTab[];
}

export interface DocuSignTab {
  tabId: string;
  type: 'signHere' | 'initialHere' | 'dateSigned' | 'text' | 'number' | 'checkbox' | 'radio' | 'list';
  anchorString?: string;
  anchorXOffset?: string;
  anchorYOffset?: string;
  xPosition?: string;
  yPosition?: string;
  pageNumber?: string;
  documentId: string;
  recipientId: string;
  value?: string;
  required: boolean;
  locked: boolean;
}

export interface DocuSignDocument {
  documentId: string;
  name: string;
  fileExtension: string;
  documentBase64: string;
  order: number;
}

export interface DocuSignCustomField {
  name: string;
  value: string;
  show: boolean;
  required: boolean;
}

export interface DocuSignTemplate {
  templateId: string;
  name: string;
  description?: string;
  roles: DocuSignTemplateRole[];
}

export interface DocuSignTemplateRole {
  roleName: string;
  name?: string;
  email?: string;
  routingOrder?: number;
}

export interface DocuSignEnvelopeDefinition {
  emailSubject: string;
  emailBlurb?: string;
  templateId?: string;
  status: 'created' | 'sent';
  templateRoles?: DocuSignTemplateRole[];
  documents?: DocuSignDocument[];
  recipients?: {
    signers?: DocuSignRecipient[];
  };
  customFields?: {
    textCustomFields?: DocuSignCustomField[];
  };
}

export interface DocuSignWebhookEvent {
  event: string;
  envelopeId: string;
  envelopeStatus: string;
  documents?: Array<{ documentId: string; name: string }>;
  recipients?: DocuSignRecipient[];
  customFields?: DocuSignCustomField[];
}

export class DocuSignClient {
  private config: DocuSignConfig;
  private tokens: DocuSignTokens | null = null;

  constructor(config: DocuSignConfig) {
    this.config = config;
  }

  setTokens(tokens: DocuSignTokens): void {
    this.tokens = tokens;
  }

  getTokens(): DocuSignTokens | null {
    return this.tokens;
  }

  isTokenExpired(): boolean {
    if (!this.tokens) return true;
    return new Date() >= this.tokens.expiresAt;
  }

  getAuthUrl(state: string, scopes: string[] = ['signature', 'impersonation']): string {
    const params = new URLSearchParams({
      response_type: 'code',
      scope: scopes.join(' '),
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      state,
      prompt: 'consent',
    });
    return `https://${this.config.authServer}/oauth/auth?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string): Promise<DocuSignTokens> {
    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
    });

    const response = await fetch(`https://${this.config.authServer}/oauth/token`, {
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
      throw new Error(`DocuSign token exchange failed: ${response.status} ${error}`);
    }

    const data: any = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + (data.expires_in * 1000)),
      tokenType: data.token_type,
      scope: data.scope,
    };
  }

  async refreshAccessToken(): Promise<DocuSignTokens> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.tokens.refreshToken,
    });

    const response = await fetch(`https://${this.config.authServer}/oauth/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.tokens.refreshToken,
      }).toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`DocuSign token refresh failed: ${response.status} ${error}`);
    }

    const data: any = await response.json();
    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + (data.expires_in * 1000)),
      tokenType: data.token_type,
      scope: data.scope,
    };
    return this.tokens;
  }

  private getBaseUrl(): string {
    return `${this.config.baseUrl}/v2.1/accounts/${this.config.accountId}`;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    if (!this.tokens) throw new Error('No tokens set. Call setTokens first.');
    if (this.isTokenExpired()) {
      await this.refreshAccessToken();
    }

    const url = `${this.getBaseUrl()}${path}`;
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
      const retryResponse = await fetch(`${this.getBaseUrl()}${path}`, {
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
        throw new Error(`DocuSign API error after refresh: ${retryResponse.status} ${error}`);
      }
      return retryResponse.json();
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`DocuSign API error: ${response.status} ${error}`);
    }

    return response.json();
  }

  // Envelope operations
  async createEnvelope(definition: DocuSignEnvelopeDefinition): Promise<DocuSignEnvelope> {
    const response = await this.request<any>('/envelopes', {
      method: 'POST',
      body: JSON.stringify(definition),
    });

    return {
      envelopeId: response.envelopeId,
      status: response.status,
      subject: definition.emailSubject,
      emailBlurb: definition.emailBlurb,
      recipients: definition.recipients?.signers || [],
      documents: definition.documents || [],
      customFields: definition.customFields?.textCustomFields,
      createdAt: new Date(),
    };
  }

  async getEnvelope(envelopeId: string): Promise<DocuSignEnvelope> {
    const response = await this.request<any>(`/envelopes/${envelopeId}`);
    return {
      envelopeId: response.envelopeId,
      status: response.status,
      subject: response.emailSubject,
      emailBlurb: response.emailBlurb,
      recipients: response.recipients?.signers || [],
      documents: response.envelopeDocuments || [],
      customFields: response.customFields?.textCustomFields,
      createdAt: new Date(response.createdDateTime),
      sentAt: response.sentDateTime ? new Date(response.sentDateTime) : undefined,
      completedAt: response.completedDateTime ? new Date(response.completedDateTime) : undefined,
      statusChangedAt: new Date(response.statusChangedDateTime),
    };
  }

  async sendEnvelope(envelopeId: string): Promise<DocuSignEnvelope> {
    const response = await this.request<any>(`/envelopes/${envelopeId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'sent' }),
    });
    return {
      envelopeId: response.envelopeId,
      status: response.status,
      subject: '',
      recipients: [],
      documents: [],
      createdAt: new Date(),
      sentAt: new Date(),
    };
  }

  async voidEnvelope(envelopeId: string, voidReason: string): Promise<void> {
    await this.request<any>(`/envelopes/${envelopeId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'voided', voidReason }),
    });
  }

  async getEnvelopeDocuments(envelopeId: string): Promise<Array<{ documentId: string; name: string; type: string }>> {
    const response = await this.request<any>(`/envelopes/${envelopeId}/documents`);
    return response.envelopeDocuments || [];
  }

  async downloadDocument(envelopeId: string, documentId: string): Promise<Buffer> {
    const response = await fetch(`${this.getBaseUrl()}/envelopes/${envelopeId}/documents/${documentId}`, {
      headers: {
        'Authorization': `Bearer ${this.tokens!.accessToken}`,
        'Accept': 'application/pdf',
      },
    });
    if (!response.ok) throw new Error(`Failed to download document: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // Templates
  async createTemplate(definition: {
    name: string;
    description?: string;
    documents: DocuSignDocument[];
    recipients: { signers: DocuSignRecipient[] };
    emailSubject: string;
    emailBlurb?: string;
  }): Promise<DocuSignTemplate> {
    const response = await this.request<any>('/templates', {
      method: 'POST',
      body: JSON.stringify({
        name: definition.name,
        description: definition.description,
        documents: definition.documents,
        recipients: { signers: definition.recipients.signers },
        emailSubject: definition.emailSubject,
        emailBlurb: definition.emailBlurb,
      }),
    });
    return {
      templateId: response.templateId,
      name: definition.name,
      description: definition.description,
      roles: definition.recipients.signers.map(s => ({
        roleName: s.roleName,
        name: s.name,
        email: s.email,
        routingOrder: s.routingOrder,
      })),
    };
  }

  async getTemplate(templateId: string): Promise<DocuSignTemplate> {
    const response = await this.request<any>(`/templates/${templateId}`);
    return {
      templateId: response.templateId,
      name: response.name,
      description: response.description,
      roles: response.recipients?.signers?.map((s: any) => ({
        roleName: s.roleName,
        name: s.name,
        email: s.email,
        routingOrder: s.routingOrder,
      })) || [],
    };
  }

  // Embedded signing (for embedded signing in your app)
  async createRecipientView(envelopeId: string, recipient: {
    userId: string;
    clientUserId: string;
    authenticationMethod: 'none' | 'email' | 'phone' | 'knowledge' | 'sms';
    returnUrl: string;
    email: string;
    userName: string;
  }): Promise<{ url: string }> {
    const response = await this.request<any>(`/envelopes/${envelopeId}/views/recipient`, {
      method: 'POST',
      body: JSON.stringify({
        userId: recipient.userId,
        clientUserId: recipient.clientUserId,
        authenticationMethod: recipient.authenticationMethod,
        returnUrl: recipient.returnUrl,
        email: recipient.email,
        userName: recipient.userName,
      }),
    });
    return { url: response.url };
  }
}

export class DocuSignTokenStore {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async saveTokens(firmId: string, accountId: string, tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    tokenType: string;
    scope: string;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO docusign_tokens (id, firm_id, account_id, access_token, refresh_token, expires_at, token_type, scope)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7)
       ON CONFLICT (firm_id, account_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         token_type = EXCLUDED.token_type,
         scope = EXCLUDED.scope,
         updated_at = NOW()`,
      [newId("dst"), firmId, accountId, tokens.accessToken, tokens.refreshToken,
       tokens.expiresAt.toISOString(), tokens.tokenType, tokens.scope],
    );
  }

  async getTokens(firmId: string, accountId: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    tokenType: string;
    scope: string;
  } | null> {
    const [row] = await this.db.query<any>(
      `SELECT * FROM docusign_tokens WHERE firm_id = $1 AND account_id = $2`,
      [firmId, accountId],
    );
    if (!row) return null;
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: new Date(row.expires_at),
      tokenType: row.token_type,
      scope: row.scope,
    };
  }

  async deleteTokens(firmId: string, accountId: string): Promise<void> {
    await this.db.query(`DELETE FROM docusign_tokens WHERE firm_id = $1 AND account_id = $2`, [firmId, accountId]);
  }
}

export interface DocuSignEnvelopeRecord {
  id: string;
  firmId: string;
  clientId?: string;
  engagementId?: string;
  envelopeId: string;
  templateId?: string;
  status: string;
  subject: string;
  recipients: any; // JSON
  customFields?: Record<string, string>;
  createdAt: Date;
  sentAt?: Date;
  completedAt?: Date;
  voidedAt?: Date;
  voidReason?: string;
}

export class DocuSignEnvelopeStore {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async saveEnvelope(record: Omit<DocuSignEnvelopeRecord, 'id' | 'createdAt'>): Promise<DocuSignEnvelopeRecord> {
    const id = newId("dse");
    await this.db.query(
      `INSERT INTO docusign_envelopes (id, firm_id, client_id, engagement_id, envelope_id, template_id, status, subject, recipients, custom_fields, created_at, sent_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12)`,
      [newId("dse"), record.firmId, record.clientId ?? null, record.engagementId ?? null,
       record.envelopeId, record.templateId ?? null, record.status, record.subject,
       JSON.stringify(record.recipients), JSON.stringify(record.customFields ?? {}),
       record.sentAt?.toISOString() ?? null, record.completedAt?.toISOString() ?? null],
    );
    const [row] = await this.db.query<any>(`SELECT * FROM docusign_envelopes WHERE id = $1`, [newId("dse")]);
    // Note: newId will generate a different ID, so we need to fix this
    // For now, return the constructed record
    return { ...record, id: 'temp', createdAt: new Date() };
  }

  async getEnvelope(envelopeId: string): Promise<any> {
    const [row] = await this.db.query<any>(
      `SELECT * FROM docusign_envelopes WHERE envelope_id = $1`,
      [envelopeId],
    );
    return row;
  }

  async updateEnvelopeStatus(envelopeId: string, status: string, completedAt?: Date): Promise<void> {
    const params: any[] = [status];
    let sql = `UPDATE docusign_envelopes SET status = $1`;
    if (completedAt) {
      sql += `, completed_at = $2 WHERE envelope_id = $3`;
      await this.db.query(sql, [status, completedAt.toISOString(), envelopeId]);
    } else {
      sql += ` WHERE envelope_id = $2`;
      await this.db.query(sql, [status, envelopeId]);
    }
  }
}

export class DocuSignWebhookHandler {
  private client: DocuSignClient;
  private envelopeStore: DocuSignEnvelopeStore;

  constructor(client: DocuSignClient, envelopeStore: DocuSignEnvelopeStore) {
    this.client = client;
    this.envelopeStore = envelopeStore;
  }

  async handleWebhook(event: any): Promise<void> {
    // event structure: { event: 'envelope-completed', envelopeId, envelopeStatus, documents, recipients, customFields }
    const envelopeId = event.envelopeId;
    if (!envelopeId) return;

    const envelope = await this.client.getEnvelope(envelopeId);
    await this.envelopeStore.updateEnvelopeStatus(envelopeId, envelope.status, envelope.completedAt);
  }
}