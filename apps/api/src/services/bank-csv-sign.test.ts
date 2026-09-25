import { describe, expect, it } from "vitest";
import { cardSignCheck } from "./bank-csv";

describe("cardSignCheck", () => {
  it("passes a card file where charges are money out and payments money in", () => {
    const r = cardSignCheck([
      { description: "OFFICE DEPOT", amount: -40 },
      { description: "SHELL OIL", amount: -60 },
      { description: "ADOBE", amount: -20 },
      { description: "PAYMENT - THANK YOU", amount: 500 },
    ]);
    expect(r.looksInverted).toBe(false);
  });

  it("flags an Amex-style file where charges come in positive", () => {
    const r = cardSignCheck([
      { description: "OFFICE DEPOT", amount: 40 },
      { description: "SHELL OIL", amount: 60 },
      { description: "ADOBE", amount: 20 },
      { description: "AUTOPAY PAYMENT", amount: -500 },
    ]);
    expect(r).toMatchObject({ looksInverted: true, positiveCharges: 3, negativePayments: 1 });
  });

  it("flags payments that all read as spending even with few charges", () => {
    expect(cardSignCheck([{ description: "ONLINE PAYMENT", amount: -300 }, { description: "AUTOPAY", amount: -200 }]).looksInverted).toBe(true);
  });

  it("does not flag a refund-heavy month or a single merchant named payment", () => {
    const refunds = [-30, -40, -50, 20, 25, 30, 35, 40].map((amount, i) => ({ description: `STORE ${i}`, amount }));
    expect(cardSignCheck(refunds).looksInverted).toBe(false);
    expect(cardSignCheck([{ description: "PAYMENT CENTER LLC", amount: -15 }, { description: "A", amount: -5 }]).looksInverted).toBe(false);
  });

  it("does not guess from one or two charges and no payments", () => {
    expect(cardSignCheck([{ description: "REFUND", amount: 20 }, { description: "STORE", amount: 5 }]).looksInverted).toBe(false);
  });
});
