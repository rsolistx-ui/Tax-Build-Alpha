import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Inbox, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { ReceiptReview, type ReviewReceipt, type ReviewCategory } from "@/components/receipt-review";

export function ClientReceiptsPage() {
  const { clientId = "" } = useParams();
  const [categories, setCategories] = useState<ReviewCategory[]>([]);
  const [review, setReview] = useState<ReviewReceipt[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [categoryData, reviewData] = await Promise.all([
        api<{ categories: ReviewCategory[] }>(`/api/clients/${clientId}/categories`),
        api<{ receipts: ReviewReceipt[] }>(`/api/clients/${clientId}/review`),
      ]);
      setCategories(categoryData.categories);
      setReview(reviewData.receipts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load receipts");
    }
  }

  useEffect(() => {
    void load();
  }, [clientId]);

  async function onUpload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setMessage(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        await api(`/api/clients/${clientId}/receipts`, { method: "POST", body: form });
      }
      setMessage(`Uploaded and processed ${files.length} file(s). Review the evidence below before filing.`);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Receipts</h2>
        <p className="text-sm text-[var(--color-muted-foreground)]">Upload evidence, review the AI extraction, then file it into the ledger.</p>
      </div>

      {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Upload tray</CardTitle>
          <CardDescription>
            Photos and PDFs go through Workers AI extraction, then deterministic validation before you file them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-muted)]/40 px-6 py-12 text-center hover:bg-[var(--color-muted)]/70">
            <Upload className="mb-3 h-6 w-6 text-[var(--color-muted-foreground)]" />
            <span className="text-sm font-medium">{uploading ? "Extracting and validating…" : "Click or drop receipt files"}</span>
            <span className="mt-1 text-xs text-[var(--color-muted-foreground)]">PNG, JPG, WEBP, PDF · source stays private in R2</span>
            <input type="file" className="hidden" multiple accept="image/*,application/pdf" disabled={uploading} onChange={(e) => void onUpload(e.target.files)} />
          </label>
          {message ? <p className="mt-4 text-sm text-[var(--color-muted-foreground)]">{message}</p> : null}
        </CardContent>
      </Card>

      {review.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Review inbox is clear"
          description="New extractions land here with their source document, line items, validation checks, and confidence signals."
        />
      ) : (
        <ReceiptReview clientId={clientId} categories={categories} receipts={review} onReload={load} />
      )}
    </div>
  );
}
