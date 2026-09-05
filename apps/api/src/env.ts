export type Env = {
  DB: D1Database;
  RECEIPTS: R2Bucket;
  /** Optional — wire Cloudflare Queues when ready */
  JOBS_QUEUE?: Queue;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GEMINI_API_KEY?: string;
  LLM_PROVIDER?: string;
};
