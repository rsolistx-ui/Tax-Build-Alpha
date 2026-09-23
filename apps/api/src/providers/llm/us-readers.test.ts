import { describe, expect, it } from "vitest";
import type { Env } from "../../env";
import { mapTextractExpense, signAwsRequest } from "./aws-textract";
import { suggestCategory } from "./azure-openai-categorizer";
import { activeDocumentReaders, getLlmProvider } from "./index";
import { buildConsentText, consentRequired } from "../../services/taxpayer-consent";

const azure = { AZURE_DI_ENDPOINT: "https://tp.cognitiveservices.azure.com", AZURE_DI_KEY: "k", AZURE_DI_REGION: "eastus" };
const aws = { AWS_TEXTRACT_REGION: "us-east-1", AWS_TEXTRACT_ACCESS_KEY_ID: "AKIDEXAMPLE", AWS_TEXTRACT_SECRET_ACCESS_KEY: "secret", AWS_AI_OPT_OUT_CONFIRMED: "true" };
const openai = { AZURE_OPENAI_ENDPOINT: "https://tp.openai.azure.com", AZURE_OPENAI_KEY: "k", AZURE_OPENAI_DEPLOYMENT: "gpt", AZURE_OPENAI_REGION: "eastus2", AZURE_OPENAI_DEPLOYMENT_TYPE: "standard" };
const env = (extra: Record<string, string>) => ({ US_ONLY_READING: "true", ...extra }) as unknown as Env;

describe("US-only readers", () => {
  it("chains Microsoft first and Amazon as the backup", () => {
    expect(activeDocumentReaders(env({ ...azure, ...aws })).map((r) => r.id)).toEqual(["azure-document-intelligence", "aws-textract"]);
    expect(getLlmProvider(env({ ...azure, ...aws })).name).toBe("azure-document-intelligence->aws-textract");
    expect(getLlmProvider(env(aws)).name).toBe("aws-textract");
  });

  it("keeps Amazon off until the AI services opt-out is confirmed, and off outside US regions", () => {
    expect(activeDocumentReaders(env({ ...aws, AWS_AI_OPT_OUT_CONFIRMED: "" }))).toEqual([]);
    expect(activeDocumentReaders(env({ ...aws, AWS_TEXTRACT_REGION: "eu-west-1" }))).toEqual([]);
  });

  it("needs no consent for US field extraction, but does once the US category model is on", () => {
    const plain = activeDocumentReaders(env({ ...azure, ...aws }));
    expect(consentRequired(plain)).toBe(false);
    const withModel = activeDocumentReaders(env({ ...azure, ...openai }));
    expect(withModel.map((r) => r.id)).toContain("azure-openai");
    expect(consentRequired(withModel)).toBe(true);
    const text = buildConsentText("disclosure_document_reading", { preparerName: "Firm", taxpayerName: "Pat", readers: withModel });
    expect(text).not.toContain("disclosed to a tax return preparer located outside the United States");
    expect(text).toContain("only in the United States");
  });

  it("refuses a Global or Data Zone model deployment", () => {
    expect(activeDocumentReaders(env({ ...azure, ...openai, AZURE_OPENAI_DEPLOYMENT_TYPE: "global" })).map((r) => r.id)).not.toContain("azure-openai");
  });

  it("maps Textract AnalyzeExpense fields", () => {
    const r = mapTextractExpense({ ExpenseDocuments: [{
      SummaryFields: [
        { Type: { Text: "VENDOR_NAME" }, ValueDetection: { Text: "Shell" } },
        { Type: { Text: "INVOICE_RECEIPT_DATE" }, ValueDetection: { Text: "03/04/2026" } },
        { Type: { Text: "TOTAL" }, ValueDetection: { Text: "$45.10", Confidence: 98 } },
        { Type: { Text: "TAX" }, ValueDetection: { Text: "3.10" } },
      ],
      LineItemGroups: [{ LineItems: [{ LineItemExpenseFields: [{ Type: { Text: "ITEM" }, ValueDetection: { Text: "Unleaded" } }, { Type: { Text: "PRICE" }, ValueDetection: { Text: "42.00", Confidence: 90 } }] }] }],
    }] });
    expect(r).toMatchObject({ merchant: "Shell", date: "2026-03-04", total: 45.1, tax: 3.1, confidence: 0.98, lineItems: [{ description: "Unleaded", amount: 42 }] });
  });

  it("signs requests with AWS Signature Version 4", async () => {
    const headers = await signAwsRequest({ region: "us-east-1", service: "textract", host: "textract.us-east-1.amazonaws.com", target: "Textract.AnalyzeExpense", body: "{}", accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret", now: new Date("2026-01-02T03:04:05Z") });
    expect(headers["X-Amz-Date"]).toBe("20260102T030405Z");
    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260102\/us-east-1\/textract\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$/);
  });

  it("only accepts a suggested category from the client's own list", async () => {
    const fake = (body: string) => (async () => new Response(JSON.stringify({ choices: [{ message: { content: body } }] }))) as unknown as typeof fetch;
    const extraction = { date: null, merchant: "Shell", subtotal: null, tax: null, tip: null, total: 45, currency: "USD", category: null, confidence: 1, lineItems: [] };
    const config = { endpoint: "https://x", key: "k", deployment: "d" };
    expect(await suggestCategory(config, extraction, { categories: ["fuel", "meals"] }, { fetch: fake('{"category":"fuel"}') })).toBe("fuel");
    expect(await suggestCategory(config, extraction, { categories: ["fuel", "meals"] }, { fetch: fake('{"category":"yachts"}') })).toBeNull();
  });
});
