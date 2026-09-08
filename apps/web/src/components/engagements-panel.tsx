import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Engagement = {
  id: string;
  service_type: string;
  title: string;
  status: string;
  due_date: string | null;
  tax_year: number | null;
};

const SERVICE_TYPES = [
  "bookkeeping", "monthly_close", "quarterly_work", "tax_1040", "tax_1065",
  "tax_1120", "tax_1120s", "payroll_compliance", "advisory", "custom",
];

const STATUSES = ["planned", "active", "waiting_on_client", "professional_review", "ready", "complete", "archived"];

function label(value: string): string {
  return value.replace(/_/g, " ");
}

export function EngagementsPanel({ clientId }: { clientId: string }) {
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [serviceType, setServiceType] = useState(SERVICE_TYPES[0]);
  const [title, setTitle] = useState("");

  async function load() {
    try {
      const data = await api<{ engagements: Engagement[] }>(`/api/clients/${clientId}/engagements`);
      setEngagements(data.engagements);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load engagements");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function createEngagement() {
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api(`/api/clients/${clientId}/engagements`, {
        method: "POST",
        body: JSON.stringify({ serviceType, title: title.trim() }),
      });
      setTitle("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create engagement");
    } finally {
      setCreating(false);
    }
  }

  async function updateStatus(engagementId: string, status: string) {
    try {
      await api(`/api/clients/${clientId}/engagements/${engagementId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update engagement status");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--color-muted-foreground)]">Service type</label>
            <select
              className="h-9 rounded-md border border-[var(--color-border)] bg-transparent px-2 text-sm"
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value)}
            >
              {SERVICE_TYPES.map((s) => (
                <option key={s} value={s}>{label(s)}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-1 min-w-[200px] flex-col gap-1">
            <label className="text-xs text-[var(--color-muted-foreground)]">Title</label>
            <input
              className="h-9 rounded-md border border-[var(--color-border)] bg-transparent px-2 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. 2025 monthly bookkeeping"
            />
          </div>
          <Button size="sm" disabled={creating || !title.trim()} onClick={createEngagement}>
            New engagement
          </Button>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

      {engagements.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">No engagements yet.</p>
      ) : (
        <div className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
          {engagements.map((eng) => (
            <div key={eng.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div>
                <p className="font-medium">{eng.title}</p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {label(eng.service_type)}{eng.due_date ? ` \u00b7 due ${eng.due_date}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge>{label(eng.status)}</Badge>
                <select
                  className="h-8 rounded-md border border-[var(--color-border)] bg-transparent px-2 text-xs"
                  value={eng.status}
                  onChange={(e) => updateStatus(eng.id, e.target.value)}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{label(s)}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
