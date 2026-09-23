import type { Env } from "../../env";
import { createGeminiProvider } from "./gemini";
import { createGroqProvider } from "./groq";
import { createAzureDocumentIntelligenceProvider, US_AZURE_REGIONS } from "./azure-document-intelligence";
import { mockProvider } from "./mock";
import { createWorkersAiProvider } from "./workers-ai";
import type { LlmProvider } from "./types";

export type { ReceiptBusinessContext, ReceiptExtraction, ReceiptLineItem, LlmProvider } from "./types";

function azureReady(env: Env): boolean {
  return Boolean(env.AZURE_DI_ENDPOINT && env.AZURE_DI_KEY && US_AZURE_REGIONS.includes((env.AZURE_DI_REGION ?? "").toLowerCase()));
}

/** US-only mode: only readers that process inside the United States may receive documents. */
export function usOnlyReading(env: Env): boolean {
  return env.US_ONLY_READING === "true";
}

export function getLlmProvider(env: Env): LlmProvider {
  const mode = (env.LLM_PROVIDER || "workers-ai").toLowerCase();
  if (usOnlyReading(env) || mode === "azure") {
    if (!azureReady(env)) throw new Error("US-only reading needs AZURE_DI_ENDPOINT, AZURE_DI_KEY and a US AZURE_DI_REGION");
    return createAzureDocumentIntelligenceProvider({ endpoint: env.AZURE_DI_ENDPOINT!, key: env.AZURE_DI_KEY! });
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
export type DocumentReader = { id: "gemini" | "cloudflare-workers-ai" | "groq" | "azure-document-intelligence"; legalName: string; service: string; usOnly: boolean };

const READERS: Record<DocumentReader["id"], DocumentReader> = {
  gemini: { id: "gemini", legalName: "Google LLC", service: "Gemini API", usOnly: false },
  "cloudflare-workers-ai": { id: "cloudflare-workers-ai", legalName: "Cloudflare, Inc.", service: "Workers AI", usOnly: false },
  groq: { id: "groq", legalName: "Groq, Inc.", service: "GroqCloud", usOnly: false },
  "azure-document-intelligence": { id: "azure-document-intelligence", legalName: "Microsoft Corporation", service: "Azure AI Document Intelligence, US region", usOnly: true },
};

export function activeDocumentReaders(env: Env): DocumentReader[] {
  const mode = (env.LLM_PROVIDER || "workers-ai").toLowerCase();
  if (usOnlyReading(env) || mode === "azure") return azureReady(env) ? [READERS["azure-document-intelligence"]] : [];
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
