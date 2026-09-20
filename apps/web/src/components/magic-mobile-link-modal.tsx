import { useState, useEffect } from "react";
import {
  Smartphone,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  X,
  Loader2,
  MessageSquare,
  Send,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatDate } from "@/lib/formatters";

interface MagicMobileLinkModalProps {
  clientId: string;
  clientName?: string;
  clientPhone?: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function MagicMobileLinkModal({
  clientId,
  clientName,
  clientPhone,
  isOpen,
  onClose,
}: MagicMobileLinkModalProps) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [smsCopied, setSmsCopied] = useState(false);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState(clientPhone || "");

  useEffect(() => {
    if (isOpen && clientId) {
      setPhone(clientPhone || "");
      void generateLink();
    } else {
      setPortalUrl(null);
      setCopied(false);
      setSmsCopied(false);
      setError(null);
    }
  }, [isOpen, clientId, clientPhone]);

  async function generateLink() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{
        link: { id: string; token: string; expiresAt: string };
      }>(`/api/clients/${clientId}/portal-links`, {
        method: "POST",
        body: JSON.stringify({ ttlDays: 30 }),
      });

      const fullUrl = `${window.location.origin}/portal#token=${encodeURIComponent(data.link.token)}`;
      setPortalUrl(fullUrl);
      setExpiresAt(formatDate(data.link.expiresAt));
    } catch (err: any) {
      setError(err?.message || "Failed to generate magic mobile upload link.");
    } finally {
      setLoading(false);
    }
  }

  async function copyToClipboard() {
    if (!portalUrl) return;
    try {
      await navigator.clipboard.writeText(portalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  }

  const cleanPhone = phone.replace(/[^0-9+]/g, "");
  const smsBodyText = `Hi ${clientName || "there"}, here is your secure one-click link to upload business receipts directly from your phone camera: ${portalUrl || ""}`;

  async function copySmsDraft() {
    try {
      await navigator.clipboard.writeText(smsBodyText);
      setSmsCopied(true);
      setTimeout(() => setSmsCopied(false), 2500);
    } catch {
      // Fallback
    }
  }

  if (!isOpen) return null;

  const qrSrc = portalUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(portalUrl)}`
    : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <Card className="relative w-full max-w-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <CardHeader className="pb-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400 mb-2 shadow-sm">
            <Smartphone className="h-6 w-6" />
          </div>
          <CardTitle className="text-lg">Magic Mobile Phone Sync</CardTitle>
          <CardDescription className="text-xs">
            Zero-friction phone camera link &amp; SMS text dispatch for {clientName || "your client"}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {error ? (
            <div className="rounded-md bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="py-10 text-center space-y-2">
              <Loader2 className="h-7 w-7 animate-spin mx-auto text-indigo-600" />
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Creating secure tokenized link...
              </p>
            </div>
          ) : portalUrl ? (
            <div className="space-y-4">
              {/* QR Code and Instructions */}
              <div className="flex flex-col sm:flex-row items-center gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-3">
                <div className="rounded-xl border border-[var(--color-border)] bg-white p-2 shrink-0 shadow-xs">
                  <img
                    src={qrSrc}
                    alt="Scan with mobile camera"
                    className="h-28 w-28 object-contain"
                  />
                </div>
                <div className="space-y-1 text-left">
                  <p className="text-xs font-semibold text-[var(--color-foreground)] flex items-center gap-1.5">
                    <Smartphone className="h-3.5 w-3.5 text-indigo-600" /> Instant Camera Capture
                  </p>
                  <p className="text-[11px] text-[var(--color-muted-foreground)] leading-relaxed">
                    Point iPhone or Android camera at the QR code. Opens directly in Safari/Chrome without installing an app or logging in.
                  </p>
                  <div className="pt-1 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                      <ShieldCheck className="h-3 w-3" /> Valid 30 days ({expiresAt})
                    </span>
                    <a
                      href={portalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      Preview <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              </div>

              {/* SMS Text Message Dispatch Section */}
              <div className="space-y-2 rounded-lg border border-indigo-200/80 bg-indigo-50/50 p-3 text-left dark:border-indigo-900/60 dark:bg-indigo-950/20">
                <div className="flex items-center justify-between">
                  <label htmlFor="client-phone" className="text-xs font-semibold text-indigo-950 dark:text-indigo-200 flex items-center gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5 text-indigo-600" /> Text Link via SMS
                  </label>
                  <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium">
                    Native Device Sync
                  </span>
                </div>

                <div className="flex gap-2">
                  <input
                    id="client-phone"
                    type="tel"
                    placeholder="Enter phone: e.g. (555) 234-5678"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  {cleanPhone ? (
                    <a
                      href={`sms:${cleanPhone}?body=${encodeURIComponent(smsBodyText)}`}
                      className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 text-xs font-medium text-white shadow-xs transition-colors shrink-0"
                    >
                      <Send className="h-3 w-3" /> Send SMS
                    </a>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs shrink-0 gap-1 border-indigo-200 text-indigo-700 hover:bg-indigo-100/60 dark:border-indigo-800 dark:text-indigo-300"
                    onClick={copySmsDraft}
                  >
                    {smsCopied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                    {smsCopied ? "Copied" : "Copy Text"}
                  </Button>
                </div>
                <p className="text-[10px] text-[var(--color-muted-foreground)]">
                  Clicking <strong>Send SMS</strong> opens Windows Phone Link, Mac Messages, or your mobile SMS app with the client’s number and link pre-filled.
                </p>
              </div>

              {/* Direct Link Copy */}
              <div className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/50 p-1.5 text-left">
                <input
                  type="text"
                  readOnly
                  value={portalUrl}
                  className="flex-1 truncate bg-transparent px-2 text-xs font-mono text-[var(--color-foreground)] outline-none"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 gap-1 px-2.5 text-xs font-medium"
                  onClick={copyToClipboard}
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> Copy Link
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="pt-2 border-t border-[var(--color-border)] flex justify-end">
            <Button size="sm" variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
