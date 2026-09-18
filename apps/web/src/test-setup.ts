import { vi, afterEach } from 'vitest';
import '@testing-library/jest-dom';

// Mock Response for service worker tests
if (!globalThis.Response) {
  globalThis.Response = class Response {
    constructor(body?: BodyInit | null, init?: ResponseInit) {
      return new (globalThis as any).Response(body, init);
    }
  } as any;
}

// Clean up after each test
afterEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  vi.resetModules();
});