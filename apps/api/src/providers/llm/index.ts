import type { Env } from "../../env";
import { createGeminiProvider } from "./gemini";
import { createGroqProvider } from "./groq";
import { createAzureDocumentIntelligenceProvider, US_AZURE_REGIONS } from "./azure-document-intelligence";
import { createAwsTextractProvider, US_AWS_REGIONS } from "./aws-textract";
import { US_OPENAI_REGIONS, type CategorizerConfig } from "./azure-openai-categorizer";
import { mockProvider } from "./mock";
import { createWorkersAiProvider } from "./workers-ai";
import type { LlmProvider } from "./types";

export type { ReceiptBusinessContext, ReceiptExtraction, ReceiptLineItem, LlmProvider } from "./types";

function azureReady(env: Env): boolean {
  return Boolean(env.AZURE_DI_ENDPOINT && env.AZURE_DI_KEY && US_AZURE_REGIONS.includes((env.AZURE_DI_REGION ?? "").toLowerCase()));
}

function textractReady(env: Env): boolean {
  return Boolean(env.AWS_TEXTRACT_ACCESS_KEY_ID && env.AWS_TEXTRACT_SECRET_ACCESS_KEY && env.AWS_AI_OPT_OUT_CONFIRMED === "true"
    && US_AWS_REGIONS.includes((env.AWS_TEXTRACT_REGION ?? "").toLowerCase()));
}

/** Optional US-only category suggestions; only a Standard (regional) deployment in a US region qualifies. */
export function usCategorizerConfig(env: Env): CategorizerConfig | null {
  if (!usOnlyReading(env)) return null;
  const ok = env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_KEY && env.AZURE_OPENAI_DEPLOYMENT
    && env.AZURE_OPENAI_DEPLOYMENT_TYPE?.toLowerCase() === "standard"
    && US_OPENAI_REGIONS.includes((env.AZURE_OPENAI_REGION ?? "").toLowerCase());
  return ok ? { endpoint: env.AZURE_OPENAI_ENDPOINT!, key: env.AZURE_OPENAI_KEY!, deployment: env.AZURE_OPENAI_DEPLOYMENT! } : null;
}

/** US-only readers in order: Microsoft first, Amazon as the backup. */
function usReaders(env: Env): LlmProvider[] {
  const readers: LlmProvider[] = [];
  if (azureReady(env)) readers.push(createAzureDocumentIntelligenceProvider({ endpoint: env.AZURE_DI_ENDPOINT!, key: env.AZURE_DI_KEY! }));
  if (textractReady(env)) readers.push(createAwsTextractProvider({ region: env.AWS_TEXTRACT_REGION!.toLowerCase(), accessKeyId: env.AWS_TEXTRACT_ACCESS_KEY_ID!, secretAccessKey: env.AWS_TEXTRACT_SECRET_ACCESS_KEY! }));
  return readers;
}

/** US-only mode: only readers that process inside the United States may receive documents. */
export function usOnlyReading(env: Env): boolean {
  return env.US_ONLY_READING === "true";
}

export function getLlmProvider(env: Env): LlmProvider {
  const mode = (env.LLM_PROVIDER || "workers-ai").toLowerCase();
  if (usOnlyReading(env) || mode === "azure") {
    const readers = usReaders(env);
    if (!readers.length) throw new Error("US-only reading needs a configured US reader (Azure Document Intelligence or Amazon Textract)");
    return readers.length === 1 ? readers[0] : fallbackProvider(readers);
  }

  if (mode === "mock") return mockProvider;

  if (mode === "gemini") {
    if (!env.GEMINI_API_KEY) throw new Error("LLM_PROVIDER=gemini requires GEMINI_API_KEY");
    return createGeminiProvider(env.GEMINI_API_KEY);
  }
  if (mode === "groq") {
    if (!env.GROQ_API_KEY) throw new Error("LLM_PROVIDER=groq requires GROQ_API_KEY");
    return createGroqProvider(env.GROQ_API_KEY);
  }

  if (mode === "workers-ai") {
    const providers: LlmProvider[] = [];
    // Prioritize state-of-the-art multimodal vision (Gemini 2.0 Flash) when API key is provided
    if (env.GEMINI_API_KEY) providers.push(createGeminiProvider(env.GEMINI_API_KEY));
    if (env.AI) providers.push(createWorkersAiProvider(env.AI));
    if (env.GROQ_API_KEY) providers.push(createGroqProvider(env.GROQ_API_KEY));
    if (providers.length === 0) {
      throw new Error("Workers AI binding is missing and no Gemini fallback is configured");
    }
    return providers.length === 1 ? providers[0] : fallbackProvider(providers);
  }

  throw new Error(`Unknown LLM_PROVIDER: ${mode}`);
}

/** Outside services a receipt may be sent to under the current configuration (named in the § 7216 consent). */
export type DocumentReader = { id: "gemini" | "cloudflare-workers-ai" | "groq" | "azure-document-intelligence" | "aws-textract" | "azure-openai"; legalName: string; service: string; usOnly: boolean; substantive?: boolean };

const READERS: Record<DocumentReader["id"], DocumentReader> = {
  gemini: { id: "gemini", legalName: "Google LLC", service: "Gemini API", usOnly: false },
  "cloudflare-workers-ai": { id: "cloudflare-workers-ai", legalName: "Cloudflare, Inc.", service: "Workers AI", usOnly: false },
  groq: { id: "groq", legalName: "Groq, Inc.", service: "GroqCloud", usOnly: false },
  "azure-document-intelligence": { id: "azure-document-intelligence", legalName: "Microsoft Corporation", service: "Azure AI Document Intelligence, US region", usOnly: true },
  "aws-textract": { id: "aws-textract", legalName: "Amazon Web Services, Inc.", service: "Amazon Textract, US region", usOnly: true },
  // Category suggestions may be a "substantive determination" (Treas. Reg. § 301.7216-2(d)(1)), so consent applies even in the US.
  "azure-openai": { id: "azure-openai", legalName: "Microsoft Corporation", service: "Azure OpenAI category suggestions, US region", usOnly: true, substantive: true },
};

export function activeDocumentReaders(env: Env): DocumentReader[] {
  const mode = (env.LLM_PROVIDER || "workers-ai").toLowerCase();
  if (usOnlyReading(env) || mode === "azure") {
    const readers: DocumentReader[] = [];
    if (azureReady(env)) readers.push(READERS["azure-document-intelligence"]);
    if (textractReady(env)) readers.push(READERS["aws-textract"]);
    if (readers.length && usCategorizerConfig(env)) readers.push(READERS["azure-openai"]);
    return readers;
  }
  if (mode === "mock") return [];
  if (mode === "gemini") return env.GEMINI_API_KEY ? [READERS.gemini] : [];
  if (mode === "groq") return env.GROQ_API_KEY ? [READERS.groq] : [];
  const readers: DocumentReader[] = [];
  if (env.GEMINI_API_KEY) readers.push(READERS.gemini);
  if (env.AI) readers.push(READERS["cloudflare-workers-ai"]);
  if (env.GROQ_API_KEY) readers.push(READERS.groq);
  return readers;
}

function fallbackProvider(providers: LlmProvider[]): LlmProvider {
  return {
    name: providers.map((provider) => provider.name).join("->"),
    model: providers.map((provider) => provider.model).join("->"),
    async extractReceipt(input) {
      const errors: string[] = [];
      for (const provider of providers) {
        try {
          return await provider.extractReceipt(input);
        } catch (error) {
          errors.push(`${provider.name}: ${error instanceof Error ? error.message : "failed"}`);
        }
      }
      throw new Error(`All receipt extraction providers failed. ${errors.join(" | ")}`);
    },
  };
}
