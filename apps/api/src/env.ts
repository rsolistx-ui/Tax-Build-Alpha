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
  LLM_PROVIDER?: string;
  /** Case-insensitive email identifying the beta owner/operator. Set as a Worker secret, never hardcoded. */
  OWNER_EMAIL?: string;
  /** Shared secret required by the internal smoke-cleanup endpoint. Never exposed to any client. */
  SMOKE_CLEANUP_TOKEN?: string;
};
