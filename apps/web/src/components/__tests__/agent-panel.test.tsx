import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AgentPanel } from "@/components/agent-panel";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));

const TASK = {
  id: "agt_1",
  client_id: "cli_1",
  source_type: "receipt",
  source_id: "rct_1",
  agent_name: "practice_coordinator",
  action_type: "categorization_review",
  autonomy: "approval_required",
  status: "awaiting_approval",
  confidence: 0.82,
  recommendation_json: { category: "Supplies", merchant: "Office Depot", reason: "AI extraction" },
  resolved_at: null,
  resolution_note: null,
  created_at: new Date().toISOString(),
};

const RULE = {
  id: "rule_1",
  rule_type: "merchant_category",
  match_key: "office depot",
  output_json: { category: "Supplies" },
  seen_count: 3,
  last_applied_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
};

describe("AgentPanel", () => {
  it("shows the calm empty state when no agent work has been triggered", async () => {
    const { api } = await import("@/lib/api");
    const apiMock = api as unknown as ReturnType<typeof vi.fn>;
    apiMock.mockResolvedValueOnce({ tasks: [] });
    apiMock.mockResolvedValueOnce({ rules: [] });

    render(<AgentPanel clientId="cli_1" />);

    expect(await screen.findByText(/No agent work has been triggered/i)).toBeInTheDocument();
    expect(screen.getByText(/No merchant rules remembered yet/i)).toBeInTheDocument();
  });

  it("lists agent tasks with recommendation details and resolution state", async () => {
    const { api } = await import("@/lib/api");
    const apiMock = api as unknown as ReturnType<typeof vi.fn>;
    apiMock.mockResolvedValueOnce({ tasks: [TASK] });
    apiMock.mockResolvedValueOnce({ rules: [RULE] });

    render(<AgentPanel clientId="cli_1" />);

    expect(await screen.findByText("categorization review")).toBeInTheDocument();
    expect(screen.getByText(/category: Supplies/i)).toBeInTheDocument();
    expect(screen.getByText(/merchant: Office Depot/i)).toBeInTheDocument();
    expect(screen.getByText(/82% confidence/)).toBeInTheDocument();
  });

  it("approves a task through the client-scoped endpoint and reloads to drop it from the awaiting list", async () => {
    const { api } = await import("@/lib/api");
    const apiMock = api as unknown as ReturnType<typeof vi.fn>;
    apiMock.mockResolvedValueOnce({ tasks: [TASK] });
    apiMock.mockResolvedValueOnce({ rules: [] });
    apiMock.mockResolvedValueOnce({ task: { ...TASK, status: "approved" } });
    apiMock.mockResolvedValueOnce({ tasks: [] });
    apiMock.mockResolvedValueOnce({ rules: [] });

    render(<AgentPanel clientId="cli_1" />);

    fireEvent.click(await screen.findByText("Approve"));

    await waitFor(() => {
      const call = apiMock.mock.calls.find((c) => (c[0] as string).includes("/agent-tasks/agt_1"));
      expect(call).toBeDefined();
      const patch = call![1] as { method: string };
      expect(patch.method).toBe("PATCH");
    });
    await waitFor(() => {
      expect(screen.queryByText("categorization review")).not.toBeInTheDocument();
    });
  });

  it("renders remembered merchant rules with category and applied count", async () => {
    const { api } = await import("@/lib/api");
    const apiMock = api as unknown as ReturnType<typeof vi.fn>;
    apiMock.mockResolvedValueOnce({ tasks: [] });
    apiMock.mockResolvedValueOnce({ rules: [RULE] });

    render(<AgentPanel clientId="cli_1" />);

    expect(await screen.findByText("office depot")).toBeInTheDocument();
    expect(screen.getByText("Supplies")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});