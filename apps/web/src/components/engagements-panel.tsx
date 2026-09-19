import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PenTool } from "lucide-react";
import { NativeEsignModal } from "./native-esign-modal";

type Engagement = {
  id: string;
  service_type: string;
  title: string;
  status: string;
  due_date: string | null;
  start_date: string | null;
  recurrence: string | null;
  tax_year: number | null;
  total_work_items: number;
  completed_work_items: number;
  open_professional_work_items: number;
  waiting_on_client_work_items: number;
};

const SERVICE_TYPES = [
  "bookkeeping", "monthly_close", "quarterly_work", "tax_1040", "tax_1065",
  "tax_1120", "tax_1120s", "payroll_compliance", "advisory", "custom",
];

const STATUSES = ["planned", "active", "waiting_on_client", "professional_review", "ready", "complete", "archived"];

function label(value: string): string {
  return value.replace(/_/g, " ");
}

export function EngagementsPanel({ clientId, focusEngagementId }: { clientId: string; focusEngagementId?: string | null }) {
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [serviceType, setServiceType] = useState(SERVICE_TYPES[0]);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [taxYear, setTaxYear] = useState("");
  const [letterBusy, setLetterBusy] = useState<string | null>(null);
  const [letterStatus, setLetterStatus] = useState<Record<string, string>>({});
  const [signingRequest, setSigningRequest] = useState<{ requestId: string; title: string } | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!focusEngagementId) return;
    const el = rowRefs.current[focusEngagementId];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [engagements, focusEngagementId]);

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
        body: JSON.stringify({
          serviceType,
          title: title.trim(),
          dueDate: dueDate || null,
          taxYear: taxYear ? Number(taxYear) : null,
        }),
      });
      setTitle("");
      setDueDate("");
      setTaxYear("");
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

  async function updateDueDate(engagementId: string, value: string) {
    try {
      await api(`/api/clients/${clientId}/engagements/${engagementId}`, {
        method: "PATCH",
        body: JSON.stringify({ dueDate: value || null }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update due date");
    }
  }

  async function sendEngagementLetter(engagementId: string) {
    setLetterBusy(engagementId);
    setLetterStatus((prev) => ({ ...prev, [engagementId]: "" }));
    try {
      const { request } = await api<{ documentId: string; request: { id: string } }>(
        `/api/clients/${clientId}/engagements/${engagementId}/letter`,
        { method: "POST", body: JSON.stringify({}) },
      );
      const sendResult = await api<{ status: string; sentVia: "docusign" | "local_stub" }>(
        `/api/clients/${clientId}/signature-requests/${request.id}/send`,
        { method: "POST" },
      );
      setLetterStatus((prev) => ({
        ...prev,
        [engagementId]: sendResult.sentVia === "docusign"
          ? "Sent for signature via DocuSign."
          : "Marked sent (DocuSign is not configured for this firm yet — no envelope was actually created).",
      }));
    } catch (e) {
      setLetterStatus((prev) => ({ ...prev, [engagementId]: e instanceof Error ? e.message : "Could not send the engagement letter." }));
    } finally {
      setLetterBusy(null);
    }
  }

  async function startNativeSigning(engagementId: string, engTitle: string) {
    setLetterBusy(engagementId);
    setLetterStatus((prev) => ({ ...prev, [engagementId]: "" }));
    try {
      const { request } = await api<{ documentId: string; request: { id: string } }>(
        `/api/clients/${clientId}/engagements/${engagementId}/letter`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setSigningRequest({ requestId: request.id, title: `Engagement Letter — ${engTitle}` });
    } catch (e) {
      setLetterStatus((prev) => ({
        ...prev,
        [engagementId]: e instanceof Error ? e.message : "Could not generate engagement letter.",
      }));
    } finally {
      setLetterBusy(null);
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
          <div className="flex flex-1 min-w-[180px] flex-col gap-1">
            <label className="text-xs text-[var(--color-muted-foreground)]">Title</label>
            <input
              className="h-9 rounded-md border border-[var(--color-border)] bg-transparent px-2 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. 2025 monthly bookkeeping"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--color-muted-foreground)]">Due date</label>
            <input
              type="date"
              className="h-9 rounded-md border border-[var(--color-border)] bg-transparent px-2 text-sm"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--color-muted-foreground)]">Tax year</label>
            <input
              type="number"
              className="h-9 w-24 rounded-md border border-[var(--color-border)] bg-transparent px-2 text-sm"
              value={taxYear}
              onChange={(e) => setTaxYear(e.target.value)}
              placeholder="2025"
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
          {engagements.map((eng) => {
            const progress = eng.total_work_items > 0 ? Math.round((eng.completed_work_items / eng.total_work_items) * 100) : 0;
            return (
              <div
                key={eng.id}
                ref={(el) => { rowRefs.current[eng.id] = el; }}
                className={`flex flex-col gap-2 p-3 text-sm ${eng.id === focusEngagementId ? "bg-[var(--color-primary)]/10 ring-1 ring-[var(--color-primary)]" : ""}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{eng.title}</p>
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      {label(eng.service_type)}{eng.tax_year ? ` \u00b7 tax year ${eng.tax_year}` : ""}
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
                <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-muted-foreground)]">
                  <label className="flex items-center gap-1.5">
                    Due
                    <input
                      type="date"
                      className="h-7 rounded-md border border-[var(--color-border)] bg-transparent px-1.5 text-xs"
                      defaultValue={eng.due_date ?? ""}
                      onBlur={(e) => updateDueDate(eng.id, e.target.value)}
                    />
                  </label>
                  <span>{eng.total_work_items} work items, {eng.completed_work_items} complete ({progress}%)</span>
                  <span>{eng.open_professional_work_items} open for you</span>
                  <span>{eng.waiting_on_client_work_items} waiting on client</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-muted)]">
                  <div className="h-full bg-[var(--color-primary)]" style={{ width: `${progress}%` }} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    disabled={letterBusy === eng.id}
                    onClick={() => startNativeSigning(eng.id, eng.title)}
                    className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                  >
                    <PenTool className="h-3.5 w-3.5" />
                    {letterBusy === eng.id ? "Preparing…" : "⚡ Sign with Folio E-Sign"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={letterBusy === eng.id}
                    onClick={() => sendEngagementLetter(eng.id)}
                    className="text-xs"
                  >
                    Send via Email/Portal
                  </Button>
                  {letterStatus[eng.id] ? (
                    <span className="text-xs text-[var(--color-muted-foreground)]">{letterStatus[eng.id]}</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {signingRequest && (
        <NativeEsignModal
          clientId={clientId}
          requestId={signingRequest.requestId}
          documentTitle={signingRequest.title}
          onClose={() => setSigningRequest(null)}
          onSuccess={(res) => {
            setLetterStatus((prev) => ({
              ...prev,
              [signingRequest.requestId]: `Cryptographically sealed (${res.certificateId})`,
            }));
            load();
          }}
        />
      )}
    </div>
  );
}
