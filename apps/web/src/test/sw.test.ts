import { describe, expect, it, vi, beforeEach } from "vitest";
import swSource from "../../public/sw.js?raw";

function loadServiceWorker() {
  const listeners: Record<string, Array<(event: unknown) => void>> = {};
  const self = {
    location: { origin: "https://folio-api.rsolistx.workers.dev" },
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      (listeners[type] ??= []).push(fn);
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  const cache = { addAll: vi.fn(), match: vi.fn() };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => []),
    match: vi.fn(async () => undefined),
    delete: vi.fn(),
  };
  const fetchImpl = vi.fn(async () => new Response("ok"));
  // eslint-disable-next-line no-new-func
  const runner = new Function("self", "caches", "fetch", swSource);
  runner(self, caches, fetchImpl);
  return { listeners, self, caches, fetchImpl };
}

function makeFetchEvent(url: string, method = "GET") {
  let responded: Promise<unknown> | null = null;
  return {
    request: { url, method },
    respondWith: (p: Promise<unknown>) => {
      responded = p;
    },
    get responded() {
      return responded;
    },
  };
}

describe("Folio PWA service worker", () => {
  let sw: ReturnType<typeof loadServiceWorker>;

  beforeEach(() => {
    sw = loadServiceWorker();
  });

  it("registers install, activate, and fetch handlers", () => {
    expect(sw.listeners.install?.length).toBeGreaterThan(0);
    expect(sw.listeners.activate?.length).toBeGreaterThan(0);
    expect(sw.listeners.fetch?.length).toBeGreaterThan(0);
  });

  it("never intercepts any /api/* request", () => {
    const fetchHandler = sw.listeners.fetch[0];
    const event = makeFetchEvent("https://folio-api.rsolistx.workers.dev/api/clients/cli_1/pnl");
    fetchHandler(event);
    expect(event.responded).toBeNull();
  });

  it("never intercepts a receipt source request", () => {
    const fetchHandler = sw.listeners.fetch[0];
    const event = makeFetchEvent("https://folio-api.rsolistx.workers.dev/api/clients/cli_1/receipts/rcp_1/source");
    fetchHandler(event);
    expect(event.responded).toBeNull();
  });

  it("never intercepts a general client document source request", () => {
    const fetchHandler = sw.listeners.fetch[0];
    const event = makeFetchEvent("https://folio-api.rsolistx.workers.dev/api/clients/cli_1/documents/doc_1/source");
    fetchHandler(event);
    expect(event.responded).toBeNull();
  });

  it("never intercepts the cross-client document review queue", () => {
    const fetchHandler = sw.listeners.fetch[0];
    const event = makeFetchEvent("https://folio-api.rsolistx.workers.dev/api/documents/review");
    fetchHandler(event);
    expect(event.responded).toBeNull();
  });

  it("never intercepts a bank transactions request", () => {
    const fetchHandler = sw.listeners.fetch[0];
    const event = makeFetchEvent("https://folio-api.rsolistx.workers.dev/api/clients/cli_1/bank-transactions");
    fetchHandler(event);
    expect(event.responded).toBeNull();
  });

  it("never intercepts an auth request", () => {
    const fetchHandler = sw.listeners.fetch[0];
    const event = makeFetchEvent("https://folio-api.rsolistx.workers.dev/api/auth/sign-out");
    fetchHandler(event);
    expect(event.responded).toBeNull();
  });

  it("never intercepts a non-GET request even for an allowed path", () => {
    const fetchHandler = sw.listeners.fetch[0];
    const event = makeFetchEvent("https://folio-api.rsolistx.workers.dev/manifest.webmanifest", "POST");
    fetchHandler(event);
    expect(event.responded).toBeNull();
  });

  it("only ever serves the fixed static app-shell allowlist, not arbitrary paths", () => {
    const fetchHandler = sw.listeners.fetch[0];
    const disallowed = makeFetchEvent("https://folio-api.rsolistx.workers.dev/some/random/path");
    fetchHandler(disallowed);
    expect(disallowed.responded).toBeNull();

    const allowed = makeFetchEvent("https://folio-api.rsolistx.workers.dev/manifest.webmanifest");
    fetchHandler(allowed);
    expect(allowed.responded).not.toBeNull();
  });
});
