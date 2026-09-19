import React, { useRef, useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Check, ShieldCheck, PenTool, Type, FileCheck2, X, AlertCircle } from "lucide-react";

interface NativeEsignModalProps {
  clientId: string;
  requestId: string;
  documentTitle?: string;
  defaultSignerName?: string;
  defaultSignerEmail?: string;
  onClose: () => void;
  onSuccess: (result: { certificateId: string; documentHash: string }) => void;
}

export function NativeEsignModal({
  clientId,
  requestId,
  documentTitle = "Tax Engagement & Disclosure Document",
  defaultSignerName = "",
  defaultSignerEmail = "",
  onClose,
  onSuccess,
}: NativeEsignModalProps) {
  const [signMode, setSignMode] = useState<"draw" | "type">("draw");
  const [signerName, setSignerName] = useState(defaultSignerName);
  const [signerEmail, setSignerEmail] = useState(defaultSignerEmail);
  const [consentAgreed, setConsentAgreed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [certResult, setCertResult] = useState<{
    certificateId: string;
    documentHash: string;
    signedR2Key: string;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  // Setup drawing canvas
  useEffect(() => {
    if (signMode !== "draw") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#0f2347"; // Classic rich legal blue
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, [signMode]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = "touches" in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = "touches" in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setHasDrawn(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = "touches" in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = "touches" in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!signerName.trim()) {
      setError("Please enter your legal name.");
      return;
    }
    if (!signerEmail.trim() || !signerEmail.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!consentAgreed) {
      setError("You must acknowledge and consent to electronic execution under 15 U.S.C. § 7001.");
      return;
    }

    let signatureData = "";
    if (signMode === "draw") {
      if (!hasDrawn || !canvasRef.current) {
        setError("Please draw your signature on the pad above or switch to typed signature.");
        return;
      }
      signatureData = canvasRef.current.toDataURL("image/png");
    } else {
      signatureData = signerName.trim();
    }

    setIsSubmitting(true);
    try {
      const res = await api<{
        ok: boolean;
        certificateId: string;
        documentHash: string;
        signedR2Key: string;
        status: string;
      }>(`/api/clients/${clientId}/signature-requests/${requestId}/sign-native`, {
        method: "POST",
        body: JSON.stringify({
          signatureType: signMode === "draw" ? "drawn" : "typed",
          signatureData,
          signerName: signerName.trim(),
          signerEmail: signerEmail.trim(),
          consentAgreed: true,
        }),
      });

      setCertResult({
        certificateId: res.certificateId,
        documentHash: res.documentHash,
        signedR2Key: res.signedR2Key,
      });
      onSuccess({
        certificateId: res.certificateId,
        documentHash: res.documentHash,
      });
    } catch (err: any) {
      setError(err?.message || "Failed to execute electronic signature");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <Card className="relative w-full max-w-xl border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">
                Folio Cryptographic E-Sign Engine
              </CardTitle>
              <CardDescription className="text-xs">
                ESIGN Act (15 U.S.C. § 7001) & UETA Compliant · 100% Native Architecture ($0 / env)
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {certResult ? (
            <div className="space-y-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-left">
              <div className="flex items-center gap-2 text-emerald-600">
                <FileCheck2 className="h-5 w-5" />
                <span className="font-semibold text-sm">Document Cryptographically Sealed</span>
              </div>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                An unalterable Certificate of Completion & Audit Trail has been appended to the PDF and permanently archived.
              </p>
              <div className="space-y-1.5 font-mono text-xs">
                <div className="flex justify-between border-b border-[var(--color-border)]/60 pb-1">
                  <span className="text-[var(--color-muted-foreground)]">Certificate ID:</span>
                  <span className="font-semibold text-[var(--color-foreground)]">{certResult.certificateId}</span>
                </div>
                <div className="flex flex-col gap-1 border-b border-[var(--color-border)]/60 pb-1">
                  <span className="text-[var(--color-muted-foreground)]">SHA-256 Digest:</span>
                  <span className="break-all text-[10px] text-emerald-700 dark:text-emerald-400">
                    {certResult.documentHash}
                  </span>
                </div>
                <div className="flex justify-between pt-1">
                  <span className="text-[var(--color-muted-foreground)]">Status:</span>
                  <Badge className="border-emerald-500 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30">
                    Tamper-Evident Record Sealed
                  </Badge>
                </div>
              </div>
              <Button onClick={onClose} className="w-full mt-2" size="sm">
                Done
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3 text-xs">
                <div className="font-medium text-[var(--color-foreground)]">Document to Sign:</div>
                <div className="text-[var(--color-muted-foreground)] truncate">{documentTitle}</div>
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs text-rose-600">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--color-foreground)]">
                    Legal Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder="e.g. Eleanor Vance"
                    className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--color-foreground)]">
                    Signer Email
                  </label>
                  <input
                    type="email"
                    required
                    value={signerEmail}
                    onChange={(e) => setSignerEmail(e.target.value)}
                    placeholder="signer@example.com"
                    className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
                  />
                </div>
              </div>

              {/* Signature Mode Selector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--color-foreground)]">Signature Style</span>
                  <div className="flex rounded-md border border-[var(--color-border)] p-0.5">
                    <button
                      type="button"
                      onClick={() => setSignMode("draw")}
                      className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                        signMode === "draw"
                          ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                          : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                      }`}
                    >
                      <PenTool className="h-3.5 w-3.5" />
                      Draw
                    </button>
                    <button
                      type="button"
                      onClick={() => setSignMode("type")}
                      className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                        signMode === "type"
                          ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                          : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                      }`}
                    >
                      <Type className="h-3.5 w-3.5" />
                      Type
                    </button>
                  </div>
                </div>

                {signMode === "draw" ? (
                  <div className="relative rounded-lg border-2 border-dashed border-[var(--color-border)] bg-white p-1">
                    <canvas
                      ref={canvasRef}
                      width={480}
                      height={120}
                      className="h-[120px] w-full cursor-crosshair touch-none"
                      onMouseDown={startDrawing}
                      onMouseMove={draw}
                      onMouseUp={stopDrawing}
                      onMouseLeave={stopDrawing}
                      onTouchStart={startDrawing}
                      onTouchMove={draw}
                      onTouchEnd={stopDrawing}
                    />
                    <div className="absolute bottom-2 right-2 flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={clearCanvas}
                        className="h-6 px-2 text-[10px] text-gray-500 hover:text-gray-900"
                      >
                        Clear
                      </Button>
                    </div>
                    {!hasDrawn && (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-gray-400">
                        Sign here with mouse, trackpad, or finger
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex h-[120px] items-center justify-center rounded-lg border-2 border-dashed border-[var(--color-border)] bg-white p-4">
                    <span
                      className="text-2xl text-[#0f2347]"
                      style={{
                        fontFamily: "'Brush Script MT', 'Dancing Script', 'Caveat', cursive",
                        fontStyle: "italic",
                      }}
                    >
                      {signerName ? `/${signerName}/` : "/Signer Name/"}
                    </span>
                  </div>
                )}
              </div>

              {/* Legal Consent Acknowledgment */}
              <label className="flex items-start gap-2.5 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-2.5 text-xs text-[var(--color-muted-foreground)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentAgreed}
                  onChange={(e) => setConsentAgreed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-ring)]"
                />
                <span>
                  I affirmatively consent to conduct business electronically pursuant to the federal{" "}
                  <strong>ESIGN Act (15 U.S.C. § 7001)</strong> and agree that this signature has the same legal
                  effect as a manual wet-ink signature.
                </span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting || !consentAgreed}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  {isSubmitting ? (
                    "Sealing Document..."
                  ) : (
                    <>
                      <Check className="mr-1.5 h-4 w-4" />
                      Sign & Cryptographically Seal
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
