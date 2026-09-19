import { useEffect, useRef, useState } from "react";
import { convertHeicToJpeg, createCaptureInput, type CaptureSource } from "@/lib/image-utils";
import { formatDate, formatLegibleMessage } from "@/lib/formatters";

const API_BASE = import.meta.env.VITE_API_URL || "";
const SESSION_KEY = "folio_portal_token";

type PortalClient = { id: string; name: string };
type PortalEngagement = {
  id: string; service_type: string; title: string; status: string; due_date: string | null; tax_year: number | null;
  total_work_items: number; completed_work_items: number;
};
type PortalRequest = { id: string; title: string; description: string | null; status: string; request_type: string; due_at: string | null };
type PortalMessage = { id: string; author_type: string; body: string; created_at: string };
type PortalDocument = { id: string; filename: string; document_type: string; status: string; uploaded_at: string };
type HomeSummary = {
  client: PortalClient;
  activeEngagements: PortalEngagement[];
  outstandingRequestCount: number;
  overdueRequests: PortalRequest[];
  dueRequests: PortalRequest[];
  recentlyCompletedRequests: PortalRequest[];
};

function label(value: string): string {
  return value.replace(/_/g, " ");
}

/**
 * Reads a one-time portal token from the URL fragment (never the query
 * string, so it is never sent to the server in the initial request or
 * logged server-side), keeps it only in sessionStorage for this browser
 * session (never localStorage), and strips it from the visible URL
 * immediately via history.replaceState. Never logged, never sent to
 * analytics, never included in an error string.
 */
function resolvePortalToken(): string | null {
  const hash = window.location.hash;
  if (hash.startsWith("#token=")) {
    const token = decodeURIComponent(hash.slice("#token=".length));
    try {
      sessionStorage.setItem(SESSION_KEY, token);
    } catch {
      // sessionStorage can throw in a private/locked-down browser context;
      // the token still works for this page load via the in-memory value
      // returned below, it just won't survive a reload.
    }
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return token;
  }
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

/**
 * Auth failures (401/403) keep the generic "link may have expired" message
 * on purpose - no detail to leak there. Every other failure (upload too
 * large, unsupported file type, request already closed, etc.) surfaces the
 * server's actual error text, since the previous blanket message made every
 * upload failure look identical and gave the client no way to know what to
 * fix.
 */
async function portalApi<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("Something went wrong. Your link may have expired or been revoked.");
    }
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || "Something went wrong. Please try again.");
  }
  return res.json() as Promise<T>;
}

type View = "home" | "requests" | "documents" | { request: string };

export function PortalPage() {
  const tokenRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");
  const [home, setHome] = useState<HomeSummary | null>(null);
  const [requests, setRequests] = useState<PortalRequest[]>([]);
  const [documents, setDocuments] = useState<PortalDocument[]>([]);
  const [selected, setSelected] = useState<PortalRequest | null>(null);
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [reply, setReply] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function openCaptureInput(source: CaptureSource) {
    const input = createCaptureInput(source, "image/*,application/pdf");
    input.multiple = true;
    input.onchange = async (e: Event) => {
      const target = e.target as HTMLInputElement;
      const files = target.files;
      if (files?.length) {
        const convertedFiles: File[] = [];
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const converted = await convertHeicToJpeg(file);
          convertedFiles.push(converted);
        }
        const dataTransfer = new DataTransfer();
        convertedFiles.forEach((f) => dataTransfer.items.add(f));
        uploadEvidence(dataTransfer.files);
      }
    };
    input.click();
  }

  useEffect(() => {
    const token = resolvePortalToken();
    if (!token) {
      setError("This link is missing its access token.");
      setReady(true);
      return;
    }
    tokenRef.current = token;
    void loadHome(token);
  }, []);

  async function loadHome(token: string) {
    try {
      const data = await portalApi<HomeSummary>(token, "/api/portal/home");
      setHome(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your portal");
    } finally {
      setReady(true);
    }
  }

  async function loadRequests() {
    if (!tokenRef.current) return;
    try {
      const data = await portalApi<{ requests: PortalRequest[] }>(tokenRef.current, "/api/portal/requests");
      setRequests(data.requests);
      setView("requests");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load requests");
    }
  }

  async function loadDocuments() {
    if (!tokenRef.current) return;
    try {
      const data = await portalApi<{ documents: PortalDocument[] }>(tokenRef.current, "/api/portal/documents");
      setDocuments(data.documents);
      setView("documents");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load documents");
    }
  }

  async function openRequest(request: PortalRequest) {
    if (!tokenRef.current) return;
    setSelected(request);
    setView({ request: request.id });
    try {
      const data = await portalApi<{ request: PortalRequest; messages: PortalMessage[] }>(tokenRef.current, `/api/portal/requests/${request.id}`);
      setMessages(data.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open this request");
    }
  }

  async function sendReply() {
    if (!selected || !reply.trim() || !tokenRef.current) return;
    try {
      await portalApi(tokenRef.current, `/api/portal/requests/${selected.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: reply.trim() }),
      });
      setReply("");
      await openRequest(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send your reply");
    }
  }

  /**
   * Portal auth is a bearer token, never put in a URL, so the document
   * source is fetched with the Authorization header (like every other
   * portal call) rather than linked to directly. The response bytes
   * become a short-lived, same-origin blob: URL used only to open the
   * file, then revoked shortly after - the object URL never contains or
   * exposes the portal token itself.
   */
  async function openDocument(documentId: string) {
    if (!tokenRef.current) return;
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/portal/documents/${documentId}/source`, {
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
      if (!res.ok) throw new Error("Could not open this document.");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open this document.");
    }
  }

  async function uploadEvidence(files: FileList | null) {
    if (!selected || !files?.length || !tokenRef.current) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const converted = await convertHeicToJpeg(file);
        const form = new FormData();
        form.append("file", converted);
        try {
          await portalApi(tokenRef.current, `/api/portal/requests/${selected.id}/evidence`, { method: "POST", body: form });
        } catch (e) {
          const reason = e instanceof Error ? e.message : "Could not upload your file";
          throw new Error(`${file.name}: ${reason}`);
        }
      }
      await openRequest(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload your file");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  if (!ready) {
    return <div className="mx-auto max-w-md p-6 text-center text-sm text-[var(--color-muted-foreground)]">Loading...</div>;
  }
  if (error && !home) {
    return <div className="mx-auto max-w-md p-6 text-center text-sm text-[var(--color-destructive)]">{error}</div>;
  }

  const isRequestView = typeof view === "object";

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <div>
        <p className="text-xs text-[var(--color-muted-foreground)]">Truepost client portal</p>
        <h1 className="text-lg font-semibold">{home?.client.name ?? "Loading..."}</h1>
      </div>

      {!isRequestView ? (
        <div className="flex gap-2 border-b border-[var(--color-border)] pb-2 text-sm">
          <button className={view === "home" ? "font-semibold" : "text-[var(--color-muted-foreground)]"} onClick={() => setView("home")}>Home</button>
          <button className={view === "requests" ? "font-semibold" : "text-[var(--color-muted-foreground)]"} onClick={() => void loadRequests()}>Requests</button>
          <button className={view === "documents" ? "font-semibold" : "text-[var(--color-muted-foreground)]"} onClick={() => void loadDocuments()}>Documents</button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

      {isRequestView && selected ? (
        <div className="space-y-3">
          <button className="text-sm text-[var(--color-muted-foreground)]" onClick={() => setView("home")}>&larr; Back</button>
          <div className="rounded-md border border-[var(--color-border)] p-3">
            <p className="font-medium">{selected.title}</p>
            {selected.description ? <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{selected.description}</p> : null}
            {selected.due_at ? <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">Due {formatDate(selected.due_at)}</p> : null}
          </div>
          {selected.status !== "satisfied" && selected.status !== "cancelled" ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <button
                  className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium bg-transparent"
                  onClick={() => void openCaptureInput("file")}
                >
                  Choose files
                </button>
                <button
                  className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium bg-transparent"
                  onClick={() => void openCaptureInput("camera")}
                >
                  Take photo
                </button>
                <button
                  className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium bg-transparent"
                  onClick={() => void openCaptureInput("library")}
                >
                  Photo library
                </button>
              </div>
              <label>
                <input ref={fileInput} type="file" className="hidden" onChange={(e: React.ChangeEvent<HTMLInputElement>) => void uploadEvidence(e.target.files)} />
                <button
                  className="w-full rounded-md border border-[var(--color-border)] py-2 text-sm font-medium"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? "Uploading..." : "Upload evidence"}
                </button>
              </label>
            </div>
          ) : null}
          <div className="space-y-2">
            {messages.map((m) => (
              <div key={m.id} className={`rounded-md p-2 text-sm ${m.author_type === "client" ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-muted)]"}`}>
                {formatLegibleMessage(m.body)}
              </div>
            ))}
          </div>
          {selected.status !== "satisfied" && selected.status !== "cancelled" ? (
            <div className="flex gap-2">
              <input
                className="h-10 flex-1 rounded-md border border-[var(--color-border)] px-3 text-sm"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Type a reply"
              />
              <button className="rounded-md bg-[var(--color-primary)] px-4 text-sm text-white" onClick={sendReply}>Send</button>
            </div>
          ) : null}
        </div>
      ) : view === "home" && home ? (
        <div className="space-y-4">
          <div className="rounded-md border border-[var(--color-border)] p-3 text-sm">
            <p className="font-medium">What we need from you</p>
            <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
              {home.outstandingRequestCount === 0 ? "Nothing outstanding right now." : `${home.outstandingRequestCount} outstanding request${home.outstandingRequestCount === 1 ? "" : "s"}.`}
            </p>
          </div>
          {home.overdueRequests.length > 0 ? (
            <div>
              <p className="mb-1 text-xs font-semibold text-[var(--color-destructive)]">Overdue</p>
              {home.overdueRequests.map((r) => (
                <button key={r.id} onClick={() => openRequest(r)} className="mb-1 block w-full rounded-md border border-[var(--color-destructive)] p-2 text-left text-sm">
                  {r.title}
                </button>
              ))}
            </div>
          ) : null}
          {home.dueRequests.length > 0 ? (
            <div>
              <p className="mb-1 text-xs font-semibold text-[var(--color-muted-foreground)]">Due</p>
              {home.dueRequests.map((r) => (
                <button key={r.id} onClick={() => openRequest(r)} className="mb-1 block w-full rounded-md border border-[var(--color-border)] p-2 text-left text-sm">
                  {r.title}
                </button>
              ))}
            </div>
          ) : null}
          <div>
            <p className="mb-1 text-xs font-semibold text-[var(--color-muted-foreground)]">Active engagements</p>
            {home.activeEngagements.length === 0 ? (
              <p className="text-xs text-[var(--color-muted-foreground)]">None right now.</p>
            ) : (
              home.activeEngagements.map((e) => (
                <div key={e.id} className="mb-1 rounded-md border border-[var(--color-border)] p-2 text-sm">
                  <p className="font-medium">{label(e.service_type)}{e.tax_year ? ` · ${e.tax_year}` : ""}</p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {label(e.status)}{e.due_date ? ` · due ${formatDate(e.due_date)}` : ""} · {e.completed_work_items}/{e.total_work_items} complete
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      ) : view === "requests" ? (
        <div className="space-y-2">
          {requests.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">Nothing needs your attention right now.</p>
          ) : (
            requests.map((r) => (
              <button key={r.id} onClick={() => openRequest(r)} className="w-full rounded-md border border-[var(--color-border)] p-3 text-left text-sm">
                <p className="font-medium">{r.title}</p>
                <p className="text-xs text-[var(--color-muted-foreground)]">{label(r.status)}{r.due_at ? ` · due ${formatDate(r.due_at)}` : ""}</p>
              </button>
            ))
          )}
        </div>
      ) : view === "documents" ? (
        <div className="space-y-2">
          {documents.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">No documents yet.</p>
          ) : (
            documents.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] p-3 text-sm">
                <div>
                  <p className="font-medium">{d.filename}</p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">{label(d.document_type)} · {formatDate(d.uploaded_at)}</p>
                </div>
                <button
                  className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium"
                  onClick={() => void openDocument(d.id)}
                >
                  Open
                </button>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
