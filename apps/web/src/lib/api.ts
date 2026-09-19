export const API_BASE = import.meta.env.VITE_API_URL || "";

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export function getAdminToken(): string | null {
  try {
    return typeof window !== "undefined" ? sessionStorage.getItem("folio_admin_token") : null;
  } catch {
    return null;
  }
}

export function setAdminToken(token: string | null): void {
  try {
    if (typeof window === "undefined") return;
    if (token) sessionStorage.setItem("folio_admin_token", token.trim());
    else sessionStorage.removeItem("folio_admin_token");
  } catch {
    /* ignore */
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const adminToken = getAdminToken();
  if (adminToken && !headers.has("x-admin-token")) {
    headers.set("x-admin-token", adminToken);
  }

  const res = await fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers,
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}
