import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, AlertTriangle, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";

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

const DOCUMENT_TYPES = ["receipt", "bank_statement", "tax_document", "prior_year_return", "payroll_document", "loan_document", "formation_document", "other"];

export function DocumentReviewPage() {
  const [documents, setDocuments] = useState<ReviewDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api<{ documents: ReviewDocument[] }>("/api/documents/review");
      setDocuments(data.documents);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the document review queue");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function act(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    try {
      await api(`/api/documents/review/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update this document");
    } finally {
      setBusyId(null);
    }
  }

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
        {documents.map((doc) => (
          <Card key={doc.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{doc.filename}</p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {doc.clientName} - uploaded {new Date(doc.uploadedAt).toLocaleDateString()}
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
        ))}
      </div>
    </div>
  );
}
