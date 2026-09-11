import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AgentDeskPage } from "@/pages/agent-desk";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));

const AWAITING_TASK = {
  id: "agt_1",
  client_id: "cli_1",
  client_name: "Ready Co",
  agent_name: "practice_coordinator",
  action_type: "categorization_review",
  autonomy: "approval_required",
  status: "awaiting_approval",
  confidence: 0.87,
  recommendation_json: { category: "Supplies", reason: "AI extraction" },
  created_at: new Date().toISOString(),
};

describe("AgentDeskPage", () => {
  it("shows the calm empty state when no recommendations await approval", async () => {
    const { api } = await import("@/lib/api");
    (api as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ tasks: [] });

    render(<MemoryRouter><AgentDeskPage /></MemoryRouter>);

    expect(await screen.findByText(/No agent recommendations are awaiting approval/i)).toBeInTheDocument();
  });

  it("lists awaiting recommendations with a deep link to the client and confidence", async () => {
    const { api } = await import("@/lib/api");
    (api as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ tasks: [AWAITING_TASK] });

    render(<MemoryRouter><AgentDeskPage /></MemoryRouter>);

    const clientLink = await screen.findByText("Ready Co");
    expect(clientLink.closest("a")).toHaveAttribute("href", "/clients/cli_1");
    expect(await screen.findByText(/87% confidence/)).toBeInTheDocument();
    expect(screen.getByText("categorization review")).toBeInTheDocument();
  });

  it("approves through the client-scoped endpoint and removes the task from the list", async () => {
    const { api } = await import("@/lib/api");
    const apiMock = api as unknown as ReturnType<typeof vi.fn>;
    apiMock.mockResolvedValue({ tasks: [AWAITING_TASK] });

    render(<MemoryRouter><AgentDeskPage /></MemoryRouter>);

    apiMock.mockResolvedValueOnce({ task: { ...AWAITING_TASK, status: "approved" } });
    fireEvent.click(await screen.findByText("Approve"));

    await waitFor(() => {
      const call = apiMock.mock.calls.find((c) => (c[0] as string).includes("/agent-tasks/agt_1"));
      expect(call).toBeDefined();
      const patch = call![1] as { method: string };
      expect(patch.method).toBe("PATCH");
    });
    await waitFor(() => {
      expect(screen.queryByText("Ready Co")).not.toBeInTheDocument();
    });
  });
});