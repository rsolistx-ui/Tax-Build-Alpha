import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_URL || "";

type PortalClient = { id: string; name: string };
type PortalRequest = { id: string; title: string; description: string | null; status: string; request_type: string };
type PortalMessage = { id: string; author_type: string; body: string; created_at: string };

async function portalApi<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) throw new Error("Something went wrong. Your link may have expired.");
  return res.json() as Promise<T>;
}

function label(value: string): string {
  return value.replace(/_/g, " ");
}

/**
 * Mobile-first client portal. Authenticated by a bearer token in the URL,
 * never a Better Auth session - a client is not a Folio staff account.
 * Shows only this client's own engagements, requests, and client-visible
 * documents; all scoping happens server-side from the token.
 */
export function PortalPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [client, setClient] = useState<PortalClient | null>(null);
  const [requests, setRequests] = useState<PortalRequest[]>([]);
  const [selected, setSelected] = useState<PortalRequest | null>(null);
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("This link is missing its access token.");
      return;
    }
    (async () => {
      try {
        const [meData, requestsData] = await Promise.all([
          portalApi<{ client: PortalClient }>(token, "/api/portal/me"),
          portalApi<{ requests: PortalRequest[] }>(token, "/api/portal/requests"),
        ]);
        setClient(meData.client);
        setRequests(requestsData.requests);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load your portal");
      }
    })();
  }, [token]);

  async function openRequest(request: PortalRequest) {
    setSelected(request);
    try {
      const data = await portalApi<{ request: PortalRequest; messages: PortalMessage[] }>(token, `/api/portal/requests/${request.id}`);
      setMessages(data.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open this request");
    }
  }

  async function sendReply() {
    if (!selected || !reply.trim()) return;
    try {
      await portalApi(token, `/api/portal/requests/${selected.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: reply.trim() }),
      });
      setReply("");
      await openRequest(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send your reply");
    }
  }

  if (error) {
    return <div className="mx-auto max-w-md p-6 text-center text-sm text-[var(--color-destructive)]">{error}</div>;
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <div>
        <p className="text-xs text-[var(--color-muted-foreground)]">Folio client portal</p>
        <h1 className="text-lg font-semibold">{client ? client.name : "Loading..."}</h1>
      </div>

      {selected ? (
        <div className="space-y-3">
          <button className="text-sm text-[var(--color-muted-foreground)]" onClick={() => setSelected(null)}>&larr; Back to requests</button>
          <div className="rounded-md border border-[var(--color-border)] p-3">
            <p className="font-medium">{selected.title}</p>
            {selected.description ? <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{selected.description}</p> : null}
          </div>
          <div className="space-y-2">
            {messages.map((m) => (
              <div key={m.id} className={`rounded-md p-2 text-sm ${m.author_type === "client" ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-muted)]"}`}>
                {m.body}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="h-10 flex-1 rounded-md border border-[var(--color-border)] px-3 text-sm"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Type a reply"
            />
            <button className="rounded-md bg-[var(--color-primary)] px-4 text-sm text-white" onClick={sendReply}>Send</button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {requests.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">Nothing needs your attention right now.</p>
          ) : (
            requests.map((r) => (
              <button
                key={r.id}
                onClick={() => openRequest(r)}
                className="w-full rounded-md border border-[var(--color-border)] p-3 text-left text-sm"
              >
                <p className="font-medium">{r.title}</p>
                <p className="text-xs text-[var(--color-muted-foreground)]">{label(r.status)}</p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
