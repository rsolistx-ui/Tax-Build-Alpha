import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

/**
 * Dev: leave VITE_API_URL unset so requests go through the Vite proxy (/api → :8787)
 * and session cookies stay same-origin on localhost:5173.
 * Prod: set VITE_API_URL to the Worker URL and configure CORS + trustedOrigins.
 */
const baseURL = import.meta.env.VITE_API_URL || window.location.origin;

export const authClient = createAuthClient({
  baseURL,
  plugins: [twoFactorClient(), passkeyClient()],
});
