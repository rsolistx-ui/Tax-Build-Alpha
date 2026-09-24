import { useEffect, useRef, useState } from "react";
import { Upload, ShieldCheck } from "lucide-react";
import { api, apiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { canSeeSignedRecords, useFirmRole } from "@/lib/firm-role";

type ClientDocument = {
  id: string;
  filename: string;
  content_type: string | null;
  document_type: string;
  tax_year: number | null;
  status: string;
  duplicate_of_document_id: string | null;
  uploaded_at: string;
};

function label(value: string): string {
  return value.replace(/_/g, " ");
}

export function DocumentsPanel({ clientId }: { clientId: string }) {
  const showVaultLink = canSeeSignedRecords(useFirmRole());
  const [documents, setDocuments] = useState<ClientDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const data = await api<{ documents: ClientDocument[] }>(`/api/clients/${clientId}/documents`);
      setDocuments(data.documents);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load documents");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        await api(`/api/clients/${clientId}/documents`, { method: "POST", body: form });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <h3 className="text-sm font-semibold">Documents</h3>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Bank statements, tax documents, prior-year returns, payroll, loan, and formation documents beyond receipts.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {showVaultLink ? (
              <a
                href="?tab=esign"
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-500/10"
              >
                <ShieldCheck className="h-3.5 w-3.5" /> E-Sign & Audit Vault
              </a>
            ) : null}
            <label>
              <input
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleUpload(e.target.files)}
                accept=".pdf,.png,.jpg,.jpeg,.heic,.docx,.xlsx,.csv"
              />
              <Button size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> {uploading ? "Uploading..." : "Upload document"}
              </Button>
            </label>
          </div>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

      {documents.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">No documents uploaded yet.</p>
      ) : (
        <div className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
          {documents.map((doc) => (
            <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <a
                href={apiUrl(`/api/clients/${clientId}/documents/${doc.id}/source`)}
                target="_blank"
                rel="noreferrer"
                className="font-medium hover:underline"
              >
                {doc.filename}
              </a>
              <div className="flex items-center gap-2">
                {doc.duplicate_of_document_id ? <Badge>Possible duplicate</Badge> : null}
                <Badge>{label(doc.document_type)}</Badge>
                <Badge>{label(doc.status)}</Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
