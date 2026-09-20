import { useState } from "react";
import {
  Upload,
  Smartphone,
  CheckCircle2,
  Cloud,
  AlertCircle,
  RefreshCw,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function DirectScaleUploadModal({
  isOpen,
  onClose,
  clientId,
  clientName,
  clientPhone,
  onUploadSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  clientId: string;
  clientName: string;
  clientPhone?: string | null;
  onUploadSuccess?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"scale_upload" | "sms_drop">("scale_upload");

  // Direct R2 Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadSuccessMessage, setUploadSuccessMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // SMS Drop Simulator state
  const [senderPhone, setSenderPhone] = useState(clientPhone || "+1 (555) 234-5678");
  const [smsText, setSmsText] = useState("Home Depot job supplies $145.20");
  const [smsFile, setSmsFile] = useState<File | null>(null);
  const [simulatingSms, setSimulatingSms] = useState(false);
  const [smsResult, setSmsResult] = useState<{
    success: boolean;
    message: string;
    matchedBankTransactionId?: string | null;
  } | null>(null);

  if (!isOpen) return null;

  async function handleDirectR2Upload() {
    if (!uploadFile) return;
    setUploading(true);
    setUploadProgress(15);
    setUploadError(null);
    setUploadSuccessMessage(null);

    try {
      // Step 1: Initialize ticket and R2 key
      const init = await api<{
        documentId: string;
        targetKey: string;
        directStreamUrl: string;
      }>(`/api/clients/${clientId}/documents/direct-upload-init`, {
        method: "POST",
        body: JSON.stringify({
          filename: uploadFile.name,
          mimeType: uploadFile.type || "application/pdf",
          fileSize: uploadFile.size,
          category: "statements",
        }),
      });

      setUploadProgress(45);

      // Step 2: Stream binary directly to Cloudflare R2
      const res = await fetch(init.directStreamUrl, {
        method: "PUT",
        headers: {
          "Content-Type": uploadFile.type || "application/octet-stream",
        },
        body: uploadFile,
      });

      if (!res.ok) {
        throw new Error(`Direct R2 upload stream failed with status ${res.status}`);
      }

      setUploadProgress(100);
      setUploadSuccessMessage(`Successfully uploaded ${uploadFile.name} directly to Cloudflare R2 (${(uploadFile.size / (1024 * 1024)).toFixed(1)} MB).`);
      setUploadFile(null);
      onUploadSuccess?.();
    } catch (e: any) {
      setUploadError(e?.message || "Direct R2 stream upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSimulateSmsDrop() {
    setSimulatingSms(true);
    setSmsResult(null);
    try {
      const formData = new FormData();
      formData.append("senderPhone", senderPhone);
      formData.append("notes", smsText);
      if (smsFile) {
        formData.append("file", smsFile);
      }

      const res = await api<{
        success: boolean;
        message: string;
        matchedBankTransactionId?: string | null;
      }>(`/api/clients/${clientId}/sms-drop`, {
        method: "POST",
        body: formData,
      });

      setSmsResult(res);
      onUploadSuccess?.();
    } catch (e: any) {
      setSmsResult({
        success: false,
        message: e?.message || "SMS drop simulation failed.",
      });
    } finally {
      setSimulatingSms(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-xl rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4 bg-[var(--color-muted)]/30">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-400">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[var(--color-foreground)]">
                Direct R2 Scale Upload &amp; SMS Receipt Drop
              </h3>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Enterprise document intake for {clientName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-[var(--color-border)] px-5 pt-3 gap-4 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab("scale_upload")}
            className={`pb-2.5 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "scale_upload"
                ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            }`}
          >
            <Upload className="h-3.5 w-3.5" /> Direct R2 Scale Upload (Up to 100MB)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("sms_drop")}
            className={`pb-2.5 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "sms_drop"
                ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            }`}
          >
            <Smartphone className="h-3.5 w-3.5" /> SMS Direct-Drop Webhook
          </button>
        </div>

        {/* Body Content */}
        <div className="p-5 space-y-4">
          {activeTab === "scale_upload" ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-900 dark:text-emerald-200 space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Bypasses Worker Memory Limits
                </div>
                <p className="text-[11px] text-[var(--color-muted-foreground)] leading-relaxed">
                  Large bank PDF statements, full-year scanned organizers, and high-resolution batch receipts stream directly into your Cloudflare R2 bucket with zero memory buffering and zero 413 errors.
                </p>
              </div>

              {/* File Drop Area */}
              <div className="rounded-lg border-2 border-dashed border-[var(--color-border)] p-6 text-center hover:bg-[var(--color-muted)]/40 transition-colors">
                <Upload className="h-8 w-8 mx-auto text-[var(--color-muted-foreground)] mb-2" />
                {uploadFile ? (
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-[var(--color-foreground)]">{uploadFile.name}</p>
                    <p className="text-[11px] text-[var(--color-muted-foreground)]">
                      {(uploadFile.size / (1024 * 1024)).toFixed(2)} MB · {uploadFile.type || "Document"}
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs font-medium text-[var(--color-foreground)]">
                      Drag &amp; drop large files or click to browse
                    </p>
                    <p className="text-[11px] text-[var(--color-muted-foreground)] mt-1">
                      PDF, ZIP, CSV, TIFF up to 100MB
                    </p>
                  </div>
                )}
                <input
                  type="file"
                  id="direct-scale-file"
                  className="hidden"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 text-xs"
                  onClick={() => document.getElementById("direct-scale-file")?.click()}
                >
                  Select Large File
                </Button>
              </div>

              {/* Progress Bar */}
              {uploading && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-medium">
                    <span>Streaming to R2 Bucket...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[var(--color-muted)] overflow-hidden">
                    <div
                      className="h-full bg-emerald-600 transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {uploadSuccessMessage && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{uploadSuccessMessage}</span>
                </div>
              )}

              {uploadError && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-800 dark:text-rose-300 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
                <Button size="sm" variant="ghost" onClick={onClose} disabled={uploading}>
                  Close
                </Button>
                <Button
                  size="sm"
                  onClick={handleDirectR2Upload}
                  disabled={!uploadFile || uploading}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                >
                  {uploading ? (
                    <>
                      <RefreshCw className="h-3 w-3 animate-spin mr-1.5" /> Streaming...
                    </>
                  ) : (
                    "Upload Directly to R2"
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs text-indigo-900 dark:text-indigo-200 space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <Smartphone className="h-3.5 w-3.5 text-indigo-600" />
                  Client SMS Inbound Webhook
                </div>
                <p className="text-[11px] text-[var(--color-muted-foreground)] leading-relaxed">
                  Clients text photo receipts directly to your firm's SMS number. Truepost automatically matches the MMS image to open missing receipt requests, marks them satisfied, and clears the bank exception.
                </p>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="font-semibold text-[var(--color-muted-foreground)] block mb-1">
                    Client Phone Number
                  </label>
                  <input
                    type="text"
                    value={senderPhone}
                    onChange={(e) => setSenderPhone(e.target.value)}
                    placeholder="+1 (555) 234-5678"
                    className="w-full text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2"
                  />
                </div>

                <div>
                  <label className="font-semibold text-[var(--color-muted-foreground)] block mb-1">
                    SMS Message Body (Optional description or amount)
                  </label>
                  <input
                    type="text"
                    value={smsText}
                    onChange={(e) => setSmsText(e.target.value)}
                    placeholder="e.g. Lunch meeting with Acme $145.20"
                    className="w-full text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2"
                  />
                </div>

                <div>
                  <label className="font-semibold text-[var(--color-muted-foreground)] block mb-1">
                    Attached Receipt Photo (MMS Media)
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setSmsFile(e.target.files?.[0] || null)}
                    className="w-full text-xs"
                  />
                </div>
              </div>

              {smsResult && (
                <div
                  className={`rounded-lg border p-3 text-xs flex items-start gap-2 ${
                    smsResult.success
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                      : "border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-300"
                  }`}
                >
                  {smsResult.success ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="font-semibold">{smsResult.message}</p>
                    {smsResult.matchedBankTransactionId && (
                      <p className="text-[11px] opacity-80 mt-0.5">
                        Matched Exception ID: {smsResult.matchedBankTransactionId}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
                <Button size="sm" variant="ghost" onClick={onClose} disabled={simulatingSms}>
                  Close
                </Button>
                <Button
                  size="sm"
                  onClick={handleSimulateSmsDrop}
                  disabled={simulatingSms}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                >
                  {simulatingSms ? (
                    <>
                      <RefreshCw className="h-3 w-3 animate-spin mr-1.5" /> Ingesting MMS...
                    </>
                  ) : (
                    "Simulate Inbound SMS Drop"
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
