import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EngagementsPanel } from "@/components/engagements-panel";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));

const ENGAGEMENT = {
  id: "eng_1",
  service_type: "bookkeeping",
  title: "2025 monthly bookkeeping",
  status: "active",
  due_date: "2026-04-15",
  start_date: null,
  recurrence: null,
  tax_year: 2025,
  total_work_items: 8,
  completed_work_items: 3,
  open_professional_work_items: 2,
  waiting_on_client_work_items: 1,
};

describe("EngagementsPanel", () => {
  it("renders due date, tax year, and progress counts for an engagement", async () => {
    const { api } = await import("@/lib/api");
    (api as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ engagements: [ENGAGEMENT] });

    render(<EngagementsPanel clientId="cli_1" />);

    expect(await screen.findByText("2025 monthly bookkeeping")).toBeInTheDocument();
    expect(screen.getByText(/tax year 2025/)).toBeInTheDocument();
    expect(screen.getByText(/8 work items, 3 complete \(38%\)/)).toBeInTheDocument();
    expect(screen.getByText(/2 open for you/)).toBeInTheDocument();
    expect(screen.getByText(/1 waiting on client/)).toBeInTheDocument();
  });

  it("submits serviceType, title, dueDate, and taxYear when creating a new engagement", async () => {
    const { api } = await import("@/lib/api");
    const apiMock = api as unknown as ReturnType<typeof vi.fn>;
    apiMock.mockResolvedValue({ engagements: [] });

    render(<EngagementsPanel clientId="cli_1" />);
    await screen.findByPlaceholderText(/2025 monthly bookkeeping/);

    fireEvent.change(screen.getByPlaceholderText(/2025 monthly bookkeeping/), { target: { value: "Q1 close" } });
    fireEvent.click(screen.getByText("New engagement"));

    await waitFor(() => {
      const createCall = apiMock.mock.calls.find((c) => c[0] === "/api/clients/cli_1/engagements" && c[1]?.method === "POST");
      expect(createCall).toBeDefined();
      const body = JSON.parse(createCall![1].body as string);
      expect(body.title).toBe("Q1 close");
      expect(body.serviceType).toBe("bookkeeping");
    });
  });

  it("sends a status update when the status select changes", async () => {
    const { api } = await import("@/lib/api");
    const apiMock = api as unknown as ReturnType<typeof vi.fn>;
    apiMock.mockResolvedValue({ engagements: [ENGAGEMENT] });

    render(<EngagementsPanel clientId="cli_1" />);
    await screen.findByText("2025 monthly bookkeeping");

    const selects = screen.getAllByRole("combobox");
    const statusSelect = selects.find((s) => (s as HTMLSelectElement).value === "active")!;
    fireEvent.change(statusSelect, { target: { value: "ready" } });

    await waitFor(() => {
      const statusCall = apiMock.mock.calls.find((c) => c[0] === "/api/clients/cli_1/engagements/eng_1/status");
      expect(statusCall).toBeDefined();
      expect(JSON.parse(statusCall![1].body as string)).toEqual({ status: "ready" });
    });
  });
});
