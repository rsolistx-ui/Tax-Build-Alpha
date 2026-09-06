/**
 * Pure helpers for the invitation-link fragment scheme, kept dependency-free
 * so they can be unit tested directly. The invitation token is a one-time
 * secret and must never appear in a URL query string (query strings are
 * sent to the server, appear in browser history/autocomplete, and are
 * commonly logged by servers and proxies). The URL fragment (`#...`) is
 * never transmitted in an HTTP request, so it is the only place this token
 * belongs.
 */
export function buildInvitationLink(origin: string, token: string, email: string): string {
  const fragment = new URLSearchParams({ token, email }).toString();
  return `${origin}/signup#${fragment}`;
}

export function parseInvitationFragment(hash: string): { token: string | null; email: string | null } {
  const cleaned = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(cleaned);
  return { token: params.get("token"), email: params.get("email") };
}
