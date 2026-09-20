import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReceiptReview, type ReviewReceipt } from "@/components/receipt-review";

vi.mock("@/lib/api", () => ({ api: vi.fn(), apiUrl: (path: string) => path }));

const rememberedReceipt: ReviewReceipt = {
  id: "rcp_1",
  filename: "office-depot.pdf",
  content_type: "application/pdf",
  status: "review",
  extracted_date: "2026-01-05",
  extracted_merchant: "Office Depot",
  extracted_subtotal: 49.99,
  extracted_tax: 0,
  extracted_tip: null,
  extracted_total: 49.99,
  extracted_currency: "USD",
  extracted_category: "supplies",
  remembered_category: "supplies",
  confidence: 0.91,
  provider: "test",
  model: "test",
  validation_status: "pass",
  validation_json: { checks: [] },
  lineItems: [],
  source_url: "about:blank",
};

const categories = [
  { id: "cat_supplies", name: "Supplies", slug: "supplies" },
  { id: "cat_software", name: "Software", slug: "software" },
];

describe("ReceiptReview remembered-category confirmation", () => {
  it("shows the Folio remembered note only while the category matches the remembered one", () => {
    render(
      <ReceiptReview clientId="cli_1" categories={categories} receipts={[rememberedReceipt]} onReload={() => Promise.resolve()} />,
    );

    const note = screen.getByTestId("remembered-category-note");
    expect(note).toHaveTextContent(/Folio remembered Supplies/i);
    expect(note).toHaveTextContent(/for this merchant/i);

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "software" } });
    expect(screen.queryByTestId("remembered-category-note")).not.toBeInTheDocument();
  });

  it("omits the note when the receipt category was not set by merchant memory", () => {
    const manual = { ...rememberedReceipt, remembered_category: null };
    render(
      <ReceiptReview clientId="cli_1" categories={categories} receipts={[manual]} onReload={() => Promise.resolve()} />,
    );
    expect(screen.queryByTestId("remembered-category-note")).not.toBeInTheDocument();
  });
});
