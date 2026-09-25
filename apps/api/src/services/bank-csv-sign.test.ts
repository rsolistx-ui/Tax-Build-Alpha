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
    expect(cardSignCheck([{ description: "ONLINE PAYMENT", amount: -300 }]).looksInverted).toBe(true);
  });

  it("does not guess from one or two charges and no payments", () => {
    expect(cardSignCheck([{ description: "REFUND", amount: 20 }, { description: "STORE", amount: 5 }]).looksInverted).toBe(false);
  });
});
