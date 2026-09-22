import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Users, UploadCloud, LayoutGrid, List, ChevronRight, ChevronLeft } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AccountingImportModal } from "@/components/accounting-import-modal";

type PipelineStatus = "prospect" | "engaged" | "active" | "inactive";

type Client = {
  id: string;
  name: string;
  legal_name: string | null;
  notes: string | null;
  email: string | null;
  pipeline_status: PipelineStatus;
  created_at: string;
};

const PIPELINE_STAGES: { status: PipelineStatus; label: string }[] = [
  { status: "prospect", label: "Prospect" },
  { status: "engaged", label: "Engaged" },
  { status: "active", label: "Active" },
  { status: "inactive", label: "Inactive" },
];

export function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(searchParams.get("new") === "1");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [waveModalOpen, setWaveModalOpen] = useState(false);
  const [view, setView] = useState<"list" | "pipeline">("list");
  const [movingId, setMovingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ clients: Client[] }>("/api/clients");
      setClients(data.clients);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createClient(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/api/clients", { method: "POST", body: JSON.stringify({ name, email: email || undefined }) });
      setName("");
      setEmail("");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  async function moveStage(clientId: string, nextStatus: PipelineStatus) {
    setMovingId(clientId);
    try {
      await api(`/api/clients/${clientId}/pipeline-status`, {
        method: "PATCH",
        body: JSON.stringify({ pipelineStatus: nextStatus }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move client");
    } finally {
      setMovingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            Each client gets folders, receipts, review inbox, and P&amp;L.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-[var(--radius-lg)] border border-[var(--color-border)] p-0.5">
            <button
              type="button"
              onClick={() => setView("list")}
              className={`flex items-center gap-1.5 rounded-[calc(var(--radius-lg)-2px)] px-2.5 py-1.5 text-xs font-medium transition ${view === "list" ? "bg-[var(--color-muted)] text-[var(--color-foreground)]" : "text-[var(--color-muted-foreground)]"}`}
            >
              <List className="h-3.5 w-3.5" /> List
            </button>
            <button
              type="button"
              onClick={() => setView("pipeline")}
              className={`flex items-center gap-1.5 rounded-[calc(var(--radius-lg)-2px)] px-2.5 py-1.5 text-xs font-medium transition ${view === "pipeline" ? "bg-[var(--color-muted)] text-[var(--color-foreground)]" : "text-[var(--color-muted-foreground)]"}`}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Pipeline
            </button>
          </div>
          <Button variant="outline" onClick={() => setWaveModalOpen(true)}>
            <UploadCloud className="h-4 w-4" />
            Import Books CSV
          </Button>
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus className="h-4 w-4" />
            New client
          </Button>
        </div>
      </div>

      {showForm ? (
        <Card>
          <CardContent className="pt-6">
            <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={createClient}>
              <div className="flex-1 space-y-2">
                <Label htmlFor="client-name">Client name</Label>
                <Input
                  id="client-name"
                  placeholder="Northwind LLC"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="flex-1 space-y-2">
                <Label htmlFor="client-email">Email</Label>
                <Input
                  id="client-email"
                  type="email"
                  placeholder="client@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Create"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-[var(--radius-lg)] bg-[var(--color-muted)]" />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No clients yet"
          description="Add your first client workspace. Default folders (hotel, travel, food, supplies) are seeded automatically."
          action={
            <Button onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4" />
              Add client
            </Button>
          }
        />
      ) : view === "pipeline" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PIPELINE_STAGES.map((stage) => {
            const stageClients = clients.filter((c) => c.pipeline_status === stage.status);
            return (
              <div key={stage.status} className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">{stage.label}</span>
                  <span className="text-xs text-[var(--color-muted-foreground)]">{stageClients.length}</span>
                </div>
                <div className="space-y-2 min-h-[3rem]">
                  {stageClients.map((c) => {
                    const currentIndex = PIPELINE_STAGES.findIndex((s) => s.status === c.pipeline_status);
                    const prevStage = PIPELINE_STAGES[currentIndex - 1];
                    const nextStage = PIPELINE_STAGES[currentIndex + 1];
                    return (
                      <Card key={c.id} className="border-[var(--color-border)]">
                        <CardContent className="p-3 space-y-2">
                          <Link to={`/clients/${c.id}`} className="block text-sm font-medium hover:underline">
                            {c.name}
                          </Link>
                          <div className="flex items-center justify-between">
                            <button
                              type="button"
                              disabled={!prevStage || movingId === c.id}
                              onClick={() => prevStage && moveStage(c.id, prevStage.status)}
                              className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] disabled:opacity-30"
                              aria-label={prevStage ? `Move to ${prevStage.label}` : undefined}
                            >
                              <ChevronLeft className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={!nextStage || movingId === c.id}
                              onClick={() => nextStage && moveStage(c.id, nextStage.status)}
                              className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] disabled:opacity-30"
                              aria-label={nextStage ? `Move to ${nextStage.label}` : undefined}
                            >
                              <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {clients.map((c) => (
            <Link
              key={c.id}
              to={`/clients/${c.id}`}
              className="group rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-sm transition hover:border-stone-300 hover:shadow"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-medium group-hover:underline">{c.name}</h2>
                  {c.legal_name ? (
                    <p className="mt-0.5 text-sm text-[var(--color-muted-foreground)]">{c.legal_name}</p>
                  ) : (
                    <p className="mt-0.5 text-sm text-[var(--color-muted-foreground)]">Open workspace →</p>
                  )}
                </div>
                <span className="rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  {PIPELINE_STAGES.find((s) => s.status === c.pipeline_status)?.label ?? c.pipeline_status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
      <AccountingImportModal
        isOpen={waveModalOpen}
        onClose={() => setWaveModalOpen(false)}
        onSuccess={() => void load()}
      />
    </div>
  );
}
