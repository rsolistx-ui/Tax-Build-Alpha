import { useState, useEffect } from "react";
import {
  Key,
  Copy,
  Check,
  Brain,
  FileCode,
  Upload,
  Trash2,
  Play,
  CheckCircle2,
  BookOpen,
  Mic,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { VoiceRuleDictationModal } from "@/components/voice-rule-dictation-modal";

interface FirmRule {
  id: string;
  firmId: string;
  clientId: string | null;
  title: string;
  ruleType: "categorization" | "personal_vs_business" | "tax_deduction" | "general";
  markdownContent: string;
  isActive: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

interface TestResult {
  matchedCategory: string;
  taxBucket: string;
  deductible: boolean;
  isPersonal: boolean;
  confidence: number;
  reasoning: string;
  ruleCited?: string;
}

interface ClientOption {
  id: string;
  name: string;
}

const TEMPLATES = {
  schedule_c: `# IRS Schedule C Expense Bucketing Guidelines

All business purchases must be classified into standard IRS Schedule C expense lines:

- **Advertising** (Part II Line 8): Marketing, website hosting, domain names, printed business cards, social media ads.
- **Car and Truck Expenses** (Part II Line 9): Gas/fuel (Shell, Exxon, Chevron), parking, tolls, vehicle maintenance.
- **Contract Labor** (Part II Line 11): 1099 independent contractor payments, freelance services.
- **Legal and Professional Services** (Part II Line 17): CPA fees, attorney fees, bookkeeping services.
- **Office Expenses** (Part II Line 18): Postage, shipping, pens, toner, printer paper, software subscriptions (SaaS).
- **Supplies** (Part II Line 22): Materials and operating supplies used in business operations under $2,500.
- **Taxes and Licenses** (Part II Line 23): LLC annual report fees, state business filing fees, city permits.
- **Travel and Meals** (Part II Line 24):
  - Line 24a (Travel): Airline tickets, hotel stays, rental cars, Uber/Lyft for travel.
  - Line 24b (Deductible Meals): Business meals with clients (50% limitation applies).
- **Utilities** (Part II Line 25): Business phone bills, internet service, dedicated office utilities.`,

  meals_50: `# Meals & Entertainment 50% Deductibility Rules

1. **Client & Business Meals**:
   - Meals at restaurants, cafes, diners (e.g. Starbucks, Panera, local restaurants) during business meetings are **50% deductible** on Schedule C Line 24b.
   - Requirement: Valid business purpose and business relationship must be established.
2. **Entertainment**:
   - Sporting event tickets, concerts, golf, and recreational entertainment are **0% deductible** (non-deductible).
3. **Office Snacks & Coffee**:
   - Coffee and water provided to employees/clients at the office place are 50% deductible office food expenses.`,

  safe_harbor: `# De Minimis Safe Harbor Capitalization Threshold ($2,500)

Under Treasury Regulation § 1.263(a)-1(f):
- **Purchases under $2,500 per invoice / item**:
  - Deduct immediately as **Supplies** (Line 22) or **Office Expenses** (Line 18).
  - Do NOT create a multi-year depreciation schedule.
- **Purchases of $2,500 or more per item** (e.g., computers, heavy equipment, office furniture sets):
  - Must be flagged as **Capital Asset (Form 4562)** for Section 179 expensing or MACRS depreciation review.`,

  personal_filter: `# Business vs. Personal Disambiguation Rules

Flag any transactions with personal characteristics for professional review:
- **Groceries & Supermarkets** (Trader Joe's, Whole Foods, Kroger) without an explicit catering/event purpose -> Flag as **Personal / Owner Draw**.
- **Personal Subscriptions**: Netflix, Spotify, Disney+, PlayStation, gaming platforms -> Non-deductible personal.
- **Personal Retail**: Children's stores, clothing stores, personal apparel (unless branded uniform or protective gear) -> Non-deductible owner draw.
- **Gym & Health Clubs**: Non-deductible personal expenses.`,
};

export function AdminPanel() {
  const [activeTab, setActiveTab] = useState<"rules" | "tokens">("rules");
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [metrics, setMetrics] = useState({ users: 0, receipts: 0, feedback: 0, errors: 0, syncEvents: 0 });

  // Rules State
  const [rules, setRules] = useState<FirmRule[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [ruleTitle, setRuleTitle] = useState("");
  const [ruleType, setRuleType] = useState<FirmRule["ruleType"]>("categorization");
  const [ruleClientId, setRuleClientId] = useState<string>("");
  const [ruleContent, setRuleContent] = useState("");
  const [savingRule, setSavingRule] = useState(false);
  const [ruleSuccessMsg, setRuleSuccessMsg] = useState("");
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);

  // Testing Simulator State
  const [simMerchant, setSimMerchant] = useState("Home Depot");
  const [simDescription, setSimDescription] = useState("Hand tools and power cords");
  const [simAmount, setSimAmount] = useState<number>(145.5);
  const [simLoading, setSimLoading] = useState(false);
  const [simResult, setSimResult] = useState<TestResult | null>(null);

  useEffect(() => {
    loadMetrics();
    loadRules();
    loadClients();
  }, []);

  async function loadMetrics() {
    try {
      const d = await api<{ users?: number; receipts?: number; feedback?: number; errors?: number; syncEvents?: number }>("/api/admin/metrics");
      setMetrics({ users: d.users ?? 0, receipts: d.receipts ?? 0, feedback: d.feedback ?? 0, errors: d.errors ?? 0, syncEvents: d.syncEvents ?? 0 });
    } catch {}
  }

  async function loadRules() {
    setLoadingRules(true);
    try {
      const res = await api<{ rules: FirmRule[] }>("/api/admin/rules");
      setRules(res.rules || []);
    } catch {
    } finally {
      setLoadingRules(false);
    }
  }

  async function loadClients() {
    try {
      const res = await api<{ clients: ClientOption[] }>("/api/clients");
      setClients(res.clients || []);
    } catch {}
  }

  async function generate() {
    try {
      const res = await api<{ token: string }>("/api/beta/generate-token", { method: "POST", body: JSON.stringify({}) });
      setToken(res.token);
    } catch {
      setToken("error");
    }
  }

  async function handleSaveRule() {
    if (!ruleTitle.trim() || !ruleContent.trim()) return;
    setSavingRule(true);
    setRuleSuccessMsg("");
    try {
      await api("/api/admin/rules", {
        method: "POST",
        body: JSON.stringify({
          title: ruleTitle,
          markdownContent: ruleContent,
          ruleType,
          clientId: ruleClientId || null,
          isActive: true,
          priority: 10,
        }),
      });
      setRuleTitle("");
      setRuleContent("");
      setRuleSuccessMsg("Rulebook saved and active in AI pipeline!");
      await loadRules();
      setTimeout(() => setRuleSuccessMsg(""), 3500);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save rule");
    } finally {
      setSavingRule(false);
    }
  }

  async function handleDeleteRule(id: string) {
    if (!confirm("Are you sure you want to remove this rulebook?")) return;
    try {
      await api(`/api/admin/rules/${id}`, { method: "DELETE" });
      await loadRules();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete rule");
    }
  }

  async function handleToggleRule(rule: FirmRule) {
    try {
      await api(`/api/admin/rules/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      await loadRules();
    } catch {}
  }

  async function handleTestPurchase() {
    if (!simMerchant.trim()) return;
    setSimLoading(true);
    setSimResult(null);
    try {
      const res = await api<{ result: TestResult }>("/api/admin/rules/test", {
        method: "POST",
        body: JSON.stringify({
          merchant: simMerchant,
          description: simDescription,
          amount: Number(simAmount) || 0,
          rulesMarkdown: ruleContent || undefined,
        }),
      });
      setSimResult(res.result);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Simulator test failed");
    } finally {
      setSimLoading(false);
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        setRuleContent(text);
        if (!ruleTitle) {
          setRuleTitle(file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " "));
        }
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-border)] pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600">
            <Brain className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Admin & AI Knowledge Center</h1>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Dynamic Markdown rulebooks, purchase bucketing intelligence, and beta controls
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Owner Access</Badge>
          <div className="flex rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-0.5">
            <button
              onClick={() => setActiveTab("rules")}
              className={`px-3 py-1.5 text-xs font-medium rounded ${activeTab === "rules" ? "bg-[var(--color-primary)] text-white" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"}`}
            >
              AI Brain & Rules
            </button>
            <button
              onClick={() => setActiveTab("tokens")}
              className={`px-3 py-1.5 text-xs font-medium rounded ${activeTab === "tokens" ? "bg-[var(--color-primary)] text-white" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"}`}
            >
              Beta & Metrics
            </button>
          </div>
        </div>
      </div>

      {activeTab === "rules" ? (
        <div className="space-y-6">
          {/* Banner */}
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 flex items-start gap-3">
            <BookOpen className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <span className="font-semibold text-blue-900 dark:text-blue-100">Live AI Knowledge Injection:</span>{" "}
              <span className="text-blue-800/80 dark:text-blue-200/80">
                Any rulebook saved here is automatically compiled into the system instructions for Workers AI (Qwen 27B).
                When receipts or bank feeds are ingested from mobile or PC, they are placed into buckets based strictly on your rules.
              </span>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            {/* Left Column: Rule Editor & Templates (7 cols) */}
            <div className="lg:col-span-7 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <FileCode className="h-4 w-4 text-[var(--color-primary)]" />
                      Feed Markdown Rulebook
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setVoiceModalOpen(true)}
                        className="h-7 gap-1.5 bg-purple-700 hover:bg-purple-800 text-white text-xs font-medium"
                      >
                        <Mic className="h-3.5 w-3.5" /> Speak / Dictate Rule
                      </Button>
                      <label className="cursor-pointer inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded bg-[var(--color-muted)] hover:bg-[var(--color-muted)]/80 text-[var(--color-foreground)]">
                        <Upload className="h-3.5 w-3.5" />
                        Upload .md File
                        <input type="file" accept=".md,.txt" onChange={handleFileUpload} className="hidden" />
                      </label>
                    </div>
                  </CardTitle>
                  <CardDescription>
                    Write or paste domain guidance. Insert starter templates below to kickstart Schedule C rules.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Template Quick Insert */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--color-muted-foreground)]">Starter Rulebook Templates:</label>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs h-7"
                        onClick={() => {
                          setRuleTitle("IRS Schedule C Expense Buckets");
                          setRuleType("categorization");
                          setRuleContent(TEMPLATES.schedule_c);
                        }}
                      >
                        + Schedule C Standard
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs h-7"
                        onClick={() => {
                          setRuleTitle("Meals 50% Rule & Travel");
                          setRuleType("tax_deduction");
                          setRuleContent(TEMPLATES.meals_50);
                        }}
                      >
                        + Meals 50% Limitation
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs h-7"
                        onClick={() => {
                          setRuleTitle("De Minimis $2,500 Safe Harbor");
                          setRuleType("tax_deduction");
                          setRuleContent(TEMPLATES.safe_harbor);
                        }}
                      >
                        + Safe Harbor ($2,500)
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs h-7"
                        onClick={() => {
                          setRuleTitle("Business vs. Personal Filter");
                          setRuleType("personal_vs_business");
                          setRuleContent(TEMPLATES.personal_filter);
                        }}
                      >
                        + Personal Filter
                      </Button>
                    </div>
                  </div>

                  {/* Rule Metadata */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2 space-y-1">
                      <label className="text-xs font-medium">Rulebook Title</label>
                      <Input
                        placeholder="e.g. Schedule C Expense Buckets"
                        value={ruleTitle}
                        onChange={(e) => setRuleTitle(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Rule Type</label>
                      <select
                        className="w-full h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 text-xs"
                        value={ruleType}
                        onChange={(e) => setRuleType(e.target.value as any)}
                      >
                        <option value="categorization">Categorization</option>
                        <option value="tax_deduction">Tax Deduction</option>
                        <option value="personal_vs_business">Personal vs Business</option>
                        <option value="general">General</option>
                      </select>
                    </div>
                  </div>

                  {/* Client Scope */}
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Target Client Scope</label>
                    <select
                      className="w-full h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 text-xs"
                      value={ruleClientId}
                      onChange={(e) => setRuleClientId(e.target.value)}
                    >
                      <option value="">Global — Applies to All Clients</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          Client: {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Markdown Editor */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-medium">Markdown Rule Content</label>
                      <span className="text-[10px] text-[var(--color-muted-foreground)]">Markdown supported</span>
                    </div>
                    <textarea
                      rows={10}
                      className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-3 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                      placeholder="Type or paste markdown instructions for the AI..."
                      value={ruleContent}
                      onChange={(e) => setRuleContent(e.target.value)}
                    />
                  </div>

                  {ruleSuccessMsg ? (
                    <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-500/10 p-2.5 rounded">
                      <CheckCircle2 className="h-4 w-4" />
                      {ruleSuccessMsg}
                    </div>
                  ) : null}

                  <Button
                    onClick={handleSaveRule}
                    disabled={savingRule || !ruleTitle.trim() || !ruleContent.trim()}
                    className="w-full"
                  >
                    {savingRule ? "Saving & Compiling..." : "Save & Activate Rulebook"}
                  </Button>
                </CardContent>
              </Card>

              {/* Active Rules List */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>Active Rulebooks ({rules.length})</span>
                    <Button variant="ghost" size="sm" onClick={loadRules} className="text-xs h-7">
                      Refresh
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {loadingRules ? (
                    <p className="text-xs text-[var(--color-muted-foreground)]">Loading active rulebooks...</p>
                  ) : rules.length === 0 ? (
                    <div className="text-center py-6 border border-dashed rounded-lg">
                      <FileCode className="h-8 w-8 mx-auto text-[var(--color-muted-foreground)] opacity-40 mb-2" />
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        No active rulebooks yet. Click a starter template above to activate Schedule C rules!
                      </p>
                    </div>
                  ) : (
                    rules.map((rule) => (
                      <div
                        key={rule.id}
                        className={`p-3.5 rounded-lg border transition-colors ${rule.isActive ? "border-[var(--color-border)] bg-[var(--color-card)]" : "border-dashed opacity-60 bg-[var(--color-muted)]"}`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold">{rule.title}</span>
                              <Badge className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                                {rule.ruleType.replace(/_/g, " ")}
                              </Badge>
                              {rule.clientId ? (
                                <Badge className="text-[10px] bg-stone-100 text-stone-700 border border-stone-300">
                                  Client-Specific
                                </Badge>
                              ) : (
                                <Badge className="text-[10px] bg-blue-100 text-blue-800 border-blue-200">
                                  Global
                                </Badge>
                              )}
                            </div>
                            <span className="text-[11px] text-[var(--color-muted-foreground)]">
                              Updated {new Date(rule.updatedAt).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs h-7 px-2"
                              onClick={() => {
                                setRuleTitle(rule.title);
                                setRuleType(rule.ruleType);
                                setRuleClientId(rule.clientId || "");
                                setRuleContent(rule.markdownContent);
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`text-xs h-7 px-2 ${rule.isActive ? "text-amber-600" : "text-emerald-600"}`}
                              onClick={() => handleToggleRule(rule)}
                            >
                              {rule.isActive ? "Disable" : "Enable"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-red-500 hover:text-red-700"
                              onClick={() => handleDeleteRule(rule.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <p className="text-xs font-mono text-[var(--color-muted-foreground)] line-clamp-2 bg-[var(--color-muted)] p-1.5 rounded">
                          {rule.markdownContent}
                        </p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right Column: Live AI Bucketing Simulator (5 cols) */}
            <div className="lg:col-span-5 space-y-6">
              <Card className="sticky top-20 border-[var(--color-primary)]/30">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Play className="h-4 w-4 text-emerald-500 fill-emerald-500" />
                    Live AI Bucketing Simulator
                  </CardTitle>
                  <CardDescription>
                    Test how Workers AI evaluates a real merchant or purchase description against your active rules.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Merchant / Vendor</label>
                    <Input
                      placeholder="e.g. Staples, Panera Bread, Shell"
                      value={simMerchant}
                      onChange={(e) => setSimMerchant(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium">Item Description</label>
                    <Input
                      placeholder="e.g. Printer ink cartridges, client lunch"
                      value={simDescription}
                      onChange={(e) => setSimDescription(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium">Amount ($)</label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={simAmount}
                      onChange={(e) => setSimAmount(parseFloat(e.target.value) || 0)}
                    />
                  </div>

                  <Button
                    onClick={handleTestPurchase}
                    disabled={simLoading || !simMerchant.trim()}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {simLoading ? "Evaluating via Workers AI..." : "Test AI Bucketing"}
                  </Button>

                  {/* Simulator Output Result */}
                  {simResult ? (
                    <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/50 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs uppercase font-bold tracking-wider text-[var(--color-muted-foreground)]">
                          Simulation Result
                        </span>
                        <Badge
                          className={simResult.isPersonal ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}
                        >
                          {simResult.isPersonal ? "Personal Expense" : "Tax Deductible"}
                        </Badge>
                      </div>

                      <div className="space-y-1">
                        <div className="text-xs text-[var(--color-muted-foreground)]">Assigned Bucket / Category:</div>
                        <div className="text-base font-bold text-[var(--color-foreground)]">
                          {simResult.matchedCategory}
                        </div>
                        <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          {simResult.taxBucket}
                        </div>
                      </div>

                      <div className="pt-2 border-t border-[var(--color-border)] text-xs space-y-1.5">
                        <div>
                          <span className="font-semibold">AI Rationale:</span> {simResult.reasoning}
                        </div>
                        {simResult.ruleCited ? (
                          <div>
                            <span className="font-semibold">Rule Applied:</span>{" "}
                            <span className="font-mono bg-[var(--color-card)] px-1.5 py-0.5 rounded border">
                              {simResult.ruleCited}
                            </span>
                          </div>
                        ) : null}
                        <div className="text-[10px] text-[var(--color-muted-foreground)]">
                          AI Confidence: {Math.round(simResult.confidence * 100)}%
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-6 text-xs text-[var(--color-muted-foreground)] border border-dashed rounded-lg">
                      Enter a merchant and amount, then click "Test AI Bucketing" to see the live categorization.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      ) : (
        /* Tokens & Operations Tab */
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-[var(--color-muted-foreground)]">Beta users</div>
                <div className="text-2xl font-bold">{metrics.users}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-[var(--color-muted-foreground)]">Receipts uploaded</div>
                <div className="text-2xl font-bold">{metrics.receipts}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-[var(--color-muted-foreground)]">Feedback items</div>
                <div className="text-2xl font-bold">{metrics.feedback}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-[var(--color-muted-foreground)]">Errors / issues</div>
                <div className="text-2xl font-bold">{metrics.errors}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-4 w-4" /> Beta Token Generator
              </CardTitle>
              <CardDescription>
                64-bit random hex token. Provide to Phyllis or beta users for invitation redemption.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                <Button onClick={generate} size="sm">
                  Generate 64-bit Token
                </Button>
                <Button variant="outline" size="sm" onClick={loadMetrics}>
                  Refresh Metrics
                </Button>
              </div>
              {token && (
                <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 font-mono text-sm">
                  <span className="truncate max-w-sm">{token}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      navigator.clipboard.writeText(token);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    aria-label="Copy"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : null}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <VoiceRuleDictationModal
        isOpen={voiceModalOpen}
        onClose={() => setVoiceModalOpen(false)}
        onRuleCreated={() => void loadRules()}
      />
    </div>
  );
}
