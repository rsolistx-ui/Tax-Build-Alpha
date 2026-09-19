import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, AlertTriangle, CheckCircle2 } from "lucide-react";
import { api, apiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { formatDate } from "@/lib/formatters";

type ReviewDocument = {
  id: string;
  clientId: string;
  clientName: string;
  filename: string;
  contentType: string | null;
  documentType: string;
  taxYear: number | null;
  status: string;
  duplicateWarning: boolean;
  duplicateOfDocumentId: string | null;
  checklistMatch: { id: string; docType: string; customLabel: string | null } | null;
  uploadedAt: string;
};

type ClientOption = { id: string; name: string };
type ChecklistOption = { id: string; doc_type: string; custom_label: string | null };

const DOCUMENT_TYPES = ["receipt", "bank_statement", "tax_document", "prior_year_return", "payroll_document", "loan_document", "formation_document", "other"];

export function DocumentReviewPage() {
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get("focus");
  const [documents, setDocuments] = useState<ReviewDocument[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [taxYearDrafts, setTaxYearDrafts] = useState<Record<string, string>>({});
  const [checklistOptions, setChecklistOptions] = useState<Record<string, ChecklistOption[]>>({});
  const [checklistDrafts, setChecklistDrafts] = useState<Record<string, string>>({});
  const focusRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [reviewData, clientsData] = await Promise.all([
        api<{ documents: ReviewDocument[] }>("/api/documents/review"),
        api<{ clients: ClientOption[] }>("/api/clients"),
      ]);
      setDocuments(reviewData.documents);
      setClients(clientsData.clients);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the document review queue");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (focusId && focusRef.current && typeof focusRef.current.scrollIntoView === "function") {
      focusRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [focusId, documents]);

  async function act(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      const result = await api<{ ok: true; terminal: boolean; document: ReviewDocument | null }>(
        `/api/documents/review/${id}`,
        { method: "PATCH", body: JSON.stringify(body) },
      );
      if (result.terminal) {
        // confirm / mark_duplicate / mark_not_needed resolve the reason
        // this document was in the queue - it leaves the list.
        setDocuments((prev) => prev.filter((d) => d.id !== id));
      } else if (result.document) {
        // Every other action is a correction on an item that stays under
        // review - keep it visible with its refreshed data instead of
        // treating a routine correction as if it were resolved.
        setDocuments((prev) => prev.map((d) => (d.id === id ? result.document! : d)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update this document");
    } finally {
      setBusyId(null);
    }
  }

  async function loadChecklistOptions(doc: ReviewDocument) {
    if (!doc.taxYear || checklistOptions[doc.id]) return;
    try {
      const data = await api<{ checklist: ChecklistOption[] }>(`/api/clients/${doc.clientId}/tax-readiness/${doc.taxYear}`);
      setChecklistOptions((prev) => ({ ...prev, [doc.id]: data.checklist }));
    } catch {
      setChecklistOptions((prev) => ({ ...prev, [doc.id]: [] }));
    }
  }

  const sortedDocuments = useMemo(() => {
    if (!focusId) return documents;
    const focused = documents.filter((d) => d.id === focusId);
    const rest = documents.filter((d) => d.id !== focusId);
    return [...focused, ...rest];
  }, [documents, focusId]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-lg font-semibold">Document review</h1>
        <Badge>{documents.length} pending</Badge>
      </div>

      {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}
      {loading ? <p className="text-sm text-[var(--color-muted-foreground)]">Loading review queue...</p> : null}

      {!loading && documents.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing to review"
          description="Every uploaded document across your clients has been confirmed, corrected, or resolved."
        />
      ) : null}

      <div className="space-y-3">
        {sortedDocuments.map((doc) => (
          <div key={doc.id} ref={doc.id === focusId ? focusRef : undefined} className={doc.id === focusId ? "rounded-[var(--radius-lg)] ring-2 ring-[var(--color-ring)]" : undefined}>
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <a
                    href={apiUrl(`/api/clients/${doc.clientId}/documents/${doc.id}/source`)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium hover:underline"
                  >
                    {doc.filename}
                  </a>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {doc.clientName} - uploaded {formatDate(doc.uploadedAt)}
                    {doc.taxYear ? ` - tax year ${doc.taxYear}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {doc.duplicateWarning ? (
                    <Badge className="gap-1 text-amber-700">
                      <AlertTriangle className="h-3 w-3" /> Possible duplicate
                    </Badge>
                  ) : null}
                  <Badge>{doc.documentType.replace(/_/g, " ")}</Badge>
                </div>
              </div>

              {doc.checklistMatch ? (
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Matches checklist item: {doc.checklistMatch.customLabel ?? doc.checklistMatch.docType.replace(/_/g, " ")}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs"
                  value={doc.documentType}
                  onChange={(e) => act(doc.id, { action: "assign_document_type", documentType: e.target.value })}
                  disabled={busyId === doc.id}
                >
                  {DOCUMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>

                <select
                  className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) act(doc.id, { action: "assign_client", targetClientId: e.target.value });
                  }}
                  disabled={busyId === doc.id}
                >
                  <option value="">Reassign client...</option>
                  {clients.filter((c) => c.id !== doc.clientId).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>

                <input
                  type="number"
                  placeholder="Tax year"
                  className="h-8 w-24 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs"
                  value={taxYearDrafts[doc.id] ?? (doc.taxYear ? String(doc.taxYear) : "")}
                  onChange={(e) => setTaxYearDrafts((prev) => ({ ...prev, [doc.id]: e.target.value }))}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busyId === doc.id || !taxYearDrafts[doc.id]}
                  onClick={() => act(doc.id, { action: "assign_tax_year", taxYear: Number(taxYearDrafts[doc.id]) })}
                >
                  Set year
                </Button>

                {doc.taxYear ? (
                  <>
                    <select
                      className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs"
                      value={checklistDrafts[doc.id] ?? ""}
                      onFocus={() => loadChecklistOptions(doc)}
                      onChange={(e) => setChecklistDrafts((prev) => ({ ...prev, [doc.id]: e.target.value }))}
                    >
                      <option value="">Match checklist item...</option>
                      {(checklistOptions[doc.id] ?? []).map((item) => (
                        <option key={item.id} value={item.id}>{item.custom_label ?? item.doc_type.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busyId === doc.id || !checklistDrafts[doc.id]}
                      onClick={() => act(doc.id, { action: "match_checklist", checklistItemId: checklistDrafts[doc.id] })}
                    >
                      Match
                    </Button>
                  </>
                ) : null}

                <Button size="sm" disabled={busyId === doc.id} onClick={() => act(doc.id, { action: "confirm" })}>
                  Confirm
                </Button>
                {doc.duplicateWarning ? (
                  <Button size="sm" variant="secondary" disabled={busyId === doc.id} onClick={() => act(doc.id, { action: "mark_duplicate", duplicateOfDocumentId: doc.duplicateOfDocumentId })}>
                    Mark duplicate
                  </Button>
                ) : null}
                <Button size="sm" variant="secondary" disabled={busyId === doc.id} onClick={() => act(doc.id, { action: "mark_not_needed" })}>
                  Not needed
                </Button>
              </div>
            </CardContent>
          </Card>
          </div>
        ))}
      </div>
    </div>
  );
}
