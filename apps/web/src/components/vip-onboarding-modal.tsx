import {
  Sparkles,
  Smartphone,
  FileSpreadsheet,
  X,
  ArrowRight,
  Headphones,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface VipOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  userName?: string;
  firmName?: string;
  onOpenImport: () => void;
  onOpenMobileLink: () => void;
  onOpenDictation: () => void;
}

export function VipOnboardingModal({
  isOpen,
  onClose,
  userName = "Practitioner",
  firmName,
  onOpenImport,
  onOpenMobileLink,
  onOpenDictation,
}: VipOnboardingModalProps) {
  const firstName = userName.split(" ")[0] || "there";

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md">
      <Card className="relative w-full max-w-2xl border border-emerald-500/30 bg-[var(--color-card)] shadow-2xl overflow-hidden">
        {/* Luxury top accent gradient */}
        <div className="h-1.5 w-full bg-gradient-to-r from-emerald-500 via-teal-400 to-indigo-600" />

        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <CardHeader className="pb-4 pt-6 px-6 sm:px-8">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 ring-4 ring-emerald-500/10">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                <ShieldCheck className="h-3 w-3" />
                <span>VIP Practice Concierge</span>
              </div>
              <CardTitle className="text-xl sm:text-2xl font-bold tracking-tight mt-1 text-[var(--color-foreground)]">
                Welcome to Truepost Practice OS, {firstName}
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm text-[var(--color-muted-foreground)]">
                {firmName ? `${firmName} is` : "You are"} set up for private automated compliance. Here is how your practice runs at 10x speed.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 px-6 sm:px-8 pb-8">
          {/* Three Key Value Engines */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-4 space-y-2 hover:border-emerald-500/40 transition-colors">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                <Zap className="h-4 w-4" />
              </div>
              <h4 className="text-xs font-semibold text-[var(--color-foreground)]">Instant OCR Extraction</h4>
              <p className="text-[11px] leading-relaxed text-[var(--color-muted-foreground)]">
                Drop shoebox receipts or snap phone photos. Edge AI auto-crops, verifies sales tax math, and buckets directly to Schedule C.
              </p>
            </div>

            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-4 space-y-2 hover:border-blue-500/40 transition-colors">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400">
                <FileSpreadsheet className="h-4 w-4" />
              </div>
              <h4 className="text-xs font-semibold text-[var(--color-foreground)]">⚡ 1-Click Batch Triage</h4>
              <p className="text-[11px] leading-relaxed text-[var(--color-muted-foreground)]">
                Import client bank statements or live feeds. Truepost pairs 80%+ of receipts automatically—approve them all in one click.
              </p>
            </div>

            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-4 space-y-2 hover:border-purple-500/40 transition-colors">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-400">
                <Headphones className="h-4 w-4" />
              </div>
              <h4 className="text-xs font-semibold text-[var(--color-foreground)]">Dedicated Engineering Desk</h4>
              <p className="text-[11px] leading-relaxed text-[var(--color-muted-foreground)]">
                Dictate custom rules anytime. Directives are audited by our engineering team and deployed into your firm's compliance engine.
              </p>
            </div>
          </div>

          {/* Quick-Start Launchpad */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/20 p-4 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
              ⚡ Instant Quick-Start Launchpad
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onClose();
                  onOpenImport();
                }}
                className="justify-start gap-2 bg-[var(--color-card)] hover:bg-emerald-50 text-xs h-9 border-[var(--color-border)]"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                <span>Mass Data Migration</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onClose();
                  onOpenMobileLink();
                }}
                className="justify-start gap-2 bg-[var(--color-card)] hover:bg-emerald-50 text-xs h-9 border-[var(--color-border)]"
              >
                <Smartphone className="h-3.5 w-3.5 text-indigo-600" />
                <span>Magic Phone Intake</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onClose();
                  onOpenDictation();
                }}
                className="justify-start gap-2 bg-[var(--color-card)] hover:bg-emerald-50 text-xs h-9 border-[var(--color-border)]"
              >
                <Sparkles className="h-3.5 w-3.5 text-purple-600" />
                <span>Dictate Firm Rule</span>
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-[11px] text-[var(--color-muted-foreground)]">
              Encrypted · 15 U.S.C. § 7001 Compliant · 256-Bit TLS
            </span>
            <Button
              onClick={onClose}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs px-5 shadow-sm"
            >
              <span>Enter Workspace</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
