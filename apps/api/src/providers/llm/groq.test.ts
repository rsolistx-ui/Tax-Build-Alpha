import { afterEach, describe, expect, it, vi } from "vitest";
import { createGroqProvider, groqRetryAfterSeconds } from "./groq";

const receipt = JSON.stringify({ merchant: "Test Supply", total: 64.95, date: "2026-09-05", currency: "USD", lineItems: [] });
const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: receipt } }] }), { status: 200 });
const limited = (wait: string) => new Response(JSON.stringify({ error: { message: `Rate limit reached ... Please try again in ${wait}. Need more tokens?` } }), { status: 429 });

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("groqRetryAfterSeconds", () => {
  it("reads the wait Groq asks for", () => {
    expect(groqRetryAfterSeconds("Please try again in 2.94s.")).toBe(2.94);
    expect(groqRetryAfterSeconds("no hint here")).toBeNull();
  });
});

describe("Groq reader", () => {
  const input = { bytes: new Uint8Array([1, 2, 3]).buffer, contentType: "image/png", filename: "r.png" } as any;

  it("caps output at the free tier's 1,000 tokens", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());
    await createGroqProvider("k").extractReceipt(input);
    expect(JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)).max_completion_tokens).toBe(1000);
  });

  it("waits and retries once when Groq asks for a short pause", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(limited("2.94s")).mockResolvedValueOnce(ok());
    const pending = createGroqProvider("k").extractReceipt(input);
    await vi.runAllTimersAsync();
    expect((await pending).total).toBe(64.95);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not wait on long pauses", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(limited("45s"));
    await expect(createGroqProvider("k").extractReceipt(input)).rejects.toThrow(/Groq error 429/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
