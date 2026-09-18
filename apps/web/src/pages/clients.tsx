import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Users, UploadCloud } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AccountingImportModal } from "@/components/accounting-import-modal";

type Client = {
  id: string;
  name: string;
  legal_name: string | null;
  notes: string | null;
  email: string | null;
  created_at: string;
};

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
                  Active
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
