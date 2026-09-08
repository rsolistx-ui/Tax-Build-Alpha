import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PortalPage } from "@/pages/portal";

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
}

const HOME = {
  client: { id: "cli_1", name: "Acme Co" },
  activeEngagements: [
    { id: "eng_1", service_type: "bookkeeping", title: "x", status: "active", due_date: null, tax_year: 2025, total_work_items: 4, completed_work_items: 1 },
  ],
  outstandingRequestCount: 1,
  overdueRequests: [],
  dueRequests: [{ id: "creq_1", title: "Upload W-2", description: null, status: "requested", request_type: "tax_document", due_at: null }],
  recentlyCompletedRequests: [],
};

beforeEach(() => {
  sessionStorage.clear();
  window.location.hash = "";
  window.history.replaceState(null, "", "/portal");
});

describe("PortalPage", () => {
  it("reads the token from the URL fragment, stores it in sessionStorage, and strips the fragment from the visible URL", async () => {
    window.location.hash = "#token=abc123";
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse(HOME));
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryRouter><PortalPage /></MemoryRouter>);

    await screen.findByText("Acme Co");
    expect(sessionStorage.getItem("folio_portal_token")).toBe("abc123");
    expect(window.location.hash).toBe("");

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer abc123");

    vi.unstubAllGlobals();
  });

  it("renders the home summary: engagement progress and an outstanding request", async () => {
    window.location.hash = "#token=abc123";
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => jsonResponse(HOME)));

    render(<MemoryRouter><PortalPage /></MemoryRouter>);

    expect(await screen.findByText(/1\/4 complete/)).toBeInTheDocument();
    expect(screen.getByText("Upload W-2")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("renders a safe error, not a crash, when the token is rejected (e.g. cross-client or revoked)", async () => {
    window.location.hash = "#token=bad";
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => jsonResponse({ error: "Unauthorized" }, false)));

    render(<MemoryRouter><PortalPage /></MemoryRouter>);

    expect(await screen.findByText(/expired or been revoked/i)).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("shows a missing-token error and never calls the API when there is no fragment and nothing in sessionStorage", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryRouter><PortalPage /></MemoryRouter>);

    expect(await screen.findByText(/missing its access token/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("opens a request, shows its documents tab, sends a reply, and uploads evidence", async () => {
    window.location.hash = "#token=abc123";
    const requestDetail = { request: HOME.dueRequests[0], messages: [{ id: "m1", author_type: "professional", body: "Please upload your W-2", created_at: "2026-01-01" }] };
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/portal/home")) return jsonResponse(HOME);
      if (url.includes("/api/portal/documents")) return jsonResponse({ documents: [{ id: "doc_1", filename: "w2.pdf", document_type: "tax_document", status: "needs_review", uploaded_at: "2026-01-01" }] });
      if (url.match(/\/requests\/creq_1$/)) return jsonResponse(requestDetail);
      if (url.includes("/messages")) return jsonResponse({ message: {} });
      if (url.includes("/evidence")) return jsonResponse({ documentId: "doc_2" });
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryRouter><PortalPage /></MemoryRouter>);
    fireEvent.click(await screen.findByText("Upload W-2"));

    expect(await screen.findByText("Please upload your W-2")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Type a reply"), { target: { value: "Here it is" } });
    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes("/messages"))).toBe(true);
    });

    vi.unstubAllGlobals();
  });
});
