import { useState, useEffect, useRef } from "react";
import {
  Lightbulb,
  Mic,
  MicOff,
  CheckCircle2,
  AlertTriangle,
  X,
  Loader2,
  Clock,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface FeatureRequest {
  id: string;
  title: string;
  description: string;
  area: string;
  status: string;
  createdAt: string;
}

interface FeatureRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultClientId?: string;
}

export function FeatureRequestModal({
  isOpen,
  onClose,
  defaultClientId,
}: FeatureRequestModalProps) {
  const [tab, setTab] = useState<"new" | "history">("new");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [area, setArea] = useState("general");
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pastRequests, setPastRequests] = useState<FeatureRequest[]>([]);

  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (isOpen) {
      setSubmitted(false);
      setError(null);
      void loadHistory();
    }
  }, [isOpen]);

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
        setDescription(transcript.trim());
        if (!title && transcript.trim().length > 0) {
          setTitle(transcript.trim().slice(0, 50));
        }
      };

      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);

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
  }, [title]);

  async function loadHistory() {
    try {
      const data = await api<{ requests: FeatureRequest[] }>("/api/feature-requests");
      setPastRequests(data.requests || []);
    } catch {
      // Best effort load
    }
  }

  function toggleListening() {
    if (!recognitionRef.current) {
      setError("Microphone speech recognition is not supported in this browser. You can type directly below.");
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setError("Please provide a title and explanation of what feature you'd like.");
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }

    setLoading(true);
    setError(null);

    try {
      await api("/api/feature-requests", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          area,
          clientId: defaultClientId || undefined,
          source: isListening ? "voice" : "text",
        }),
      });

      setSubmitted(true);
      setTitle("");
      setDescription("");
      void loadHistory();
    } catch (err: any) {
      setError(err?.message || "Failed to submit feature request.");
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

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

        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400">
              <Lightbulb className="h-5 w-5" />
            </span>
            <div>
              <CardTitle className="text-base">Request a Feature / Suggest Improvement</CardTitle>
              <CardDescription className="text-xs">
                Tell our team directly what would save you time. We build and deploy updates weekly.
              </CardDescription>
            </div>
          </div>

          <div className="flex gap-2 pt-2 border-b border-[var(--color-border)] text-xs">
            <button
              type="button"
              onClick={() => setTab("new")}
              className={`pb-1.5 font-medium border-b-2 transition-colors ${
                tab === "new"
                  ? "border-amber-600 text-amber-700 dark:text-amber-400"
                  : "border-transparent text-[var(--color-muted-foreground)]"
              }`}
            >
              New Request
            </button>
            <button
              type="button"
              onClick={() => setTab("history")}
              className={`pb-1.5 font-medium border-b-2 transition-colors ${
                tab === "history"
                  ? "border-amber-600 text-amber-700 dark:text-amber-400"
                  : "border-transparent text-[var(--color-muted-foreground)]"
              }`}
            >
              Past Requests ({pastRequests.length})
            </button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {error ? (
            <div className="flex items-center gap-2 rounded-md bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {tab === "new" ? (
            submitted ? (
              <div className="space-y-3 py-6 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <h3 className="text-sm font-semibold text-[var(--color-foreground)]">Request Logged with Our Team</h3>
                <p className="text-xs text-[var(--color-muted-foreground)] max-w-sm mx-auto">
                  Thank you! Your suggestion has been added to our development backlog. We review requests weekly and audit them for security and numerical accuracy.
                </p>
                <div className="pt-2 flex justify-center gap-2">
                  <Button size="sm" onClick={() => setSubmitted(false)}>
                    Submit Another Idea
                  </Button>
                  <Button size="sm" variant="outline" onClick={onClose}>
                    Close
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="req-area" className="text-xs font-medium">
                    What area is this for?
                  </Label>
                  <select
                    id="req-area"
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-xs text-[var(--color-foreground)]"
                  >
                    <option value="general">General Platform Feature</option>
                    <option value="receipt_scanning">Receipt &amp; Phone Camera Scanning</option>
                    <option value="categorization">AI Categorization &amp; Buckets</option>
                    <option value="tax_radar">1099 Radar &amp; Tax Prep Bridge</option>
                    <option value="reports">P&amp;L, Excel &amp; Financial Workpapers</option>
                    <option value="bank_feed">Bank Feeds &amp; Reconciliation</option>
                    <option value="ui_ux">UI, Dark Mode &amp; Ergonomics</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="req-title" className="text-xs font-medium">
                    Title / Summary
                  </Label>
                  <input
                    id="req-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. 1-click export format for Drake or Lacerte"
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-xs text-[var(--color-foreground)]"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="req-desc" className="text-xs font-medium">
                      Description / Voice Dictation
                    </Label>
                    {speechSupported ? (
                      <Button
                        type="button"
                        size="sm"
                        variant={isListening ? "default" : "outline"}
                        onClick={toggleListening}
                        className={`h-6 gap-1 px-2 text-[11px] ${
                          isListening
                            ? "bg-rose-600 hover:bg-rose-700 text-white animate-pulse"
                            : "text-amber-700 border-amber-200 dark:border-amber-800 dark:text-amber-400"
                        }`}
                      >
                        {isListening ? (
                          <>
                            <MicOff className="h-3 w-3" /> Stop Mic
                          </>
                        ) : (
                          <>
                            <Mic className="h-3 w-3" /> Dictate with Mic
                          </>
                        )}
                      </Button>
                    ) : null}
                  </div>
                  <div className="relative">
                    <textarea
                      id="req-desc"
                      rows={4}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Speak or describe what would save you time and how you'd like it to work..."
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-2.5 text-xs leading-relaxed text-[var(--color-foreground)] focus:border-amber-500 focus:outline-none"
                    />
                    {isListening ? (
                      <div className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-600 dark:text-rose-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-ping" />
                        Listening...
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)]">
                  <span className="text-[11px] text-[var(--color-muted-foreground)]">
                    Direct engineering feedback channel
                  </span>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={onClose}>
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!title.trim() || !description.trim() || loading}
                      className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-medium"
                    >
                      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      Send to Engineering
                    </Button>
                  </div>
                </div>
              </form>
            )
          ) : (
            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {pastRequests.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--color-muted-foreground)]">
                  No feature requests submitted yet.
                </div>
              ) : (
                pastRequests.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3 space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[var(--color-foreground)]">{r.title}</span>
                      <Badge
                        className={`text-[10px] capitalize ${
                          r.status === "completed"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                            : r.status === "in_progress"
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                            : "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300"
                        }`}
                      >
                        {r.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <p className="text-[var(--color-muted-foreground)] line-clamp-2">{r.description}</p>
                    <div className="flex items-center gap-2 pt-1 text-[10px] text-[var(--color-muted-foreground)]">
                      <span className="capitalize">{r.area.replace(/_/g, " ")}</span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
