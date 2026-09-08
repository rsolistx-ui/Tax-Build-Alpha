import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type WorkItem = {
  id: string;
  client_id: string;
  engagement_id: string | null;
  title: string;
  status: string;
  priority: string;
  due_at: string | null;
  source_type: string;
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

export function WorkQueuePage() {
  const [view, setView] = useState("");
  const [items, setItems] = useState<WorkItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load(activeView: string) {
    try {
      const params = new URLSearchParams();
      if (activeView) params.set("view", activeView);
      const data = await api<{ items: WorkItem[] }>(`/api/work-queue?${params.toString()}`);
      setItems(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the work queue");
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
          Every open item across every client, in one firm-wide list. Deep-links to the exact client and engagement.
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
              to={`/clients/${item.client_id}?tab=${item.source_type === "client_request" ? "requests" : "engagements"}`}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm hover:bg-[var(--color-muted)]"
            >
              <div>
                <p className="font-medium">{item.title}</p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {item.due_at ? `Due ${new Date(item.due_at).toLocaleDateString()}` : "No due date"}
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
    </div>
  );
}
