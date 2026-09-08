import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RequestsPanel } from "@/components/requests-panel";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));

const DRAFT = { id: "creq_draft", request_type: "missing_receipt", title: "Receipt needed", description: null, status: "draft", due_at: null, created_at: "2026-01-01" };
const RESPONDED = { id: "creq_resp", request_type: "tax_document", title: "Upload W-2", description: null, status: "responded", due_at: "2026-04-01", created_at: "2026-01-01" };

describe("RequestsPanel", () => {
  it("creates a manual request with a due date", async () => {
    const { api } = await import("@/lib/api");
    const apiMock = api as unknown as ReturnType<typeof vi.fn>;
    apiMock.mockResolvedValue({ requests: [] });

    render(<RequestsPanel clientId="cli_1" />);
    await screen.findByPlaceholderText(/1099-NEC/);

    fireEvent.change(screen.getByPlaceholderText(/1099-NEC/), { target: { value: "Send bank statement" } });
    fireEvent.click(screen.getByText("Send request"));

    await waitFor(() => {
      const createCall = apiMock.mock.calls.find((c) => c[0] === "/api/clients/cli_1/requests" && c[1]?.method === "POST");
      expect(createCall).toBeDefined();
      expect(JSON.parse(createCall![1].body as string).title).toBe("Send bank statement");
    });
  });

  it("approves a draft request", async () => {
    const { api } = await import("@/lib/api");
    const apiMock = api as unknown as ReturnType<typeof vi.fn>;
    apiMock.mockResolvedValue({ requests: [DRAFT] });

    render(<RequestsPanel clientId="cli_1" />);
    fireEvent.click(await screen.findByText("Approve and send"));

    await waitFor(() => {
      expect(apiMock.mock.calls.some((c) => c[0] === "/api/clients/cli_1/requests/creq_draft/approve")).toBe(true);
    });
  });

  it("satisfies a responded request and shows its due date", async () => {
    const { api } = await import("@/lib/api");
    const apiMock = api as unknown as ReturnType<typeof vi.fn>;
    apiMock.mockResolvedValue({ requests: [RESPONDED] });

    render(<RequestsPanel clientId="cli_1" />);
    expect(await screen.findByText(/due 4\/1\/2026|due.*2026/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Mark resolved"));

    await waitFor(() => {
      expect(apiMock.mock.calls.some((c) => c[0] === "/api/clients/cli_1/requests/creq_resp/satisfy")).toBe(true);
    });
  });

  it("issues a full secure portal link with the token in the URL fragment, never a naked query-string token, and drops the old 'one-time token' language", async () => {
    const { api } = await import("@/lib/api");
    const apiMock = api as unknown as ReturnType<typeof vi.fn>;
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/clients/cli_1/requests") return Promise.resolve({ requests: [] });
      if (path === "/api/clients/cli_1/portal-links") {
        return Promise.resolve({ link: { token: "sekret123", expiresAt: "2026-12-31T00:00:00Z" } });
      }
      return Promise.resolve({});
    });

    render(<RequestsPanel clientId="cli_1" />);
    fireEvent.click(await screen.findByText("Issue portal link"));

    const linkText = await screen.findByText(/\/portal#token=sekret123/);
    expect(linkText.textContent).not.toContain("?token=");
    expect(linkText.textContent).toContain("#token=sekret123");
    expect(screen.queryByText(/one-time token/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Valid until/)).toBeInTheDocument();
  });
});
