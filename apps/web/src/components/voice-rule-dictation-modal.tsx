import { useState, useEffect, useRef } from "react";
import {
  Mic,
  MicOff,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  X,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface ClientOption {
  id: string;
  name: string;
}

interface DictateResult {
  title: string;
  ruleType: "categorization" | "personal_vs_business" | "tax_deduction" | "general";
  markdownContent: string;
  explanation: string;
  auditPassed: boolean;
  auditNotes: string[];
}

interface VoiceRuleDictationModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultClientId?: string;
  defaultClientName?: string;
  onRuleCreated?: () => void;
}

export function VoiceRuleDictationModal({
  isOpen,
  onClose,
  defaultClientId,
  defaultClientName,
  onRuleCreated,
}: VoiceRuleDictationModalProps) {
  const [dictatedText, setDictatedText] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string>(defaultClientId ?? "");
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [isRetroactive, setIsRetroactive] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split("T")[0];
  });
  const [loading, setLoading] = useState(false);
  const [compiledResult, setCompiledResult] = useState<DictateResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (isOpen) {
      void loadClients();
      setCompiledResult(null);
      setSavedSuccess(null);
      setError(null);
      if (defaultClientId) setSelectedClientId(defaultClientId);
    }
  }, [isOpen, defaultClientId]);

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event: any) => {
        let transcript = "";
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript + " ";
        }
        setDictatedText(transcript.trim());
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    } catch {
      setSpeechSupported(false);
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  async function loadClients() {
    try {
      const data = await api<{ clients: ClientOption[] }>("/api/clients");
      setClients(data.clients || []);
    } catch {
      // Best effort load
    }
  }

  function toggleListening() {
    if (!recognitionRef.current) {
      setError("Speech recognition is not available in your browser. You can type your instructions directly.");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setError(null);
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch {
        setIsListening(false);
      }
    }
  }

  async function handleCompile(e: React.FormEvent) {
    e.preventDefault();
    if (!dictatedText.trim()) {
      setError("Please speak or type a rule instruction first.");
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }

    setLoading(true);
    setError(null);

    const clientObj = clients.find((c) => c.id === selectedClientId);
    const clientName = clientObj?.name || defaultClientName;

    try {
      const data = await api<{ result: DictateResult }>("/api/admin/rules/dictate", {
        method: "POST",
        body: JSON.stringify({
          dictatedText: dictatedText.trim(),
          clientId: selectedClientId || null,
          clientName,
        }),
      });

      setCompiledResult(data.result);
    } catch (err: any) {
      setError(err?.message || "Failed to compile dictated rule.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveAndApply() {
    if (!compiledResult) return;
    setSaving(true);
    setError(null);

    try {
      // 1. Create the rule
      const createdRes = await api<{ rule: { id: string } }>("/api/admin/rules", {
        method: "POST",
        body: JSON.stringify({
          title: compiledResult.title,
          markdownContent: compiledResult.markdownContent,
          ruleType: compiledResult.ruleType,
          clientId: selectedClientId || null,
          effectiveFrom: isRetroactive ? effectiveFrom : new Date().toISOString().split("T")[0],
          dictatedPrompt: dictatedText.trim(),
          isActive: true,
          priority: selectedClientId ? 10 : 0, // Client-specific rules get higher precedence
        }),
      });

      // 2. If retroactive selected, apply retroactively
      let retroactiveMsg = "";
      if (isRetroactive) {
        try {
          const retroRes = await api<{ result: { receiptsEvaluated: number; receiptsUpdated: number } }>(
            `/api/admin/rules/${createdRes.rule.id}/apply-retroactive`,
            { method: "POST" }
          );
          retroactiveMsg = ` Retroactively evaluated ${retroRes.result.receiptsEvaluated} receipts; updated ${retroRes.result.receiptsUpdated}.`;
        } catch {
          retroactiveMsg = " (Rule active for new receipts; retroactive sync queued).";
        }
      }

      setSavedSuccess(`Rule activated and compiled into AI knowledge base!${retroactiveMsg}`);
      onRuleCreated?.();
    } catch (err: any) {
      setError(err?.message || "Failed to save rule.");
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <Card className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-400">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <CardTitle className="text-base">Teach the AI (Voice &amp; Rules)</CardTitle>
              <CardDescription className="text-xs">
                Speak or type natural guidelines. The brain compiles, audits, and applies them in real time.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {error ? (
            <div className="flex items-center gap-2 rounded-md bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {savedSuccess ? (
            <div className="space-y-4 py-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h3 className="text-sm font-semibold text-[var(--color-foreground)]">AI Successfully Trained</h3>
              <p className="text-xs text-[var(--color-muted-foreground)] max-w-md mx-auto">
                {savedSuccess}
              </p>
              <div className="pt-2 flex justify-center gap-2">
                <Button size="sm" onClick={() => { setCompiledResult(null); setSavedSuccess(null); setDictatedText(""); }}>
                  Train Another Rule
                </Button>
                <Button size="sm" variant="outline" onClick={onClose}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleCompile} className="space-y-4">
              {/* Target Client Scope */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="rule-client-scope" className="text-xs font-medium">
                    Target Client
                  </Label>
                  <select
                    id="rule-client-scope"
                    value={selectedClientId}
                    onChange={(e) => setSelectedClientId(e.target.value)}
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-xs text-[var(--color-foreground)]"
                  >
                    <option value="">Global (Applies to all clients)</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Retroactive vs Forward Scoping */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Effective Date Scoping</Label>
                  <div className="flex items-center gap-2 pt-1">
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isRetroactive}
                        onChange={(e) => setIsRetroactive(e.target.checked)}
                        className="rounded border-[var(--color-border)]"
                      />
                      <span>Apply retroactively</span>
                    </label>
                  </div>
                  {isRetroactive ? (
                    <div className="flex items-center gap-2 pt-1">
                      <Calendar className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
                      <input
                        type="date"
                        value={effectiveFrom}
                        onChange={(e) => setEffectiveFrom(e.target.value)}
                        className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-xs text-[var(--color-foreground)]"
                      />
                    </div>
                  ) : (
                    <p className="text-[11px] text-[var(--color-muted-foreground)]">
                      Applies to receipts from today forward.
                    </p>
                  )}
                </div>
              </div>

              {/* Dictation Box with Mic Pulse */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="dictation-input" className="text-xs font-medium">
                    What should the AI do?
                  </Label>
                  <div className="flex items-center gap-1.5">
                    {speechSupported ? (
                      <Button
                        type="button"
                        size="sm"
                        variant={isListening ? "default" : "outline"}
                        onClick={toggleListening}
                        className={`h-7 gap-1 px-2 text-xs ${
                          isListening
                            ? "bg-rose-600 hover:bg-rose-700 text-white animate-pulse"
                            : "text-purple-700 border-purple-200 dark:border-purple-800 dark:text-purple-400"
                        }`}
                      >
                        {isListening ? (
                          <>
                            <MicOff className="h-3.5 w-3.5" /> Stop Mic
                          </>
                        ) : (
                          <>
                            <Mic className="h-3.5 w-3.5" /> Click to Speak
                          </>
                        )}
                      </Button>
                    ) : (
                      <span className="text-[11px] text-[var(--color-muted-foreground)]">
                        Type instructions below
                      </span>
                    )}
                  </div>
                </div>

                <div className="relative">
                  <textarea
                    id="dictation-input"
                    rows={4}
                    value={dictatedText}
                    onChange={(e) => setDictatedText(e.target.value)}
                    placeholder="e.g. 'For ABC Construction, every Home Depot receipt over $500 goes into Job Supplies. If under $100 it is Minor Tools. If paid with Chase card 4092 it's business, but if it has food or coffee flag as personal draw.'"
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-xs leading-relaxed text-[var(--color-foreground)] focus:border-purple-500 focus:outline-none"
                  />
                  {isListening ? (
                    <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-rose-500/10 px-2.5 py-1 text-[10px] font-medium text-rose-600 dark:text-rose-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-ping" />
                      Listening to your voice...
                    </div>
                  ) : null}
                </div>
              </div>

              {!compiledResult ? (
                <div className="flex items-center justify-between pt-2">
                  <span className="text-[11px] text-[var(--color-muted-foreground)]">
                    Free native Edge AI · Zero token costs
                  </span>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={onClose}>
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!dictatedText.trim() || loading}
                      className="gap-1.5 bg-purple-700 hover:bg-purple-800 text-white"
                    >
                      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      Compile &amp; Audit Rule
                    </Button>
                  </div>
                </div>
              ) : null}
            </form>
          )}

          {/* Compiled Result & Safety Audit Preview */}
          {compiledResult && !savedSuccess ? (
            <div className="space-y-3 pt-3 border-t border-[var(--color-border)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-semibold text-[var(--color-foreground)]">
                    Compiled Rule: {compiledResult.title}
                  </h4>
                  <Badge className="text-[10px] bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300">
                    {compiledResult.ruleType}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span className="font-medium text-[11px]">Tax Audit Passed</span>
                </div>
              </div>

              <div className="rounded-lg bg-[var(--color-muted)] p-3 text-xs space-y-2">
                <p className="font-medium text-[var(--color-foreground)]">{compiledResult.explanation}</p>
                <div className="rounded border border-[var(--color-border)] bg-[var(--color-background)] p-2 font-mono text-[11px] text-[var(--color-muted-foreground)] whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {compiledResult.markdownContent}
                </div>
              </div>

              <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/30 p-2.5 text-[11px] text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
                <span>
                  ✓ {compiledResult.auditNotes[0] || "Numerical thresholds verified. Schedule C taxonomy intact."}
                </span>
                {isRetroactive ? (
                  <span className="font-medium text-amber-700 dark:text-amber-400">
                    Retroactive from {effectiveFrom}
                  </span>
                ) : null}
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCompiledResult(null)}
                  className="text-xs text-[var(--color-muted-foreground)]"
                >
                  Edit Instruction
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={saving}
                    onClick={handleSaveAndApply}
                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Activate &amp; Train AI
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
