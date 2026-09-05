export type ReceiptExtraction = {
  date: string | null;
  merchant: string | null;
  amount: number | null;
  currency: string;
  category: string | null;
  confidence: number;
};

export type LlmProvider = {
  name: string;
  extractReceipt(input: {
    bytes: ArrayBuffer;
    contentType: string;
    filename: string;
  }): Promise<ReceiptExtraction>;
};
