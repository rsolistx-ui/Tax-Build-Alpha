import type { Env } from "../../env";
import { createGeminiProvider } from "./gemini";
import { mockProvider } from "./mock";
import { createWorkersAiProvider } from "./workers-ai";
import type { LlmProvider } from "./types";

export type { ReceiptBusinessContext, ReceiptExtraction, ReceiptLineItem, LlmProvider } from "./types";

export function getLlmProvider(env: Env): LlmProvider {
  const mode = (env.LLM_PROVIDER || "workers-ai").toLowerCase();

  if (mode === "mock") return mockProvider;

  if (mode === "gemini") {
    if (!env.GEMINI_API_KEY) throw new Error("LLM_PROVIDER=gemini requires GEMINI_API_KEY");
    return createGeminiProvider(env.GEMINI_API_KEY);
  }

  if (mode === "workers-ai") {
    const providers: LlmProvider[] = [];
    if (env.AI) providers.push(createWorkersAiProvider(env.AI));
    if (env.GEMINI_API_KEY) providers.push(createGeminiProvider(env.GEMINI_API_KEY));
    if (providers.length === 0) {
      throw new Error("Workers AI binding is missing and no Gemini fallback is configured");
    }
    return providers.length === 1 ? providers[0] : fallbackProvider(providers);
  }

  throw new Error(`Unknown LLM_PROVIDER: ${mode}`);
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
