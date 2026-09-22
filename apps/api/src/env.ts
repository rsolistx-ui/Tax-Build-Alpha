export type MarkdownConversionResult = {
  format: "markdown" | "text" | "error";
  data?: string;
  error?: string;
};

export type WorkersAiBinding = {
  run(model: string, input: unknown, options?: unknown): Promise<unknown>;
  toMarkdown(
    file: { name: string; blob: Blob },
    options?: { conversionOptions?: Record<string, unknown> },
  ): Promise<MarkdownConversionResult | MarkdownConversionResult[]>;
};

export type Env = {
  /** D1 is retained only for Better Auth/session state during the Neon migration. */
  AUTH_DB: D1Database;
  /** All firm, client, receipt, ledger, audit, and correction data lives in Neon. */
  DATABASE_URL: string;
  RECEIPTS: R2Bucket;
  AI?: WorkersAiBinding;
  JOBS_QUEUE?: Queue;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  APP_ORIGIN?: string;
  GEMINI_API_KEY?: string;
  /** Optional Groq OpenAI-compatible vision fallback. Worker secret only. */
  GROQ_API_KEY?: string;
  LLM_PROVIDER?: string;
  /** Case-insensitive email identifying the beta owner/operator. Set as a Worker secret, never hardcoded. */
  OWNER_EMAIL?: string;
  /** Power user email possessing indefinite lifetime platform access, bypassing 30-day licensing limits. */
  POWER_USER_EMAIL?: string;
  /** 64-character hex master token to lock down the admin architecture and override all gates. */
  ADMIN_MASTER_TOKEN?: string;
  /** Resend API key for outbound engineering alerts and concierge notifications. */
  RESEND_API_KEY?: string;
  /** Admin recipient email for rule submissions and support concierge tickets. */
  ADMIN_NOTIFICATION_EMAIL?: string;
  /** Custom sender address for Resend (e.g. notifications@resend.dev or firm domain). */
  SENDER_EMAIL?: string;
  /** Shared secret required by the internal smoke-cleanup endpoint. Never exposed to any client. */
  SMOKE_CLEANUP_TOKEN?: string;
  /** Push notifications (Web Push + VAPID). Never hardcoded; set as Worker secrets. */
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  /** Cloudflare Turnstile bot challenge (site key & secret key) */
  CF_TURNSTILE_SITE_KEY?: string;
  CF_TURNSTILE_SECRET_KEY?: string;
  /** Telegram bot alerts for system status, outages, and client requests */
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  /** Twilio inbound MMS webhook credentials. Both are required before the public SMS endpoint is enabled. */
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  /** Optional Teller bank connectivity. Worker secret only. */
  TELLER_CLIENT_ID?: string;
  TELLER_CLIENT_SECRET?: string;
  TELLER_ENVIRONMENT?: 'sandbox' | 'production';
  TELLER_WEBHOOK_SECRET?: string;
  /** Optional Plaid bank connectivity. Worker secret only. */
  PLAID_CLIENT_ID?: string;
  PLAID_CLIENT_SECRET?: string;
  PLAID_ENVIRONMENT?: 'sandbox' | 'development' | 'production';
  PLAID_WEBHOOK_SECRET?: string;
  /** Optional QuickBooks integration. Worker secrets only. */
  QB_CLIENT_ID?: string;
  QB_CLIENT_SECRET?: string;
  QB_ENVIRONMENT?: 'sandbox' | 'production';
  /** Optional Stripe integration. Worker secrets only. */
  STRIPE_SECRET_KEY?: string;
  STRIPE_PUBLISHABLE_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_CONNECT_CLIENT_ID?: string;
  /** Optional Google Calendar integration. Worker secrets only. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** 32-byte base64url key used only to encrypt Gmail refresh tokens at rest. */
  GMAIL_TOKEN_ENCRYPTION_KEY?: string;
  /** DocuSign integration (optional, gated). Worker secrets only. */
  DOCUSIGN_CLIENT_ID?: string;
  DOCUSIGN_CLIENT_SECRET?: string;
  DOCUSIGN_ACCOUNT_ID?: string;
  DOCUSIGN_BASE_URL?: string;
  DOCUSIGN_AUTH_SERVER?: string;
  DOCUSIGN_REDIRECT_URI?: string;
  /** Tauri desktop bridge secret (signs sync payloads). Worker secret only. */
  TAURI_SYNC_SECRET?: string;
  /** Internal: sync event hooks (append-only table). Never exposed to clients. */
  SYNC_TABLE_SECRET?: string;
  /**
   * Upper limit for any future supervisor-initiated model work. The
   * supervisor itself is deterministic; it should only ask a model to
   * interpret new, unresolved evidence rather than polling an empty queue.
   */
  SUPERVISOR_LLM_DAILY_LIMIT?: string;
};
