import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UniversalCommandPalette } from "@/components/universal-command-palette";

vi.mock("@/lib/api", () => ({ api: vi.fn().mockResolvedValue({ clients: [] }) }));

function renderAt(path: string, props: Partial<Parameters<typeof UniversalCommandPalette>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <UniversalCommandPalette isOpen onClose={() => {}} {...props} />
    </MemoryRouter>,
  );
}

describe("UniversalCommandPalette wiring", () => {
  it("hides the phone upload link outside a client page", () => {
    renderAt("/");
    expect(screen.queryByText("Launch Magic Phone Upload QR Link")).toBeNull();
  });

  it("on a client page, the phone upload link fires the event the client page listens for", () => {
    const listener = vi.fn();
    window.addEventListener("truepost:open-phone-link", listener);
    renderAt("/clients/cli_1");
    fireEvent.click(screen.getByText("Launch Magic Phone Upload QR Link"));
    window.removeEventListener("truepost:open-phone-link", listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("the support item opens the support modal instead of navigating to a missing route", () => {
    const onOpenSupportModal = vi.fn();
    renderAt("/", { onOpenSupportModal });
    fireEvent.click(screen.getByText("Connect with Phyllis VIP Concierge Support"));
    expect(onOpenSupportModal).toHaveBeenCalledTimes(1);
  });
});
