import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RequestThread } from "./request-thread";

type ClientRequest = {
  id: string;
  request_type: string;
  title: string;
  description: string | null;
  status: string;
  due_at: string | null;
  created_at: string;
};

const REQUEST_TYPES = [
  "missing_receipt", "transaction_explanation", "bank_statement", "w2", "1099", "k1",
  "prior_year_return", "organizer_question", "signature_placeholder", "tax_document", "custom",
];

function label(value: string): string {
  return value.replace(/_/g, " ");
}

export function RequestsPanel({ clientId, focusRequestId }: { clientId: string; focusRequestId?: string | null }) {
  const [requests, setRequests] = useState<ClientRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [requestType, setRequestType] = useState(REQUEST_TYPES[0]);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [portalLink, setPortalLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!focusRequestId) return;
    const el = rowRefs.current[focusRequestId];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [requests, focusRequestId]);

  async function load() {
    try {
      const data = await api<{ requests: ClientRequest[] }>(`/api/clients/${clientId}/requests`);
      setRequests(data.requests);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load requests");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function createRequest() {
    if (!title.trim()) return;
    setError(null);
    try {
      await api(`/api/clients/${clientId}/requests`, {
        method: "POST",
        body: JSON.stringify({ requestType, title: title.trim(), dueAt: dueAt || null }),
      });
      setTitle("");
      setDueAt("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create request");
    }
  }

  async function approve(requestId: string) {
    try {
      await api(`/api/clients/${clientId}/requests/${requestId}/approve`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not approve request");
    }
  }

  async function satisfy(requestId: string) {
    try {
      await api(`/api/clients/${clientId}/requests/${requestId}/satisfy`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resolve request");
    }
  }

  async function cancel(requestId: string) {
    try {
      await api(`/api/clients/${clientId}/requests/${requestId}/cancel`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel request");
    }
  }

  async function issuePortalLink() {
    setError(null);
    try {
      const data = await api<{ link: { token: string; expiresAt: string } }>(`/api/clients/${clientId}/portal-links`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const url = `${window.location.origin}/portal#token=${encodeURIComponent(data.link.token)}`;
      setPortalLink({ url, expiresAt: data.link.expiresAt });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not issue a portal link");
    }
  }

  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <h3 className="text-sm font-semibold">Client portal access</h3>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Issue a secure link the client uses to view and respond to requests, with no separate login.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={issuePortalLink}>Issue portal link</Button>
        </CardContent>
        {portalLink ? (
          <CardContent className="border-t border-[var(--color-border)] p-4 text-xs">
            <p className="text-[var(--color-muted-foreground)]">
              Secure client portal link. Valid until {new Date(portalLink.expiresAt).toLocaleDateString()} unless revoked.
            </p>
            <p className="mt-1 break-all font-mono">{portalLink.url}</p>
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--color-muted-foreground)]">Request type</label>
            <select
              className="h-9 rounded-md border border-[var(--color-border)] bg-transparent px-2 text-sm"
              value={requestType}
              onChange={(e) => setRequestType(e.target.value)}
            >
              {REQUEST_TYPES.map((t) => (
                <option key={t} value={t}>{label(t)}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-1 min-w-[200px] flex-col gap-1">
            <label className="text-xs text-[var(--color-muted-foreground)]">Title</label>
            <input
              className="h-9 rounded-md border border-[var(--color-border)] bg-transparent px-2 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Please upload your 1099-NEC"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--color-muted-foreground)]">Due date</label>
            <input
              type="date"
              className="h-9 rounded-md border border-[var(--color-border)] bg-transparent px-2 text-sm"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </div>
          <Button size="sm" disabled={!title.trim()} onClick={createRequest}>Send request</Button>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

      {requests.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">No client requests yet.</p>
      ) : (
        <div className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
          {requests.map((req) => (
            <div
              key={req.id}
              ref={(el) => { rowRefs.current[req.id] = el; }}
              className={`flex flex-wrap items-center justify-between gap-2 p-3 text-sm ${req.id === focusRequestId ? "bg-[var(--color-primary)]/10 ring-1 ring-[var(--color-primary)]" : ""}`}
            >
              <div className="flex items-start gap-2">
                <Button size="sm" variant="ghost" onClick={() => setSelectedRequest(selectedRequest === req.id ? null : req.id)}>
                  {selectedRequest === req.id ? "Hide messages" : "Show messages"}
                </Button>
                <div>
                  <p className="font-medium">{req.title}</p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {label(req.request_type)}{req.due_at ? ` \u00b7 due ${new Date(req.due_at).toLocaleDateString()}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge>{label(req.status)}</Badge>
                {req.status === "draft" ? (
                  <Button size="sm" variant="outline" onClick={() => approve(req.id)}>Approve and send</Button>
                ) : null}
                {req.status === "responded" ? (
                  <Button size="sm" variant="outline" onClick={() => satisfy(req.id)}>Mark resolved</Button>
                ) : null}
                {req.status !== "satisfied" && req.status !== "cancelled" ? (
                  <Button size="sm" variant="ghost" onClick={() => cancel(req.id)}>Cancel</Button>
                ) : null}
              </div>
            </div>
          ))}
          {selectedRequest && (
            <RequestThread requestId={selectedRequest} clientId={clientId} />
          )}
        </div>
      )}
    </div>
  );
}
