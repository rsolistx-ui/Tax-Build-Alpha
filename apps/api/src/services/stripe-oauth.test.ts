import { describe, expect, it } from "vitest";
import { buildStripeOAuthUrl } from "./stripe-oauth";

describe("buildStripeOAuthUrl", () => {
  it("uses Stripe's hosted authorization endpoint and binds the callback to state", () => {
    const url = new URL(buildStripeOAuthUrl({
      clientId: "ca_test_123",
      redirectUri: "https://app.truepost.example/api/stripe/oauth/callback",
      state: "one-time-state",
    }));

    expect(url.origin).toBe("https://connect.stripe.com");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("read_write");
    expect(url.searchParams.get("state")).toBe("one-time-state");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.truepost.example/api/stripe/oauth/callback");
  });
});
