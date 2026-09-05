import type { Env } from "../../env";
import { createGeminiProvider } from "./gemini";
import { mockProvider } from "./mock";
import type { LlmProvider } from "./types";

export type { ReceiptExtraction, LlmProvider } from "./types";

export function getLlmProvider(env: Env): LlmProvider {
  const mode = (env.LLM_PROVIDER || "mock").toLowerCase();
  if (mode === "gemini" && env.GEMINI_API_KEY) {
    return createGeminiProvider(env.GEMINI_API_KEY);
  }
  return mockProvider;
}
