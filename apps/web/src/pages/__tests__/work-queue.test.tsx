import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WorkQueuePage } from "@/pages/work-queue";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));

const REQUEST_ITEM = {
  id: "wi_1", client_id: "cli_1", engagement_id: null, title: "Chase receipt", status: "waiting_on_client",
  priority: "normal", due_at: null, source_type: "client_request", source_id: "creq_9",
};
const ENGAGEMENT_ITEM = {
  id: "wi_2", client_id: "cli_1", engagement_id: "eng_5", title: "Reconcile accounts", status: "open",
  priority: "high", due_at: null, source_type: "service_template", source_id: "bookkeeping",
};

describe("WorkQueuePage", () => {
  it("loads with no view parameter for the default 'All open' tab", async () => {
    const { api } = await import("@/lib/api");
    const apiMock = api as unknown as ReturnType<typeof vi.fn>;
    apiMock.mockResolvedValue({ items: [], nextCursor: null });

    render(<MemoryRouter><WorkQueuePage /></MemoryRouter>);

    await waitFor(() => {
      const call = apiMock.mock.calls[0][0] as string;
      expect(call).not.toContain("view=");
      expect(call).not.toContain("status=");
    });
  });

  it("requests the matching view when a filter button is clicked", async () => {
    const { api } = await import("@/lib/api");
    const apiMock = api as unknown as ReturnType<typeof vi.fn>;
    apiMock.mockResolvedValue({ items: [], nextCursor: null });

    render(<MemoryRouter><WorkQueuePage /></MemoryRouter>);
    fireEvent.click(await screen.findByText("Overdue"));

    await waitFor(() => {
      expect(apiMock.mock.calls.some((c) => (c[0] as string).includes("view=overdue"))).toBe(true);
    });
  });

  it("deep-links a client_request item to its request focus, and an engagement-scoped item to its engagement focus", async () => {
    const { api } = await import("@/lib/api");
    const apiMock = api as unknown as ReturnType<typeof vi.fn>;
    apiMock.mockResolvedValue({ items: [REQUEST_ITEM, ENGAGEMENT_ITEM], nextCursor: null });

    render(<MemoryRouter><WorkQueuePage /></MemoryRouter>);

    const requestLink = (await screen.findByText("Chase receipt")).closest("a");
    expect(requestLink).toHaveAttribute("href", "/clients/cli_1?tab=requests&focus=creq_9");

    const engagementLink = screen.getByText("Reconcile accounts").closest("a");
    expect(engagementLink).toHaveAttribute("href", "/clients/cli_1?tab=engagements&focus=eng_5");
  });

  it("shows Load more only when a nextCursor is present, and appends items using it", async () => {
    const { api } = await import("@/lib/api");
    const apiMock = api as unknown as ReturnType<typeof vi.fn>;
    apiMock.mockResolvedValueOnce({ items: [REQUEST_ITEM], nextCursor: "2026-01-01T00:00:00Z|wi_1" });

    render(<MemoryRouter><WorkQueuePage /></MemoryRouter>);
    const loadMoreButton = await screen.findByText("Load more");

    apiMock.mockResolvedValueOnce({ items: [ENGAGEMENT_ITEM], nextCursor: null });
    fireEvent.click(loadMoreButton);

    await waitFor(() => {
      const call = apiMock.mock.calls.find((c) => (c[0] as string).includes("cursor="));
      expect(call).toBeDefined();
      expect((call![0] as string)).toContain(encodeURIComponent("2026-01-01T00:00:00Z|wi_1"));
    });
    expect(await screen.findByText("Reconcile accounts")).toBeInTheDocument();
    expect(screen.queryByText("Load more")).not.toBeInTheDocument();
  });
});
