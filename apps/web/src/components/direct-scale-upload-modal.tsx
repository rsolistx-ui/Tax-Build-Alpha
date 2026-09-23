import { useEffect, useRef, useState } from "react";
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
import { useDialogFocus } from "@/hooks/use-dialog-focus";

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
  const [largeFile, setLargeFile] = useState<File | null>(null);
  const [largeUploadProgress, setLargeUploadProgress] = useState(0);
  const [largeUploadBusy, setLargeUploadBusy] = useState(false);
  const [largeUploadMessage, setLargeUploadMessage] = useState<string | null>(null);

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
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocus(isOpen, () => {
    if (!largeUploadBusy && !simulatingSms) onClose();
  });
  const resumeKey = `truepost:direct-upload:${clientId}`;

  useEffect(() => {
    if (!isOpen) return;
    closeButtonRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

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

  async function sha256(value: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", value);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function uploadLargeDocument() {
    if (!largeFile) return;
    setLargeUploadBusy(true);
    setLargeUploadProgress(0);
    setLargeUploadMessage(null);
    let sessionId: string | null = null;
    try {
      const finalHash = await sha256(await largeFile.arrayBuffer());
      const saved = (() => {
        try {
          return JSON.parse(window.localStorage.getItem(resumeKey) || "null") as { sessionId: string; filename: string; sizeBytes: number; sha256: string } | null;
        } catch {
          return null;
        }
      })();
      let partSizeBytes: number;
      let completedParts = new Set<number>();
      if (saved && saved.filename === largeFile.name && saved.sizeBytes === largeFile.size && saved.sha256 === finalHash) {
        try {
          const status = await api<{ sessionId: string; partSizeBytes: number; completedParts: number[]; status: string }>(`/api/clients/${clientId}/documents/direct-upload/${saved.sessionId}`);
          if (status.status !== "completed") {
            sessionId = status.sessionId;
            partSizeBytes = status.partSizeBytes;
            completedParts = new Set(status.completedParts);
          } else {
            window.localStorage.removeItem(resumeKey);
          }
        } catch {
          window.localStorage.removeItem(resumeKey);
        }
      }
      if (!sessionId) {
        const started = await api<{ sessionId: string; partSizeBytes: number }>(`/api/clients/${clientId}/documents/direct-upload-init`, {
          method: "POST",
          body: JSON.stringify({ filename: largeFile.name, contentType: largeFile.type, sizeBytes: largeFile.size, sha256: finalHash }),
        });
        sessionId = started.sessionId;
        partSizeBytes = started.partSizeBytes;
        window.localStorage.setItem(resumeKey, JSON.stringify({ sessionId, filename: largeFile.name, sizeBytes: largeFile.size, sha256: finalHash }));
      }
      const partCount = Math.ceil(largeFile.size / partSizeBytes!);
      setLargeUploadProgress(Math.round((completedParts.size / partCount) * 100));
      for (let index = 0; index < partCount; index += 1) {
        if (completedParts.has(index + 1)) continue;
        const part = largeFile.slice(index * partSizeBytes!, Math.min((index + 1) * partSizeBytes!, largeFile.size));
        const partBytes = await part.arrayBuffer();
        await api(`/api/clients/${clientId}/documents/direct-upload-stream/${sessionId}/${index + 1}`, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream", "x-truepost-part-sha256": await sha256(partBytes) },
          body: partBytes,
        });
        setLargeUploadProgress(Math.round(((index + 1) / partCount) * 100));
      }
      await api(`/api/clients/${clientId}/documents/direct-upload-complete/${sessionId}`, { method: "POST" });
      window.localStorage.removeItem(resumeKey);
      setLargeUploadMessage("Document secured and placed in Documents for professional review.");
      setLargeFile(null);
      onUploadSuccess?.();
    } catch (error) {
      setLargeUploadMessage(`${error instanceof Error ? error.message : "Large-document upload did not complete."} Keep this browser and select the same file to resume within 24 hours.`);
    } finally {
      setLargeUploadBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onMouseDown={() => {
        if (!largeUploadBusy && !simulatingSms) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-intake-title"
        aria-describedby="evidence-intake-description"
        className="w-full max-w-xl rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4 bg-[var(--color-muted)]/30">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-400">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <h3 id="evidence-intake-title" className="text-base font-bold text-[var(--color-foreground)]">
                Evidence intake tools
              </h3>
              <p id="evidence-intake-description" className="text-xs text-[var(--color-muted-foreground)]">
                Enterprise document intake for {clientName}
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            data-dialog-autofocus
            type="button"
            onClick={onClose}
            disabled={largeUploadBusy || simulatingSms}
            aria-label="Close evidence intake tools"
            className="rounded-md p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab Selector */}
        <div role="tablist" aria-label="Evidence intake method" className="flex border-b border-[var(--color-border)] px-5 pt-3 gap-4 text-xs font-semibold">
          <button
            type="button"
            role="tab"
            id="evidence-upload-tab"
            aria-controls="evidence-upload-panel"
            aria-selected={activeTab === "scale_upload"}
            onClick={() => setActiveTab("scale_upload")}
            className={`pb-2.5 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "scale_upload"
                ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            }`}
          >
            <Upload className="h-3.5 w-3.5" /> Large-document intake
          </button>
          <button
            type="button"
            role="tab"
            id="evidence-sms-tab"
            aria-controls="evidence-sms-panel"
            aria-selected={activeTab === "sms_drop"}
            onClick={() => setActiveTab("sms_drop")}
            className={`pb-2.5 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "sms_drop"
                ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            }`}
          >
            <Smartphone className="h-3.5 w-3.5" /> SMS intake test
          </button>
        </div>

        {/* Body Content */}
        <div className="p-5 space-y-4">
          {activeTab === "scale_upload" ? (
            <div id="evidence-upload-panel" role="tabpanel" aria-labelledby="evidence-upload-tab" className="space-y-4">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100 space-y-1">
                <div className="font-semibold flex items-center gap-1.5"><Cloud className="h-3.5 w-3.5 text-[#0c4eb3]" /> Resumable evidence intake</div>
                <p className="text-[11px] text-[var(--color-muted-foreground)] leading-relaxed">Upload a supported document up to 100 MB. Each 5 MB part is checksum-verified before R2 accepts it. If a connection drops, choose the same file again within 24 hours and Truepost resumes verified parts. The document appears only after the upload completes and always starts in professional review.</p>
              </div>
              <label className="block space-y-1.5 text-xs font-semibold text-[var(--color-muted-foreground)]">Document to secure
                <input type="file" disabled={largeUploadBusy} accept=".pdf,.png,.jpg,.jpeg,.heic,.docx,.xlsx,.csv,application/pdf,image/png,image/jpeg,image/heic,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(event) => { setLargeFile(event.target.files?.[0] ?? null); setLargeUploadMessage(null); setLargeUploadProgress(0); }} className="mt-1 block w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2 text-xs font-normal" />
              </label>
              {largeFile ? <p className="text-xs text-[var(--color-muted-foreground)]">{largeFile.name} · {(largeFile.size / 1024 / 1024).toFixed(1)} MB</p> : null}
              {largeUploadBusy ? <div className="space-y-1"><div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-muted)]"><div className="h-full bg-[#0c4eb3] transition-[width]" style={{ width: `${largeUploadProgress}%` }} /></div><p className="text-xs text-[var(--color-muted-foreground)]">Securing document… {largeUploadProgress}%</p></div> : null}
              {largeUploadMessage ? <p role="status" className="rounded-md bg-[var(--color-muted)] p-2 text-xs text-[var(--color-foreground)]">{largeUploadMessage}</p> : null}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
                <Button size="sm" variant="ghost" onClick={onClose}>
                  Close
                </Button>
                <Button size="sm" onClick={() => void uploadLargeDocument()} disabled={!largeFile || largeUploadBusy}>{largeUploadBusy ? "Uploading…" : "Secure document"}</Button>
              </div>
            </div>
          ) : (
            <div id="evidence-sms-panel" role="tabpanel" aria-labelledby="evidence-sms-tab" className="space-y-4">
              <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs text-indigo-900 dark:text-indigo-200 space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <Smartphone className="h-3.5 w-3.5 text-indigo-600" />
                  Internal SMS intake test
                </div>
                <p className="text-[11px] text-[var(--color-muted-foreground)] leading-relaxed">
                  This is an internal test for a carrier-authenticated SMS intake. Production SMS remains unavailable until Twilio credentials and webhook validation are configured. Incoming images are routed to professional review; they never silently clear a bank exception or client request.
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
                  className="bg-[var(--color-primary)] hover:opacity-90 text-[var(--color-primary-foreground)] text-xs"
                >
                  {simulatingSms ? (
                    <>
                      <RefreshCw className="h-3 w-3 animate-spin mr-1.5" /> Ingesting MMS...
                    </>
                  ) : (
                    "Run internal intake test"
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
