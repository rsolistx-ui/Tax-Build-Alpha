export type ReceiptLineItem = {
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  category: string | null;
  confidence: number;
};

export type ReceiptExtraction = {
  date: string | null;
  merchant: string | null;
  paymentMethod?: string | null;
  cardLast4?: string | null;
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  total: number | null;
  currency: string;
  category: string | null;
  confidence: number;
  lineItems: ReceiptLineItem[];
};

export type ReceiptBusinessContext = {
  clientName?: string;
  entityType?: string | null;
  industry?: string | null;
  state?: string | null;
  accountingBasis?: string | null;
  categories?: string[];
  markdownRules?: string;
};

export type LlmProvider = {
  name: string;
  model: string;
  extractReceipt(input: {
    bytes: ArrayBuffer | ArrayBuffer[];
    contentType: string;
    filename: string;
    context?: ReceiptBusinessContext;
    isMultiPage?: boolean;
  }): Promise<ReceiptExtraction>;
};
