import type { ReceiptExtraction } from "../providers/llm";

export type ValidationCheck = {
  code: string;
  label: string;
  status: "pass" | "warning" | "fail" | "skipped";
  expected?: number | null;
  actual?: number | null;
  difference?: number | null;
  message: string;
};

export type ReceiptValidation = {
  status: "pass" | "warning" | "fail";
  lineItemsTotal: number | null;
  checks: ValidationCheck[];
};

const TOLERANCE = 0.02;

export function validateReceipt(extraction: ReceiptExtraction): ReceiptValidation {
  const checks: ValidationCheck[] = [];
  const itemAmounts = extraction.lineItems
    .map((item) => item.amount)
    .filter((amount): amount is number => amount != null && Number.isFinite(amount));
  const lineItemsTotal = itemAmounts.length > 0 ? money(itemAmounts.reduce((sum, amount) => sum + amount, 0)) : null;

  if (extraction.total == null) {
    checks.push({
      code: "total_present",
      label: "Receipt total",
      status: "fail",
      message: "No receipt total was extracted.",
    });
  } else {
    checks.push({
      code: "total_present",
      label: "Receipt total",
      status: "pass",
      actual: money(extraction.total),
      message: "Receipt total is present.",
    });
  }

  // Without a date the receipt cannot be placed in a tax year or meet IRC § 274(d) substantiation.
  checks.push(extraction.date
    ? { code: "date_present", label: "Receipt date", status: "pass", message: "Receipt date is present." }
    : { code: "date_present", label: "Receipt date", status: "warning", message: "No receipt date was extracted. Enter the date from the receipt before filing." });

  if (extraction.lineItems.length === 0) {
    checks.push({
      code: "line_items_present",
      label: "Line items",
      status: "warning",
      message: "No line items were extracted. A professional should verify the source document.",
    });
  } else {
    checks.push({
      code: "line_items_present",
      label: "Line items",
      status: "pass",
      message: `${extraction.lineItems.length} line item(s) extracted.`,
    });
  }

  if (lineItemsTotal != null && extraction.subtotal != null) {
    checks.push(compareMoney(
      "items_to_subtotal",
      "Items equal subtotal",
      money(extraction.subtotal),
      lineItemsTotal,
      "Line item sum matches the receipt subtotal.",
      "Line item sum does not match the receipt subtotal.",
      "warning",
    ));
  } else {
    checks.push({
      code: "items_to_subtotal",
      label: "Items equal subtotal",
      status: "skipped",
      message: "Subtotal comparison needs both item amounts and a subtotal.",
    });
  }

  if (extraction.subtotal != null && extraction.total != null) {
    const expected = money(
      extraction.subtotal + (extraction.tax ?? 0) + (extraction.tip ?? 0),
    );
    checks.push(compareMoney(
      "subtotal_tax_tip_to_total",
      "Subtotal + tax + tip equals total",
      money(extraction.total),
      expected,
      "Receipt arithmetic balances.",
      "Receipt arithmetic does not balance.",
      "fail",
    ));
  } else {
    checks.push({
      code: "subtotal_tax_tip_to_total",
      label: "Subtotal + tax + tip equals total",
      status: "skipped",
      message: "Grand-total arithmetic needs both subtotal and total.",
    });
  }

  const lowConfidenceItems = extraction.lineItems.filter((item) => item.confidence < 0.7).length;
  if (extraction.confidence < 0.7 || lowConfidenceItems > 0) {
    checks.push({
      code: "confidence",
      label: "Extraction confidence",
      status: "warning",
      message: lowConfidenceItems > 0
        ? `${lowConfidenceItems} line item(s) are below 70% confidence.`
        : "Receipt extraction is below 70% confidence.",
    });
  } else {
    checks.push({
      code: "confidence",
      label: "Extraction confidence",
      status: "pass",
      message: "Extraction confidence is at least 70%.",
    });
  }

  const status = checks.some((check) => check.status === "fail")
    ? "fail"
    : checks.some((check) => check.status === "warning")
      ? "warning"
      : "pass";

  return { status, lineItemsTotal, checks };
}

function compareMoney(
  code: string,
  label: string,
  expected: number,
  actual: number,
  passMessage: string,
  failMessage: string,
  mismatchStatus: "warning" | "fail",
): ValidationCheck {
  const difference = money(actual - expected);
  const matches = Math.abs(difference) <= TOLERANCE;
  return {
    code,
    label,
    status: matches ? "pass" : mismatchStatus,
    expected,
    actual,
    difference,
    message: matches ? passMessage : `${failMessage} Difference: $${Math.abs(difference).toFixed(2)}.`,
  };
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
