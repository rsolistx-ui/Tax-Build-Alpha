import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, FileUp, ListChecks, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "folio-welcome-tour-v1";

const steps = [
  {
    eyebrow: "Welcome to Truepost",
    title: "Your practice, in one calm place.",
    body: "Truepost keeps client evidence, bank activity, requests, and reporting connected so you can see what needs attention without hunting across tools.",
    icon: Sparkles,
  },
  {
    eyebrow: "Start with evidence",
    title: "Upload a receipt from any device.",
    body: "Choose a client, then use Upload. Truepost reads the receipt, checks the math, and puts it in Review. Nothing is filed until you approve it.",
    icon: FileUp,
  },
  {
    eyebrow: "Work the exceptions",
    title: "Let the queue tell you what matters.",
    body: "The Operations view and Work Queue surface missing evidence, bank exceptions, document review, and client requests in priority order.",
    icon: ListChecks,
  },
  {
    eyebrow: "You stay in control",
    title: "Suggestions are ready. Decisions stay yours.",
    body: "Truepost can prepare extraction, matching, and request drafts. You approve categorization, filing, bank treatment, client-facing sends, and tax conclusions.",
    icon: CheckCircle2,
  },
] as const;

export function WelcomeTour({ forceOpen, onClose }: { forceOpen: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(forceOpen);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => setVisible(forceOpen), [forceOpen]);

  useEffect(() => {
    if (!visible) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    requestAnimationFrame(() => dialogRef.current?.focus());
  }, [visible]);

  function close() {
    localStorage.setItem(STORAGE_KEY, "seen");
    setVisible(false);
    onClose();
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  }

  function keepFocusInDialog(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    if (controls.length === 0) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const current = steps[step];
  const Icon = current.icon;
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-[#14201c]/35 p-3 backdrop-blur-sm sm:place-items-center sm:p-6" role="presentation">
      <section ref={dialogRef} tabIndex={-1} onKeyDown={keepFocusInDialog} aria-modal="true" aria-labelledby="welcome-tour-title" className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/15 bg-[#14201c] text-[#f7f7f5] shadow-2xl" role="dialog">
        <div className="relative overflow-hidden px-6 pb-7 pt-8 sm:px-9">
          <div className="absolute -right-16 -top-20 h-48 w-48 rounded-full bg-[#d4a85f]/20 blur-3xl" />
          <div className="absolute -left-16 bottom-0 h-36 w-36 rounded-full bg-[#7eb59c]/20 blur-3xl" />
          <div className="relative">
            <div className="mb-8 flex items-center justify-between">
              <div className="flex gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}`}>
                {steps.map((_, index) => <span key={index} className={`h-1.5 rounded-full transition-all ${index === step ? "w-7 bg-[#d4a85f]" : "w-1.5 bg-white/25"}`} />)}
              </div>
              <button onClick={close} className="min-h-11 px-2 text-sm text-white/65 hover:text-white">Skip tour</button>
            </div>
            <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-[#d4a85f] text-[#14201c]"><Icon className="h-5 w-5" /></div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#d4a85f]">{current.eyebrow}</p>
            <h2 id="welcome-tour-title" className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{current.title}</h2>
            <p className="mt-3 max-w-lg text-sm leading-6 text-white/72 sm:text-base">{current.body}</p>
            <div className="mt-8 flex items-center justify-between gap-3">
              <Button variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              {step === steps.length - 1 ? (
                <Button className="bg-[#d4a85f] text-[#14201c] hover:bg-[#e2bb78]" onClick={close}>Start working <CheckCircle2 className="h-4 w-4" /></Button>
              ) : (
                <Button className="bg-[#d4a85f] text-[#14201c] hover:bg-[#e2bb78]" onClick={() => setStep((value) => value + 1)}>Continue <ArrowRight className="h-4 w-4" /></Button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function shouldShowWelcomeTour() {
  return localStorage.getItem(STORAGE_KEY) !== "seen";
}
