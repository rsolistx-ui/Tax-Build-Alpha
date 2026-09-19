import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/formatters";

type WorkItem = {
  id: string;
  client_id: string;
  engagement_id: string | null;
  title: string;
  status: string;
  priority: string;
  due_at: string | null;
  source_type: string;
  source_id: string | null;
};

const VIEWS = [
  { id: "", label: "All open" },
  { id: "overdue", label: "Overdue" },
  { id: "due_today", label: "Due today" },
  { id: "due_soon", label: "Due soon" },
  { id: "waiting_on_client", label: "Waiting on client" },
  { id: "professional_review", label: "Professional review" },
  { id: "blocked", label: "Blocked" },
  { id: "recently_completed", label: "Recently completed" },
];

function label(value: string): string {
  return value.replace(/_/g, " ");
}

/**
 * A client_request-sourced item deep-links to the requests tab focused on
 * the request itself (source_id), not the work item. An engagement-scoped
 * item deep-links to the engagements tab focused on the engagement. Any
 * other item falls back to the client overview - there is no bank-tab
 * deep link target from this milestone's work items since bank exceptions
 * become client_request work items, they are not their own work-item
 * source type.
 */
function deepLink(item: WorkItem): string {
  if (item.source_type === "client_request" && item.source_id) {
    return `/clients/${item.client_id}?tab=requests&focus=${item.source_id}`;
  }
  if (item.engagement_id) {
    return `/clients/${item.client_id}?tab=engagements&focus=${item.engagement_id}`;
  }
  return `/clients/${item.client_id}`;
}

export function WorkQueuePage() {
  const [view, setView] = useState("");
  const [items, setItems] = useState<WorkItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(activeView: string) {
    try {
      const params = new URLSearchParams();
      if (activeView) params.set("view", activeView);
      const data = await api<{ items: WorkItem[]; nextCursor: string | null }>(`/api/work-queue?${params.toString()}`);
      setItems(data.items);
      setNextCursor(data.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the work queue");
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      if (view) params.set("view", view);
      params.set("cursor", nextCursor);
      const data = await api<{ items: WorkItem[]; nextCursor: string | null }>(`/api/work-queue?${params.toString()}`);
      setItems((current) => [...current, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void load(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Work queue</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Every open item across every client, in one firm-wide list. Deep-links to the exact client and record.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              view === v.id
                ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                : "border-[var(--color-border)] bg-transparent"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

      {items.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-[var(--color-muted-foreground)]">Nothing in this view.</CardContent></Card>
      ) : (
        <div className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
          {items.map((item) => (
            <Link
              key={item.id}
              to={deepLink(item)}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm hover:bg-[var(--color-muted)]"
            >
              <div>
                <p className="font-medium">{item.title}</p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {item.due_at ? `Due ${formatDate(item.due_at)}` : "No due date"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge>{label(item.priority)}</Badge>
                <Badge>{label(item.status)}</Badge>
              </div>
            </Link>
          ))}
        </div>
      )}

      {nextCursor ? (
        <div className="flex justify-center">
          <button
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm"
            onClick={() => void loadMore()}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
