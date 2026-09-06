import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LockedScreen } from "@/components/locked";

describe("LockedScreen", () => {
  it("shows the expired-access message for BETA_EXPIRED", () => {
    render(<LockedScreen reason="BETA_EXPIRED" />);
    expect(screen.getByText(/Beta access has expired/i)).toBeInTheDocument();
  });

  it("shows the revoked-access message for BETA_REVOKED", () => {
    render(<LockedScreen reason="BETA_REVOKED" />);
    expect(screen.getByText(/Beta access has been revoked/i)).toBeInTheDocument();
  });

  it("shows a sign-out control so a locked-out user can still leave the session", () => {
    render(<LockedScreen reason="BETA_REQUIRED" />);
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("never renders financial figures like a zero-dollar report on the locked screen", () => {
    render(<LockedScreen reason="BETA_EXPIRED" />);
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(screen.queryByText(/income/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/expenses/i)).not.toBeInTheDocument();
  });
});
