import type { LlmProvider, ReceiptExtraction, ReceiptLineItem } from "./types";

/**
 * Backup US-only receipt reader: Amazon Textract AnalyzeExpense in a US region.
 * AWS states content "is encrypted and stored at rest in the AWS region where you are
 * using Amazon Textract", but unless the account applies an AWS Organizations AI
 * services opt-out policy, some content may be stored in another region and used to
 * improve AWS services (aws.amazon.com/textract/faqs). This reader is therefore only
 * enabled when AWS_AI_OPT_OUT_CONFIRMED="true" records that the policy is in place.
 */
export const US_AWS_REGIONS = ["us-east-1", "us-east-2", "us-west-1", "us-west-2"];

type Field = { Type?: { Text?: string }; ValueDetection?: { Text?: string; Confidence?: number } };
type ExpenseResponse = { ExpenseDocuments?: Array<{ SummaryFields?: Field[]; LineItemGroups?: Array<{ LineItems?: Array<{ LineItemExpenseFields?: Field[] }> }> }> };

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
async function sha256(data: string) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(data))); }
async function hmac(key: ArrayBuffer | Uint8Array, data: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

/** AWS Signature Version 4 for a JSON POST to the service root. */
export async function signAwsRequest(input: { region: string; service: string; host: string; target: string; body: string; accessKeyId: string; secretAccessKey: string; now?: Date }) {
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = await sha256(input.body);
  const canonicalHeaders = `content-type:application/x-amz-json-1.1\nhost:${input.host}\nx-amz-date:${amzDate}\nx-amz-target:${input.target}\n`;
  const signedHeaders = "content-type;host;x-amz-date;x-amz-target";
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${date}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await sha256(canonicalRequest)}`;
  let key: ArrayBuffer = await hmac(enc.encode(`AWS4${input.secretAccessKey}`), date);
  for (const part of [input.region, input.service, "aws4_request"]) key = await hmac(key, part);
  const signature = hex(await hmac(key, stringToSign));
  return {
    "Content-Type": "application/x-amz-json-1.1",
    "X-Amz-Date": amzDate,
    "X-Amz-Target": input.target,
    Authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function amount(text?: string): number | null {
  if (!text || !/[0-9]/.test(text)) return null;
  const n = Number(text.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function isoDate(text?: string): string | null {
  if (!text) return null;
  const t = text.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const parsed = Date.parse(t);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

export function mapTextractExpense(response: ExpenseResponse): ReceiptExtraction {
  const doc = response.ExpenseDocuments?.[0];
  const get = (fields: Field[] | undefined, type: string) => fields?.find((f) => f.Type?.Text === type)?.ValueDetection;
  const summary = doc?.SummaryFields;
  const lineItems: ReceiptLineItem[] = (doc?.LineItemGroups ?? []).flatMap((g) => g.LineItems ?? []).map((li) => {
    const f = li.LineItemExpenseFields;
    return {
      description: get(f, "ITEM")?.Text ?? "",
      quantity: amount(get(f, "QUANTITY")?.Text),
      unitPrice: amount(get(f, "UNIT_PRICE")?.Text),
      amount: amount(get(f, "PRICE")?.Text),
      category: null,
      confidence: (get(f, "PRICE")?.Confidence ?? 0) / 100,
    };
  });
  const total = get(summary, "TOTAL") ?? get(summary, "AMOUNT_PAID");
  return {
    date: isoDate(get(summary, "INVOICE_RECEIPT_DATE")?.Text),
    merchant: get(summary, "VENDOR_NAME")?.Text ?? get(summary, "NAME")?.Text ?? null,
    subtotal: amount(get(summary, "SUBTOTAL")?.Text),
    tax: amount(get(summary, "TAX")?.Text),
    tip: amount(get(summary, "GRATUITY")?.Text),
    total: amount(total?.Text),
    currency: "USD",
    category: null,
    confidence: (total?.Confidence ?? 0) / 100,
    lineItems,
  };
}

export function createAwsTextractProvider(config: { region: string; accessKeyId: string; secretAccessKey: string }, deps: { fetch?: typeof fetch } = {}): LlmProvider {
  const doFetch = deps.fetch ?? fetch;
  const host = `textract.${config.region}.amazonaws.com`;
  return {
    name: "aws-textract",
    model: "AnalyzeExpense",
    async extractReceipt({ bytes }) {
      const buf = new Uint8Array(Array.isArray(bytes) ? bytes[0] : bytes);
      let binary = "";
      for (let i = 0; i < buf.length; i += 0x8000) binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const body = JSON.stringify({ Document: { Bytes: btoa(binary) } });
      const headers = await signAwsRequest({ region: config.region, service: "textract", host, target: "Textract.AnalyzeExpense", body, accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey });
      const response = await doFetch(`https://${host}/`, { method: "POST", headers, body });
      if (!response.ok) throw new Error(`Textract error ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const extraction = mapTextractExpense(await response.json() as ExpenseResponse);
      if (extraction.total == null && extraction.lineItems.length === 0) throw new Error("Textract found no totals or line items");
      return extraction;
    },
  };
}
