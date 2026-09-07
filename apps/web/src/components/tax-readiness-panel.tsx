import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ChecklistItem = { id: string; doc_type: string; custom_label: string | null; status: string; updated_at: string };

type Readiness = {
  taxYear: number;
  status: string;
  suggestedStatus: string;
  notes: string | null;
  checklist: ChecklistItem[];
};

const STATES = [
  "not_started",
  "collecting_documents",
  "bookkeeping_incomplete",
  "professional_review",
  "ready_for_preparation",
  "preparation_started",
  "complete",
];

const CHECKLIST_STATUSES = ["expected", "requested", "received", "reviewed", "not_applicable"];

function label(value: string): string {
  return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function TaxReadinessPanel({ clientId, taxYear }: { clientId: string; taxYear: number | null }) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState("");

  async function load() {
    if (!taxYear) return;
    try {
      const data = await api<Readiness>(`/api/clients/${clientId}/tax-readiness/${taxYear}`);
      setReadiness(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tax readiness");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, taxYear]);

  async function setStatus(status: string) {
    if (!taxYear) return;
    try {
      await api(`/api/clients/${clientId}/tax-readiness/${taxYear}`, { method: "PUT", body: JSON.stringify({ status }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update readiness");
    }
  }

  async function generateChecklist() {
    if (!taxYear) return;
    try {
      await api(`/api/clients/${clientId}/tax-readiness/${taxYear}/checklist/generate`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate checklist");
    }
  }

  async function setChecklistStatus(itemId: string, status: string) {
    try {
      await api(`/api/clients/${clientId}/checklist/${itemId}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update checklist item");
    }
  }

  async function addCustomItem() {
    if (!taxYear || !customLabel.trim()) return;
    try {
      await api(`/api/clients/${clientId}/checklist`, {
        method: "POST",
        body: JSON.stringify({ taxYear, docType: "other", customLabel: customLabel.trim() }),
      });
      setCustomLabel("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add checklist item");
    }
  }

  if (!taxYear) return <p className="text-sm text-[var(--color-muted-foreground)]">Set a tax year in the client profile to use tax readiness.</p>;
  if (error) return <p className="text-sm text-[var(--color-destructive)]">{error}</p>;
  if (!readiness) return <p className="text-sm text-[var(--color-muted-foreground)]">Loading tax readiness...</p>;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">Tax year {readiness.taxYear} preparation readiness</h3>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Suggested: {label(readiness.suggestedStatus)}. Bookkeeping readiness is tracked separately.
              </p>
            </div>
            <Badge>{label(readiness.status)}</Badge>
          </div>
          <div className="flex flex-wrap gap-1">
            {STATES.map((s) => (
              <Button key={s} size="sm" variant={s === readiness.status ? "default" : "secondary"} onClick={() => setStatus(s)}>
                {label(s)}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Document checklist</h3>
            <Button size="sm" variant="secondary" onClick={generateChecklist}>Generate from client profile</Button>
          </div>
          {readiness.checklist.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">No checklist items yet.</p>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {readiness.checklist.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>{item.custom_label ?? label(item.doc_type)}</span>
                  <select
                    className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs"
                    value={item.status}
                    onChange={(e) => setChecklistStatus(item.id, e.target.value)}
                  >
                    {CHECKLIST_STATUSES.map((s) => (
                      <option key={s} value={s}>{label(s)}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <input
              className="h-9 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"
              placeholder="Add a client-specific expected document..."
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
            />
            <Button size="sm" onClick={addCustomItem}>Add</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
