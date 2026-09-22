import { useEffect, useState } from "react";
import { Download, X, Share } from "lucide-react";
import { Button } from "@/components/ui/button";

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

export function PwaInstallBanner() {
  const [deferred, setDeferred] = useState<any>(null);
  const [dismissed, setDismissed] = useState(false);
  const [showIOSHint, setShowIOSHint] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    const handler = (e: Event) => { e.preventDefault(); setDeferred(e); };
    window.addEventListener("beforeinstallprompt", handler);
    if (isIOS() && !localStorage.getItem("pwa-ios-dismissed")) setShowIOSHint(true);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (isStandalone() || dismissed) return null;
  if (!deferred && !showIOSHint) return null;

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 text-sm">
        {showIOSHint && !deferred ? (
          <>
            <Share className="h-4 w-4 shrink-0" />
            <span className="flex-1">Install Truepost: tap Share then Add to Home Screen for camera capture on iOS.</span>
            <Button variant="ghost" size="icon" onClick={() => { localStorage.setItem("pwa-ios-dismissed", "1"); setShowIOSHint(false); }} aria-label="Dismiss"><X className="h-4 w-4" /></Button>
          </>
        ) : (
          <>
            <Download className="h-4 w-4 shrink-0" />
            <span className="flex-1">Install Truepost for one-tap receipt capture.</span>
            <Button size="sm" onClick={async () => { await deferred?.prompt(); setDeferred(null); }}>Install</Button>
            <Button variant="ghost" size="icon" onClick={() => setDismissed(true)} aria-label="Dismiss"><X className="h-4 w-4" /></Button>
          </>
        )}
      </div>
    </div>
  );
}
