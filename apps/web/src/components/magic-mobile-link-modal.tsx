import { useState, useEffect } from "react";
import {
  Smartphone,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  X,
  Loader2,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatDate } from "@/lib/formatters";

interface MagicMobileLinkModalProps {
  clientId: string;
  clientName?: string;
  isOpen: boolean;
  onClose: () => void;
}

export function MagicMobileLinkModal({
  clientId,
  clientName,
  isOpen,
  onClose,
}: MagicMobileLinkModalProps) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && clientId) {
      void generateLink();
    } else {
      setPortalUrl(null);
      setCopied(false);
      setError(null);
    }
  }, [isOpen, clientId]);

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

  if (!isOpen) return null;

  const qrSrc = portalUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(portalUrl)}`
    : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <Card className="relative w-full max-w-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl">
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
          <CardTitle className="text-lg">Magic Mobile Upload</CardTitle>
          <CardDescription className="text-xs">
            Zero-friction phone camera link for {clientName || "your client"}
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
            <div className="space-y-4 text-center">
              {/* QR Code Container */}
              <div className="mx-auto inline-flex rounded-xl border-2 border-[var(--color-border)] bg-white p-3 shadow-inner">
                <img
                  src={qrSrc}
                  alt="Scan with mobile camera"
                  className="h-44 w-44 object-contain"
                />
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-[var(--color-foreground)]">
                  Scan with iPhone or Android camera
                </p>
                <p className="text-[11px] text-[var(--color-muted-foreground)] max-w-xs mx-auto">
                  Opens instant receipt photo capture directly in their mobile browser. No passwords or app store installs required.
                </p>
              </div>

              {/* URL box with 1-click copy */}
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
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </>
                  )}
                </Button>
              </div>

              <div className="flex items-center justify-between pt-1 text-[11px] text-[var(--color-muted-foreground)]">
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                  Valid until {expiresAt}
                </span>
                <a
                  href={portalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  Test preview <ExternalLink className="h-3 w-3" />
                </a>
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
