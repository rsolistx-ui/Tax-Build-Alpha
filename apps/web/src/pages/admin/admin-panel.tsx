import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
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
  ShieldCheck,
  Zap,
  Filter,
  RefreshCw,
  LayoutDashboard,
  Headphones,
  Sparkles,
  Users,
  Send,
  Receipt,
  FileCheck2,
  Flame,
  Scale,
  Clock,
  AlertTriangle,
  History,
  Lock,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BetaMetricsCard } from "@/components/beta-metrics-card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { api, setAdminToken } from "@/lib/api";
import { VoiceRuleDictationModal } from "@/components/voice-rule-dictation-modal";
import { AdminTokenGate } from "@/components/admin-token-gate";
import { formatDate, formatTime, formatDateTime, formatLegibleMessage } from "@/lib/formatters";

export interface InvitationItem {
  id: string;
  email: string;
  status: "pending" | "redeemed" | "expired" | "revoked";
  issued_at: string;
  expires_at: string;
  redeemed_at: string | null;
  beta_days: number;
}

export interface EntitlementItem {
  user_id: string;
  email: string | null;
  name: string | null;
  status: "active" | "expired" | "revoked";
  starts_at: string;
  expires_at: string;
  revoked_at: string | null;
  revocation_reason: string | null;
}

export interface AuditEventItem {
  id: string;
  action: string;
  actor_user_id: string | null;
  affected_user_id: string | null;
  affected_email: string | null;
  reason: string | null;
  created_at: string;
  after_json?: any;
}

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

interface SupportTicket {
  id: string;
  firm_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  subject: string;
  message: string;
  category: string;
  status: "open" | "auto_responded" | "in_progress" | "resolved";
  ai_response: string | null;
  auto_responded_at: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface RuleRequest {
  id: string;
  firm_id: string;
  client_id: string | null;
  client_name: string | null;
  requested_by: string;
  user_email: string;
  directive_text: string;
  rule_type: string;
  status: "pending_review" | "compiled" | "pushed" | "rejected";
  ai_notes: string | null;
  created_at: string;
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
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<"dashboard" | "support" | "rule_requests" | "rules" | "tokens" | "audit">("dashboard");
  const [copied, setCopied] = useState(false);
  
  // Licensing & Entitlements State
  const [invitations, setInvitations] = useState<InvitationItem[]>([]);
  const [entitlements, setEntitlements] = useState<EntitlementItem[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventItem[]>([]);
  const [loadingLicensing, setLoadingLicensing] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDays, setInviteDays] = useState<number>(30);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [generatedInviteLink, setGeneratedInviteLink] = useState<string | null>(null);
  const [licensingMsg, setLicensingMsg] = useState<string | null>(null);
  
  // Telemetry metrics
  const [metrics, setMetrics] = useState({
    users: 0,
    totalClients: 0,
    receipts: 0,
    feedback: 0,
    tickets: 0,
    openTickets: 0,
    ruleRequests: 0,
    esignDocs: 0,
    activeRules: 0,
    errors: 0,
    syncEvents: 0,
    deadLetterOperations: 0,
    tokenMetrics: {
      estimatedTokensConsumed: 1240,
      budgetTokensMonthly: 500000,
      costProtectionActive: true,
      tokensSavedViaRuleCache: 8500,
    },
  });

  // Support Tickets State
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [replyMessage, setReplyMessage] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [replySuccess, setReplySuccess] = useState<string | null>(null);

  // Client Rule Requests State
  const [ruleRequests, setRuleRequests] = useState<RuleRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);

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

  // Client Scoping & Retroactive Recalculation
  const [filterClientId, setFilterClientId] = useState<string>("");
  const [retroactiveApplyingId, setRetroactiveApplyingId] = useState<string | null>(null);
  const [retroactiveStatusMsg, setRetroactiveStatusMsg] = useState<string | null>(null);

  // Testing Simulator State
  const [simMerchant, setSimMerchant] = useState("Home Depot");
  const [simDescription, setSimDescription] = useState("Hand tools and power cords");
  const [simAmount, setSimAmount] = useState<number>(145.5);
  const [simLoading, setSimLoading] = useState(false);
  const [simResult, setSimResult] = useState<TestResult | null>(null);

  // Auto-authenticate via ?key= URL parameter
  useEffect(() => {
    const keyParam = searchParams.get("key");
    if (keyParam && keyParam.length === 64 && /^[0-9a-fA-F]{64}$/.test(keyParam)) {
      setAdminToken(keyParam);
    }
  }, [searchParams]);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    await Promise.all([
      loadMetrics(),
      loadTickets(),
      loadRuleRequests(),
      loadRules(),
      loadClients(),
      loadLicensingData(),
    ]);
  }

  async function loadLicensingData() {
    setLoadingLicensing(true);
    try {
      const [invRes, entRes, audRes] = await Promise.all([
        api<{ invitations: InvitationItem[] }>("/api/beta/invitations").catch(() => ({ invitations: [] })),
        api<{ entitlements: EntitlementItem[] }>("/api/beta/entitlements").catch(() => ({ entitlements: [] })),
        api<{ events: AuditEventItem[] }>("/api/beta/audit").catch(() => ({ events: [] })),
      ]);
      setInvitations(invRes.invitations || []);
      setEntitlements(entRes.entitlements || []);
      setAuditEvents(audRes.events || []);
    } catch {
    } finally {
      setLoadingLicensing(false);
    }
  }

  async function handleCreateInvitation() {
    if (!inviteEmail.trim() || !inviteEmail.includes("@")) {
      alert("Please enter a valid recipient email address.");
      return;
    }
    setGeneratingInvite(true);
    setGeneratedInviteLink(null);
    try {
      const res = await api<{ invitation: { id: string; email: string; token: string; betaDays: number } }>(
        "/api/beta/invitations",
        {
          method: "POST",
          body: JSON.stringify({ email: inviteEmail.trim().toLowerCase(), betaDays: inviteDays }),
        }
      );
      const link = `${window.location.origin}/beta-redeem?token=${res.invitation.token}&email=${encodeURIComponent(res.invitation.email)}`;
      setGeneratedInviteLink(link);
      setLicensingMsg(`Invitation generated for ${res.invitation.email} (${res.invitation.betaDays} days duration)!`);
      await loadLicensingData();
    } catch (err: any) {
      alert(err?.message || "Failed to create invitation");
    } finally {
      setGeneratingInvite(false);
    }
  }

  async function handleRevokeInvitation(id: string) {
    if (!confirm("Revoke this pending invitation?")) return;
    try {
      await api(`/api/beta/invitations/${id}/revoke`, { method: "POST" });
      await loadLicensingData();
    } catch (err: any) {
      alert(err?.message || "Failed to revoke invitation");
    }
  }

  async function handleExtendEntitlement(userId: string, days: number) {
    try {
      await api(`/api/beta/entitlements/${userId}/extend`, {
        method: "POST",
        body: JSON.stringify({ additionalDays: days }),
      });
      setLicensingMsg(`Entitlement extended by ${days} days!`);
      setTimeout(() => setLicensingMsg(null), 4000);
      await loadLicensingData();
    } catch (err: any) {
      alert(err?.message || "Failed to extend license");
    }
  }

  async function handleRevokeEntitlement(userId: string) {
    if (!confirm("Are you sure you want to revoke this user's license immediately?")) return;
    try {
      await api(`/api/beta/entitlements/${userId}/revoke`, {
        method: "POST",
        body: JSON.stringify({ reason: "Revoked by master admin" }),
      });
      setLicensingMsg("License revoked.");
      setTimeout(() => setLicensingMsg(null), 4000);
      await loadLicensingData();
    } catch (err: any) {
      alert(err?.message || "Failed to revoke license");
    }
  }

  async function handleReactivateEntitlement(userId: string, days: number = 90) {
    try {
      await api(`/api/beta/entitlements/${userId}/reactivate`, {
        method: "POST",
        body: JSON.stringify({ betaDays: days }),
      });
      setLicensingMsg(`License reactivated for ${days} days!`);
      setTimeout(() => setLicensingMsg(null), 4000);
      await loadLicensingData();
    } catch (err: any) {
      alert(err?.message || "Failed to reactivate license");
    }
  }

  async function deployPresetRule(title: string, type: FirmRule["ruleType"], markdown: string) {
    try {
      await api("/api/admin/rules", {
        method: "POST",
        body: JSON.stringify({
          title,
          ruleType: type,
          markdownContent: markdown,
          clientId: null,
          isActive: true,
          priority: 10,
        }),
      });
      await loadRules();
      await loadMetrics();
      alert(`Policy "${title}" deployed firm-wide successfully!`);
    } catch (err: any) {
      alert(err?.message || "Failed to deploy policy");
    }
  }

  async function loadMetrics() {
    try {
      const d = await api<any>("/api/admin/metrics");
      setMetrics({
        users: d.users ?? 0,
        totalClients: d.totalClients ?? 0,
        receipts: d.receipts ?? 0,
        feedback: d.feedback ?? 0,
        tickets: d.tickets ?? 0,
        openTickets: d.openTickets ?? 0,
        ruleRequests: d.ruleRequests ?? 0,
        esignDocs: d.esignDocs ?? 0,
        activeRules: d.activeRules ?? 0,
        errors: d.errors ?? 0,
        syncEvents: d.syncEvents ?? 0,
        deadLetterOperations: d.deadLetterOperations ?? 0,
        tokenMetrics: d.tokenMetrics ?? {
          estimatedTokensConsumed: 1240,
          budgetTokensMonthly: 500000,
          costProtectionActive: true,
          tokensSavedViaRuleCache: 8500,
        },
      });
    } catch {}
  }

  async function loadTickets() {
    setLoadingTickets(true);
    try {
      const res = await api<{ tickets: SupportTicket[] }>("/api/admin/tickets");
      setTickets(res.tickets || []);
    } catch {
    } finally {
      setLoadingTickets(false);
    }
  }

  async function loadRuleRequests() {
    setLoadingRequests(true);
    try {
      const res = await api<{ ruleRequests: RuleRequest[] }>("/api/admin/rule-requests");
      setRuleRequests(res.ruleRequests || []);
    } catch {
    } finally {
      setLoadingRequests(false);
    }
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

  async function handleSendReply(ticketId: string) {
    if (!replyMessage.trim()) return;
    setSendingReply(true);
    setReplySuccess(null);
    try {
      await api(`/api/admin/tickets/${ticketId}/reply`, {
        method: "POST",
        body: JSON.stringify({ replyMessage: replyMessage.trim() }),
      });
      setReplySuccess("Reply dispatched directly to client email!");
      setReplyMessage("");
      await loadTickets();
      setTimeout(() => setReplySuccess(null), 4000);
    } catch (err: any) {
      alert(err?.message || "Failed to send email reply");
    } finally {
      setSendingReply(false);
    }
  }

  async function handleUpdateTicketStatus(ticketId: string, status: "open" | "auto_responded" | "in_progress" | "resolved") {
    try {
      await api(`/api/admin/tickets/${ticketId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await loadTickets();
      await loadMetrics();
      if (selectedTicket?.id === ticketId) {
        setSelectedTicket((prev) => (prev ? { ...prev, status } : null));
      }
    } catch (err: any) {
      alert(err?.message || "Failed to update ticket status");
    }
  }

  function handleCompileClientRule(req: RuleRequest) {
    // Pre-fill RuleForge with the client's request
    setRuleTitle(`Directive: ${req.client_name || "Practice"} — ${req.directive_text.slice(0, 30)}`);
    setRuleContent(
      `# Compliance Directive for ${req.client_name || "All Clients"}\n\nClient Request: "${req.directive_text}"\n\n- Categorize matching transactions per Schedule C guidelines.\n- Apply to all future imports for ${req.client_name || "this client"}.`
    );
    if (req.client_id) setRuleClientId(req.client_id);
    setActiveTab("rules");
    window.scrollTo({ top: 400, behavior: "smooth" });
  }

  async function handleRulebookFile(file: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".md")) {
      alert("Rulebook Upload accepts Markdown (.md) files only.");
      return;
    }
    if (file.size === 0 || file.size > 512 * 1024) {
      alert("Choose a Markdown rulebook between 1 byte and 512 KB.");
      return;
    }
    try {
      const markdown = await file.text();
      if (!markdown.trim()) {
        alert("This Markdown file is empty.");
        return;
      }
      setRuleTitle(file.name.replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim() || "Imported rulebook");
      setRuleContent(markdown);
      setRuleSuccessMsg("Rulebook loaded. Choose its client scope, test it below, then approve deployment.");
    } catch {
      alert("Truepost could not read that Markdown file.");
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
      setRuleSuccessMsg("Rulebook saved and active in Truepost engine!");
      await loadRules();
      await loadMetrics();
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
      await loadMetrics();
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
      await loadMetrics();
    } catch {}
  }

  async function handleApplyRetroactive(rule: FirmRule) {
    setRetroactiveApplyingId(rule.id);
    setRetroactiveStatusMsg(null);
    try {
      const res = await api<{ result: { updatedCount: number; ruleTitle: string } }>(
        `/api/admin/rules/${rule.id}/apply-retroactive`,
        { method: "POST" }
      );
      setRetroactiveStatusMsg(
        `Directive "${rule.title}" applied retroactively: ${res.result.updatedCount} historical transaction(s) recalculated.`
      );
      setTimeout(() => setRetroactiveStatusMsg(null), 6000);
    } catch (err: any) {
      alert(err?.message || "Failed to apply rule retroactively");
    } finally {
      setRetroactiveApplyingId(null);
    }
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
          clientId: ruleClientId || filterClientId || undefined,
        }),
      });
      setSimResult(res.result);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setSimLoading(false);
    }
  }

  const filteredRules = filterClientId
    ? rules.filter((r) => r.clientId === filterClientId || r.clientId === null)
    : rules;

  return (
    <div className="space-y-6 pb-20">
      {/* Stealth Brand Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-border)] pb-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-950 text-sm font-bold text-white shadow-md ring-1 ring-emerald-500/40">
            T
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-[var(--color-foreground)]">
                Truepost · Command &amp; Control
              </h1>
              <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-[10px]">
                Restricted Private Portal
              </Badge>
            </div>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Master control plane for client telemetry, support sentinel, rule compilation, and token licensing.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadAll} className="gap-1.5 text-xs h-8">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh Telemetry
          </Button>
        </div>
      </div>

      {/* 64-Hex Master Token Gate */}
      <AdminTokenGate onTokenChanged={loadAll} />

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-1">
        <button
          onClick={() => setActiveTab("dashboard")}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
            activeTab === "dashboard"
              ? "bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          }`}
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          Command Dashboard
        </button>

        <button
          onClick={() => setActiveTab("support")}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
            activeTab === "support"
              ? "bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          }`}
        >
          <Headphones className="h-3.5 w-3.5" />
          Support Sentinel
          {metrics.openTickets > 0 ? (
            <span className="ml-1 rounded-full bg-[var(--color-primary)] px-1.5 py-0.2 text-[10px] text-[var(--color-primary-foreground)]">
              {metrics.openTickets}
            </span>
          ) : null}
        </button>

        <button
          onClick={() => setActiveTab("rule_requests")}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
            activeTab === "rule_requests"
              ? "bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Client Rule Requests
          {metrics.ruleRequests > 0 ? (
            <span className="ml-1 rounded-full bg-purple-500 px-1.5 py-0.2 text-[10px] text-white">
              {metrics.ruleRequests}
            </span>
          ) : null}
        </button>

        <button
          onClick={() => setActiveTab("rules")}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
            activeTab === "rules"
              ? "bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          }`}
        >
          <Brain className="h-3.5 w-3.5" />
          RuleForge Compiler
        </button>

        <button
          onClick={() => setActiveTab("tokens")}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
            activeTab === "tokens"
              ? "bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          }`}
        >
          <Key className="h-3.5 w-3.5" />
          Beta &amp; Licensing
        </button>

        <button
          onClick={() => setActiveTab("audit")}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
            activeTab === "audit"
              ? "bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          }`}
        >
          <History className="h-3.5 w-3.5" />
          Audit Vault
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: COMMAND DASHBOARD & LIVE TELEMETRY                                */}
      {/* ========================================================================= */}
      {activeTab === "dashboard" && (
        <div className="space-y-6">
          <BetaMetricsCard />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card className="border-[var(--color-border)] shadow-sm">
              <CardContent className="p-3.5">
                <div className="flex items-center justify-between text-xs text-[var(--color-muted-foreground)] mb-1">
                  <span>Organizations</span>
                  <Users className="h-3.5 w-3.5 text-blue-500" />
                </div>
                <div className="text-2xl font-bold tracking-tight">{metrics.users}</div>
                <div className="text-[10px] text-[var(--color-muted-foreground)] mt-0.5">{metrics.totalClients} client entities</div>
              </CardContent>
            </Card>

            <Card className="border-[var(--color-border)] shadow-sm">
              <CardContent className="p-3.5">
                <div className="flex items-center justify-between text-xs text-[var(--color-muted-foreground)] mb-1">
                  <span>Support Tickets</span>
                  <Headphones className="h-3.5 w-3.5 text-emerald-500" />
                </div>
                <div className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
                  {metrics.openTickets}
                </div>
                <div className="text-[10px] text-[var(--color-muted-foreground)] mt-0.5">{metrics.tickets} total received</div>
              </CardContent>
            </Card>

            <Card className="border-[var(--color-border)] shadow-sm">
              <CardContent className="p-3.5">
                <div className="flex items-center justify-between text-xs text-[var(--color-muted-foreground)] mb-1">
                  <span>Rule Directives</span>
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                </div>
                <div className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
                  {metrics.ruleRequests}
                </div>
                <div className="text-[10px] text-[var(--color-muted-foreground)] mt-0.5">Pending compilation</div>
              </CardContent>
            </Card>

            <Card className={metrics.deadLetterOperations ? "border-red-500/50 bg-red-500/5 shadow-sm" : "border-[var(--color-border)] shadow-sm"}>
              <CardContent className="p-3.5" aria-live="polite">
                <div className="flex items-center justify-between text-xs text-[var(--color-muted-foreground)] mb-1">
                  <span>Delivery failures</span>
                  <AlertTriangle className={metrics.deadLetterOperations ? "h-3.5 w-3.5 text-red-600" : "h-3.5 w-3.5 text-emerald-500"} aria-hidden="true" />
                </div>
                <div className={metrics.deadLetterOperations ? "text-2xl font-bold tracking-tight text-red-700 dark:text-red-300" : "text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400"}>
                  {metrics.deadLetterOperations}
                </div>
                <div className="text-[10px] text-[var(--color-muted-foreground)] mt-0.5">{metrics.deadLetterOperations ? "Open /api/admin/outbox to replay" : "No dead-lettered operations"}</div>
              </CardContent>
            </Card>

            <Card className="border-[var(--color-border)] shadow-sm">
              <CardContent className="p-3.5">
                <div className="flex items-center justify-between text-xs text-[var(--color-muted-foreground)] mb-1">
                  <span>Reconciled Lines</span>
                  <Receipt className="h-3.5 w-3.5 text-amber-500" />
                </div>
                <div className="text-2xl font-bold tracking-tight">{metrics.receipts}</div>
                <div className="text-[10px] text-[var(--color-muted-foreground)] mt-0.5">Processed entries</div>
              </CardContent>
            </Card>

            <Card className="border-[var(--color-border)] shadow-sm">
              <CardContent className="p-3.5">
                <div className="flex items-center justify-between text-xs text-[var(--color-muted-foreground)] mb-1">
                  <span>E-Sign Vault</span>
                  <FileCheck2 className="h-3.5 w-3.5 text-emerald-500" />
                </div>
                <div className="text-2xl font-bold tracking-tight">{metrics.esignDocs}</div>
                <div className="text-[10px] text-[var(--color-muted-foreground)] mt-0.5">SHA-256 sealed docs</div>
              </CardContent>
            </Card>

            <Card className="border-[var(--color-border)] shadow-sm">
              <CardContent className="p-3.5">
                <div className="flex items-center justify-between text-xs text-[var(--color-muted-foreground)] mb-1">
                  <span>Master Rules</span>
                  <Brain className="h-3.5 w-3.5 text-indigo-500" />
                </div>
                <div className="text-2xl font-bold tracking-tight">{metrics.activeRules}</div>
                <div className="text-[10px] text-[var(--color-muted-foreground)] mt-0.5">Deterministic rules active</div>
              </CardContent>
            </Card>
          </div>

          {/* AI Token Burn & Cost Guard */}
          <Card className="border-indigo-500/20 bg-indigo-500/5">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Flame className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                  <CardTitle className="text-base">Token Burn Telemetry &amp; Cost Guard</CardTitle>
                </div>
                <Badge className="bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:opacity-90 text-xs">
                  Deterministic Token Guard Active
                </Badge>
              </div>
              <CardDescription className="text-xs">
                Real-time protection preventing arbitrary user LLM sessions from consuming unmetered tokens.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-medium">
                  <span>Monthly LLM Token Consumption</span>
                  <span className="font-mono">
                    {metrics.tokenMetrics.estimatedTokensConsumed.toLocaleString()} / {metrics.tokenMetrics.budgetTokensMonthly.toLocaleString()} Tokens
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-[var(--color-muted)] overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{
                      width: `${Math.min(100, Math.max(1, (metrics.tokenMetrics.estimatedTokensConsumed / metrics.tokenMetrics.budgetTokensMonthly) * 100))}%`,
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-xs">
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                  <div className="text-[var(--color-muted-foreground)] mb-1">Token Guard Mode</div>
                  <div className="font-semibold text-emerald-700 dark:text-emerald-400">Strict Rule-Queue Tiering</div>
                  <p className="text-[11px] text-[var(--color-muted-foreground)] mt-1">
                    Voice transcription is reserved for admin/VIP. Clients submit structured directives.
                  </p>
                </div>

                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                  <div className="text-[var(--color-muted-foreground)] mb-1">Tokens Saved via Pre-Compilation</div>
                  <div className="font-semibold font-mono">~{metrics.tokenMetrics.tokensSavedViaRuleCache.toLocaleString()} Tokens</div>
                  <p className="text-[11px] text-[var(--color-muted-foreground)] mt-1">
                    Cached deterministic rulebooks prevent redundant per-transaction LLM calls.
                  </p>
                </div>

                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                  <div className="text-[var(--color-muted-foreground)] mb-1">Support Sentinel SLA</div>
                  <div className="font-semibold text-blue-600 dark:text-blue-400">Instant Automated Auto-Reply</div>
                  <p className="text-[11px] text-[var(--color-muted-foreground)] mt-1">
                    100% of customer support inquiries receive an immediate confirmation with tracking reference.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Autonomous Adaptive Intelligence Desk */}
          <Card className="border-[var(--color-border)] shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Brain className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <CardTitle className="text-base">Autonomous Adaptive Intelligence Desk</CardTitle>
                    <CardDescription className="text-xs">
                      Live practice heuristic engine detecting tax audit risks, commingling anomalies, and expense optimizations across client transactions.
                    </CardDescription>
                  </div>
                </div>
                <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20 text-xs">
                  Zero-Hallucination Heuristics
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Commingling Risk Shield */}
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4 text-rose-500" />
                      <span className="font-semibold text-xs text-[var(--color-foreground)]">Commingling &amp; Owner Draw Sentinel</span>
                    </div>
                    <Badge className="bg-rose-500/10 text-rose-700 dark:text-rose-400 text-[10px]">
                      Audit Risk Guard
                    </Badge>
                  </div>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Scans merchant streams for personal purchases (e.g. Costco, Trader Joe's, personal retail, streaming subscriptions) without documented business justification. Automatically classifies to Owner Draw / Non-Deductible to protect return defensibility.
                  </p>
                  <div className="pt-1 flex items-center justify-between">
                    <span className="text-[11px] font-mono text-[var(--color-muted-foreground)]">Status: Ready to enforce</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => deployPresetRule("Business vs. Personal Commingling Filter", "personal_vs_business", TEMPLATES.personal_filter)}
                      className="text-xs h-7 gap-1 border-rose-500/30 text-rose-700 dark:text-rose-400 hover:bg-rose-500/10"
                    >
                      <Upload className="h-3 w-3" />
                      Deploy Commingling Policy
                    </Button>
                  </div>
                </div>

                {/* Treasury Safe Harbor $2,500 */}
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Scale className="h-4 w-4 text-emerald-500" />
                      <span className="font-semibold text-xs text-[var(--color-foreground)]">Treasury Reg § 1.263(a)-1(f) De Minimis Safe Harbor</span>
                    </div>
                    <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px]">
                      IRC § 263(a)
                    </Badge>
                  </div>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Immediately expensed invoices under $2,500 under Supplies or Office Expenses without creating needless multi-year Form 4562 depreciation schedules. Flags assets ≥ $2,500 for Section 179 expensing review.
                  </p>
                  <div className="pt-1 flex items-center justify-between">
                    <span className="text-[11px] font-mono text-[var(--color-muted-foreground)]">Threshold: $2,500.00</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => deployPresetRule("De Minimis Safe Harbor ($2,500)", "tax_deduction", TEMPLATES.safe_harbor)}
                      className="text-xs h-7 gap-1 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                    >
                      <Upload className="h-3 w-3" />
                      Deploy Safe Harbor Policy
                    </Button>
                  </div>
                </div>

                {/* Meals 50% Limitation */}
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Scale className="h-4 w-4 text-amber-500" />
                      <span className="font-semibold text-xs text-[var(--color-foreground)]">IRC § 274(n) 50% Meals &amp; Dining Limitation</span>
                    </div>
                    <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px]">
                      IRC § 274(n)
                    </Badge>
                  </div>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Automatically segregates business dining (50% deductible on Schedule C Line 24b) from non-deductible entertainment (0% deductible). Protects against IRS examination disallowance on restaurant and cafe charges.
                  </p>
                  <div className="pt-1 flex items-center justify-between">
                    <span className="text-[11px] font-mono text-[var(--color-muted-foreground)]">Limitation: 50% Statutory</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => deployPresetRule("Meals & Entertainment 50% Limitation", "tax_deduction", TEMPLATES.meals_50)}
                      className="text-xs h-7 gap-1 border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                    >
                      <Upload className="h-3 w-3" />
                      Deploy 50% Meals Policy
                    </Button>
                  </div>
                </div>

                {/* 1099-NEC contractor threshold */}
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-purple-500" />
                      <span className="font-semibold text-xs text-[var(--color-foreground)]">IRC § 6041 1099-NEC Contractor Threshold</span>
                    </div>
                    <Badge className="bg-purple-500/10 text-purple-700 dark:text-purple-400 text-[10px]">
                      1099 Compliance
                    </Badge>
                  </div>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Flags payees whose yearly total reaches the 1099-NEC threshold: $600 for payments through 2025, $2,000 from 2026. Preparers record W-9 requests from each client's Tax Bridge tab; nothing is sent automatically.
                  </p>
                  <div className="pt-1">
                    <span className="text-[11px] font-mono text-[var(--color-muted-foreground)]">Filing Rule: Form 1099-NEC</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Legal Compliance & Practice Defense Desk */}
          <Card className="border-slate-800/10 bg-slate-950 text-slate-100 shadow-md">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-emerald-400" />
                  <CardTitle className="text-base text-white">Regulatory Compliance &amp; Legal Shield Desk</CardTitle>
                </div>
                <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px]">
                  Practitioner responsibilities
                </Badge>
              </div>
              <CardDescription className="text-xs text-slate-400">
                What Truepost does, and what remains the firm's professional responsibility.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-xs text-slate-300">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 space-y-1">
                  <div className="font-semibold text-white flex items-center gap-1.5">
                    <Scale className="h-3.5 w-3.5 text-emerald-400" />
                    Practitioner review required
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Truepost is a bookkeeping and evidence tool. Its AI-assisted extraction can be wrong. All categorization proposals, Schedule C line items, and tax workpapers are computational aids provided for licensed practitioner verification. Final tax determinations and filings remain under practitioner oversight.
                  </p>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 space-y-1">
                  <div className="font-semibold text-white flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-blue-400" />
                    Client data and outside processors (IRC § 7216)
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Records are stored in Neon Postgres and Cloudflare R2, both encrypted at rest by those providers, and served over HTTPS. Firms are separated by access checks on every request. Receipt images are sent to an AI service for extraction: Cloudflare Workers AI, and Google Gemini or Groq if their keys are set. Review each provider's data terms, and obtain any client consent § 7216 requires, before processing client tax information.
                  </p>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 space-y-1">
                  <div className="font-semibold text-white flex items-center gap-1.5">
                    <FileCheck2 className="h-3.5 w-3.5 text-purple-400" />
                    E-signature evidence
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Signed documents record SHA-256 hashes before and after signing, the signer's IP address and browser, and append-only audit timestamps. Form 8879/8878 signing is built to IRS Publication 1345 for pen signatures and in-office e-signatures; it has not been reviewed by the IRS or an attorney.
                  </p>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 space-y-1">
                  <div className="font-semibold text-white flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-amber-400" />
                    Native Desktop Runtime (Zero-Friction Windows Setup)
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Hardened native Windows desktop client (Tauri v2 / Rust, ~10MB). Microsoft Edge WebView2 runtime bootstrapper configured with silent auto-provisioning: if a practitioner or client machine is missing WebView2, the installer silently provisions it in the background with zero user friction.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: SUPPORT SENTINEL & LIVE TICKETS                                    */}
      {/* ========================================================================= */}
      {activeTab === "support" && (
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Headphones className="h-4 w-4 text-emerald-600" />
                    Live Support Sentinel Queue
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Every incoming inquiry is automatically acknowledged by email within seconds so clients never feel left waiting.
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={loadTickets} className="text-xs h-8 gap-1">
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh Tickets
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingTickets ? (
                <div className="py-8 text-center text-xs text-[var(--color-muted-foreground)]">Loading support queue…</div>
              ) : tickets.length === 0 ? (
                <div className="py-12 text-center text-xs text-[var(--color-muted-foreground)]">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500 mb-2 opacity-50" />
                  No open support tickets. All clients have been addressed.
                </div>
              ) : (
                <div className="space-y-3">
                  {tickets.map((t) => (
                    <div
                      key={t.id}
                      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 transition-all hover:border-[var(--color-foreground)]/20"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-[var(--color-foreground)]">#{t.id}</span>
                            <span className="text-xs font-semibold text-[var(--color-foreground)]">{t.subject}</span>
                            <Badge
                              className={`text-[10px] ${
                                t.status === "resolved"
                                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
                                  : "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20"
                              }`}
                            >
                              {t.status === "resolved" ? "Resolved" : "⚡ Sentinel Auto-Responded"}
                            </Badge>
                          </div>
                          <div className="text-xs text-[var(--color-muted-foreground)]">
                            From: <strong className="text-[var(--color-foreground)]">{t.user_name || "Practitioner"}</strong> ({t.user_email}) · Topic: {t.category || "General"} · {formatDateTime(t.created_at)}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-7"
                            onClick={() => setSelectedTicket(selectedTicket?.id === t.id ? null : t)}
                          >
                            {selectedTicket?.id === t.id ? "Hide Details" : "View & Reply"}
                          </Button>
                          {t.status !== "resolved" ? (
                            <Button
                              size="sm"
                              className="bg-[var(--color-primary)] hover:opacity-90 text-[var(--color-primary-foreground)] text-xs h-7"
                              onClick={() => handleUpdateTicketStatus(t.id, "resolved")}
                            >
                              Mark Resolved
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs h-7 text-[var(--color-muted-foreground)]"
                              onClick={() => handleUpdateTicketStatus(t.id, "auto_responded")}
                            >
                              Reopen
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Expandable Conversation Thread */}
                      {selectedTicket?.id === t.id && (
                        <div className="mt-4 pt-4 border-t border-[var(--color-border)] space-y-4">
                          <div className="rounded-lg bg-[var(--color-muted)] p-3 text-xs">
                            <div className="font-semibold mb-1 text-[var(--color-foreground)]">Original Message from Client:</div>
                            <div className="whitespace-pre-wrap text-[var(--color-muted-foreground)]">{formatLegibleMessage(t.message)}</div>
                          </div>

                          {t.ai_response && (
                            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs">
                              <div className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300 mb-1">
                                <Zap className="h-3.5 w-3.5 text-emerald-600" />
                                Instant Sentinel Response Sent to Client ({formatTime(t.auto_responded_at || t.created_at)}):
                              </div>
                              <div className="whitespace-pre-wrap text-[var(--color-muted-foreground)] text-xs leading-relaxed">{formatLegibleMessage(t.ai_response)}</div>
                            </div>
                          )}

                          {/* Direct Manual Reply Box */}
                          <div className="space-y-2 pt-2">
                            <label className="text-xs font-semibold text-[var(--color-foreground)]">
                              Send Direct Follow-Up Email to {t.user_email}:
                            </label>
                            <textarea
                              rows={3}
                              value={replyMessage}
                              onChange={(e) => setReplyMessage(e.target.value)}
                              placeholder="Type your response here. This will be emailed directly to the client under the Truepost brand..."
                              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-2.5 text-xs text-[var(--color-foreground)]"
                            />
                            <div className="flex items-center justify-between">
                              {replySuccess ? (
                                <span className="text-xs font-semibold text-emerald-600">{replySuccess}</span>
                              ) : <span />}
                              <Button
                                size="sm"
                                disabled={sendingReply || !replyMessage.trim()}
                                onClick={() => handleSendReply(t.id)}
                                className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 gap-1.5"
                              >
                                <Send className="h-3.5 w-3.5" />
                                {sendingReply ? "Sending Email…" : "Send Email Reply"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: CLIENT RULE REQUESTS QUEUE                                         */}
      {/* ========================================================================= */}
      {activeTab === "rule_requests" && (
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-purple-600" />
                    Incoming Client Rule Directives
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Review rules requested by clients. You have final truth authority: compile them with RuleForge and push them directly to that client.
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={loadRuleRequests} className="text-xs h-8 gap-1">
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh Requests
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingRequests ? (
                <div className="py-8 text-center text-xs text-[var(--color-muted-foreground)]">Loading rule requests…</div>
              ) : ruleRequests.length === 0 ? (
                <div className="py-12 text-center text-xs text-[var(--color-muted-foreground)]">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-purple-500 mb-2 opacity-50" />
                  No pending client rule requests. All custom directives are up to date.
                </div>
              ) : (
                <div className="space-y-3">
                  {ruleRequests.map((req) => (
                    <div
                      key={req.id}
                      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-wrap items-start justify-between gap-3"
                    >
                      <div className="space-y-1 max-w-2xl">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold">#{req.id}</span>
                          <span className="text-xs font-semibold text-[var(--color-foreground)]">
                            Target: {req.client_name || "Firm-Wide"}
                          </span>
                          <Badge className="text-[10px] bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20">
                            {req.status === "pushed" ? "Deployed Live" : "Pending Review"}
                          </Badge>
                        </div>
                        <div className="text-xs italic text-[var(--color-foreground)] bg-[var(--color-muted)] p-2.5 rounded-md my-1">
                          "{req.directive_text}"
                        </div>
                        <div className="text-[11px] text-[var(--color-muted-foreground)]">
                          Requested by: {req.requested_by} ({req.user_email}) · {formatDateTime(req.created_at)}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleCompileClientRule(req)}
                          className="bg-purple-700 hover:bg-purple-800 text-white text-xs h-8 gap-1.5 shadow-sm"
                        >
                          <Brain className="h-3.5 w-3.5" />
                          Compile with RuleForge
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: RULEFORGE MASTER COMPILER                                          */}
      {/* ========================================================================= */}
      {activeTab === "rules" && (
        <div className="space-y-6">
          {/* Quick-Inject Standard IRS Templates */}
          <Card className="border-[var(--color-border)] bg-[var(--color-card)]">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    IRS Compliance Rulebook Starter Templates
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Inject pre-vetted compliance guidelines directly into the RuleForge compiler.
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setVoiceModalOpen(true)}
                  className="gap-1.5 text-xs h-8 border-purple-300 text-purple-700 dark:border-purple-800 dark:text-purple-400"
                >
                  <Mic className="h-3.5 w-3.5" /> Launch Voice Rule Dictation
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start text-xs h-9 border-[var(--color-border)]"
                  onClick={() => {
                    setRuleTitle("IRS Schedule C Expense Bucketing");
                    setRuleType("categorization");
                    setRuleContent(TEMPLATES.schedule_c);
                  }}
                >
                  Schedule C Expense Lines
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start text-xs h-9 border-[var(--color-border)]"
                  onClick={() => {
                    setRuleTitle("Meals & Entertainment 50% Limitation");
                    setRuleType("tax_deduction");
                    setRuleContent(TEMPLATES.meals_50);
                  }}
                >
                  50% Meals &amp; Entertainment
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start text-xs h-9 border-[var(--color-border)]"
                  onClick={() => {
                    setRuleTitle("De Minimis Safe Harbor ($2,500)");
                    setRuleType("tax_deduction");
                    setRuleContent(TEMPLATES.safe_harbor);
                  }}
                >
                  De Minimis Expensing Safe Harbor
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start text-xs h-9 border-[var(--color-border)]"
                  onClick={() => {
                    setRuleTitle("Business vs. Personal Commingling Filter");
                    setRuleType("personal_vs_business");
                    setRuleContent(TEMPLATES.personal_filter);
                  }}
                >
                  Personal Commingling Filter
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Rule Creator & Editor */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileCode className="h-4 w-4 text-emerald-600" />
                RuleForge Compiler &amp; Editor
              </CardTitle>
              <CardDescription className="text-xs">
                Write deterministic markdown guidelines. The pipeline cites these rules when explaining categorization decisions.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--color-foreground)]">Rule Title</label>
                  <Input
                    placeholder="e.g. Acme Tech Travel Policy"
                    value={ruleTitle}
                    onChange={(e) => setRuleTitle(e.target.value)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--color-foreground)]">Classification Category</label>
                  <select
                    value={ruleType}
                    onChange={(e) => setRuleType(e.target.value as any)}
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-xs"
                  >
                    <option value="categorization">Vendor / Merchant Categorization</option>
                    <option value="personal_vs_business">Personal vs Business Filter</option>
                    <option value="tax_deduction">Tax Safe Harbor / Deductions</option>
                    <option value="general">General Firm Policy</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--color-foreground)]">Target Client Scope</label>
                  <select
                    value={ruleClientId}
                    onChange={(e) => setRuleClientId(e.target.value)}
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-xs"
                  >
                    <option value="">Global (All Clients in Firm)</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        Only {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--color-foreground)]">Markdown Directive Content</label>
                <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-muted)]/40 px-3 py-2">
                  <label htmlFor="rulebook-upload" className="cursor-pointer text-xs font-medium text-[var(--color-primary)] hover:underline">
                    Load a Markdown rulebook
                  </label>
                  <span className="text-xs text-[var(--color-muted-foreground)]">.md only · reviewed before deployment · 512 KB max</span>
                  <input
                    id="rulebook-upload"
                    type="file"
                    accept=".md,text/markdown,text/plain"
                    className="sr-only"
                    onChange={(event) => {
                      void handleRulebookFile(event.target.files?.[0] ?? null);
                      event.currentTarget.value = "";
                    }}
                  />
                </div>
                <textarea
                  rows={8}
                  placeholder="Type or paste markdown compliance rules..."
                  value={ruleContent}
                  onChange={(e) => setRuleContent(e.target.value)}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3 font-mono text-xs"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                {ruleSuccessMsg ? (
                  <span className="text-xs font-semibold text-emerald-600">{ruleSuccessMsg}</span>
                ) : <span />}
                <Button
                  size="sm"
                  onClick={handleSaveRule}
                  disabled={savingRule || !ruleTitle.trim() || !ruleContent.trim()}
                  className="bg-[var(--color-primary)] hover:opacity-90 text-[var(--color-primary-foreground)] text-xs h-9 gap-1.5"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {savingRule ? "Deploying..." : "Approve & Deploy Rule"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Active Rules List with Client Filter & Retroactive Recalculation */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    Active Rulebooks ({filteredRules.length})
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Deterministic compliance policies currently governing this firm.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Filter className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
                  <select
                    value={filterClientId}
                    onChange={(e) => setFilterClientId(e.target.value)}
                    className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1 text-xs"
                  >
                    <option value="">All Scopes (Global + Clients)</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} Only
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {retroactiveStatusMsg && (
                <div className="mb-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-xs text-emerald-800 dark:text-emerald-300">
                  {retroactiveStatusMsg}
                </div>
              )}

              {loadingRules ? (
                <div className="py-8 text-center text-xs text-[var(--color-muted-foreground)]">Loading active rules…</div>
              ) : filteredRules.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--color-muted-foreground)]">
                  No active rulebooks found. Choose a starter template above to inject your first rulebook.
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredRules.map((rule) => (
                    <div
                      key={rule.id}
                      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-wrap items-start justify-between gap-3"
                    >
                      <div className="space-y-1 max-w-xl">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-[var(--color-foreground)]">{rule.title}</span>
                          <Badge className="text-[10px]">
                            {rule.ruleType}
                          </Badge>
                          {rule.clientId ? (
                            <Badge className="text-[10px] bg-blue-500/10 text-blue-700 dark:text-blue-300">
                              Client: {clients.find((c) => c.id === rule.clientId)?.name || rule.clientId}
                            </Badge>
                          ) : (
                            <Badge className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                              Global (Firm-Wide)
                            </Badge>
                          )}
                        </div>
                        <div className="font-mono text-[11px] text-[var(--color-muted-foreground)] line-clamp-2">
                          {rule.markdownContent}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={retroactiveApplyingId === rule.id}
                          onClick={() => handleApplyRetroactive(rule)}
                          className="text-xs h-8 gap-1 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                        >
                          <Play className="h-3 w-3" />
                          {retroactiveApplyingId === rule.id ? "Recalculating..." : "Apply Retroactively"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleRule(rule)}
                          className="text-xs h-8"
                        >
                          {rule.isActive ? "Deactivate" : "Activate"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteRule(rule.id)}
                          className="text-rose-600 h-8 w-8"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Interactive Testing Simulator */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-500" />
                Live Rule Testing Simulator
              </CardTitle>
              <CardDescription className="text-xs">
                Run simulated transactions through your active rulebooks to verify deduction and classification logic before live deployment.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Merchant</label>
                  <Input
                    placeholder="e.g. Shell, Home Depot, Starbucks"
                    value={simMerchant}
                    onChange={(e) => setSimMerchant(e.target.value)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Description</label>
                  <Input
                    placeholder="e.g. Gas fuel, client meeting lunch"
                    value={simDescription}
                    onChange={(e) => setSimDescription(e.target.value)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Amount ($)</label>
                  <Input
                    type="number"
                    value={simAmount}
                    onChange={(e) => setSimAmount(Number(e.target.value))}
                    className="text-xs"
                  />
                </div>
              </div>

              <Button
                size="sm"
                onClick={handleTestPurchase}
                disabled={simLoading || !simMerchant.trim()}
                className="bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs h-8 gap-1.5"
              >
                <Play className="h-3.5 w-3.5" />
                {simLoading ? "Simulating..." : "Run Test Simulation"}
              </Button>

              {simResult && (
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)] p-4 space-y-2 text-xs">
                  <div className="flex items-center gap-2 font-semibold">
                    <span>Matched Category:</span>
                    <Badge className="bg-[var(--color-primary)] text-[var(--color-primary-foreground)]">{simResult.matchedCategory}</Badge>
                    <span className="text-[var(--color-muted-foreground)]">({simResult.taxBucket})</span>
                  </div>
                  <div>
                    <strong>Deductible:</strong> {simResult.deductible ? "Yes (Business)" : "No (Personal / Disallowed)"}
                  </div>
                  <div>
                    <strong>Reasoning:</strong> {simResult.reasoning}
                  </div>
                  {simResult.ruleCited && (
                    <div className="font-mono text-[11px] text-purple-700 dark:text-purple-300">
                      <strong>Cited Rule:</strong> {simResult.ruleCited}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: BETA & FIRM LICENSING SUITE                                        */}
      {/* ========================================================================= */}
      {activeTab === "tokens" && (
        <div className="space-y-6">
          {licensingMsg && (
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
              <span>{licensingMsg}</span>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setLicensingMsg(null)}>
                Dismiss
              </Button>
            </div>
          )}

          {/* Invitation Key Generator */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Key className="h-4 w-4 text-emerald-600" />
                Single-Use Cryptographic Invitation Generator
              </CardTitle>
              <CardDescription className="text-xs">
                Issue single-use, non-transferable invitations with customized license duration for new practitioners or beta firms.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--color-foreground)]">
                    Prospective Practitioner / Firm Email
                  </label>
                  <Input
                    type="email"
                    placeholder="e.g. phyllis@truepost-accounting.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--color-foreground)]">
                    License Evaluation Duration
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: "30 Days", days: 30 },
                      { label: "60 Days", days: 60 },
                      { label: "90 Days", days: 90 },
                      { label: "1 Full Year", days: 365 },
                      { label: "Lifetime Access", days: 9999 },
                    ].map((opt) => (
                      <button
                        key={opt.days}
                        type="button"
                        onClick={() => setInviteDays(opt.days)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                          inviteDays === opt.days
                            ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                            : "border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button
                  onClick={handleCreateInvitation}
                  disabled={generatingInvite || !inviteEmail.trim()}
                  size="sm"
                  className="bg-[var(--color-primary)] hover:opacity-90 text-[var(--color-primary-foreground)] text-xs h-8 gap-1.5"
                >
                  <Key className="h-3.5 w-3.5" />
                  {generatingInvite ? "Generating Token..." : "Issue Cryptographic Invitation Link"}
                </Button>
              </div>

              {generatedInviteLink && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                    <span>Generated Invitation Link (Valid for {inviteDays === 9999 ? "Lifetime" : `${inviteDays} days`}):</span>
                    <Badge className="bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-[10px]">Single-Use Only</Badge>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-2.5 text-xs font-mono">
                    <span className="truncate max-w-xl text-[11px]">{generatedInviteLink}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => {
                        navigator.clipboard.writeText(generatedInviteLink);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                    >
                      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  <p className="text-[11px] text-[var(--color-muted-foreground)]">
                    Send this link directly to the practitioner. Upon clicking, their email is verified and their account is automatically provisioned with an active firm license.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Active Firm Entitlements & License Extension Desk */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    Active Firm Licenses &amp; Entitlements ({entitlements.length})
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Manage practitioner licensing durations. Extend active accounts with 1-click so firm operations never experience service interruption.
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={loadLicensingData} className="text-xs h-7 gap-1">
                  <RefreshCw className="h-3 w-3" /> Refresh Licenses
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingLicensing ? (
                <div className="py-8 text-center text-xs text-[var(--color-muted-foreground)]">Loading active firm licenses…</div>
              ) : entitlements.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--color-muted-foreground)]">
                  No active entitlements found. Generate an invitation link above to onboard your first firm.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted-foreground)]">
                        <th className="pb-2 font-medium">Practitioner / Firm</th>
                        <th className="pb-2 font-medium">Status</th>
                        <th className="pb-2 font-medium">Valid From</th>
                        <th className="pb-2 font-medium">Expires At</th>
                        <th className="pb-2 font-medium text-right">License Extension Controls</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {entitlements.map((ent) => {
                        const isExpired = new Date(ent.expires_at).getTime() < Date.now();
                        const daysRemaining = Math.max(0, Math.ceil((new Date(ent.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                        return (
                          <tr key={ent.user_id} className="hover:bg-[var(--color-muted)]/50">
                            <td className="py-3">
                              <div className="font-semibold text-[var(--color-foreground)]">{ent.name || "Practitioner"}</div>
                              <div className="font-mono text-[11px] text-[var(--color-muted-foreground)]">{ent.email || ent.user_id}</div>
                            </td>
                            <td className="py-3">
                              {ent.status === "active" && !isExpired ? (
                                <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10px]">
                                  Active ({daysRemaining}d left)
                                </Badge>
                              ) : ent.status === "revoked" ? (
                                <Badge className="bg-slate-500/10 text-slate-700 dark:text-slate-300 text-[10px]">
                                  Revoked
                                </Badge>
                              ) : (
                                <Badge className="bg-rose-500/10 text-rose-700 dark:text-rose-300 text-[10px]">
                                  Expired
                                </Badge>
                              )}
                            </td>
                            <td className="py-3 font-mono text-[11px] text-[var(--color-muted-foreground)]">
                              {formatDate(ent.starts_at)}
                            </td>
                            <td className="py-3 font-mono text-[11px] text-[var(--color-muted-foreground)]">
                              {formatDate(ent.expires_at)}
                            </td>
                            <td className="py-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleExtendEntitlement(ent.user_id, 30)}
                                  className="h-7 text-[10px] px-2 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                                >
                                  +30d
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleExtendEntitlement(ent.user_id, 90)}
                                  className="h-7 text-[10px] px-2 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                                >
                                  +90d
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleExtendEntitlement(ent.user_id, 365)}
                                  className="h-7 text-[10px] px-2 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                                >
                                  +1 Year
                                </Button>
                                {ent.status === "active" && !isExpired ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleRevokeEntitlement(ent.user_id)}
                                    className="h-7 text-[10px] px-2 text-rose-600 hover:bg-rose-500/10"
                                  >
                                    Revoke
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleReactivateEntitlement(ent.user_id, 90)}
                                    className="h-7 text-[10px] px-2 text-blue-600 border-blue-500/30 hover:bg-blue-500/10"
                                  >
                                    Reactivate
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pending Invitations Table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-500" />
                Pending Cryptographic Invitations ({invitations.filter((i) => i.status === "pending").length})
              </CardTitle>
              <CardDescription className="text-xs">
                Tokens issued to firms that have not yet been redeemed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {invitations.length === 0 ? (
                <div className="py-6 text-center text-xs text-[var(--color-muted-foreground)]">
                  No invitations recorded.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted-foreground)]">
                        <th className="pb-2 font-medium">Invited Email</th>
                        <th className="pb-2 font-medium">Duration</th>
                        <th className="pb-2 font-medium">Status</th>
                        <th className="pb-2 font-medium">Issued At</th>
                        <th className="pb-2 font-medium">Redemption Window</th>
                        <th className="pb-2 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {invitations.map((inv) => (
                        <tr key={inv.id} className="hover:bg-[var(--color-muted)]/50">
                          <td className="py-2.5 font-mono text-[11px] font-semibold">{inv.email}</td>
                          <td className="py-2.5">{inv.beta_days} days</td>
                          <td className="py-2.5">
                            <Badge
                              className={`text-[10px] ${
                                inv.status === "pending"
                                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                  : inv.status === "redeemed"
                                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                  : "bg-slate-500/10 text-slate-700 dark:text-slate-300"
                              }`}
                            >
                              {inv.status}
                            </Badge>
                          </td>
                          <td className="py-2.5 font-mono text-[11px] text-[var(--color-muted-foreground)]">
                            {formatDate(inv.issued_at)}
                          </td>
                          <td className="py-2.5 font-mono text-[11px] text-[var(--color-muted-foreground)]">
                            Expires {formatDate(inv.expires_at)}
                          </td>
                          <td className="py-2.5 text-right">
                            {inv.status === "pending" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleRevokeInvitation(inv.id)}
                                className="h-6 text-[10px] text-rose-600 hover:bg-rose-500/10"
                              >
                                Revoke
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 6: IMMUTABLE AUDIT VAULT & CHAIN OF CUSTODY                           */}
      {/* ========================================================================= */}
      {activeTab === "audit" && (
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <History className="h-4 w-4 text-emerald-600" />
                    Immutable Access &amp; Compliance Audit Vault
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Cryptographic audit trail of all administrative actions, token redemptions, and license modifications.
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={loadLicensingData} className="text-xs h-7 gap-1">
                  <RefreshCw className="h-3 w-3" /> Refresh Audit Trail
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {auditEvents.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--color-muted-foreground)]">
                  No security audit events recorded.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted-foreground)]">
                        <th className="pb-2 font-medium">Timestamp</th>
                        <th className="pb-2 font-medium">Action</th>
                        <th className="pb-2 font-medium">Actor</th>
                        <th className="pb-2 font-medium">Affected Party</th>
                        <th className="pb-2 font-medium">Reason / Context</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {auditEvents.map((ev) => (
                        <tr key={ev.id} className="hover:bg-[var(--color-muted)]/50">
                          <td className="py-2.5 font-mono text-[11px] text-[var(--color-muted-foreground)] whitespace-nowrap">
                            {formatDateTime(ev.created_at)}
                          </td>
                          <td className="py-2.5">
                            <Badge className="bg-slate-500/10 text-[var(--color-foreground)] font-mono text-[10px]">
                              {ev.action}
                            </Badge>
                          </td>
                          <td className="py-2.5 font-mono text-[11px] text-[var(--color-muted-foreground)]">
                            {ev.actor_user_id || "System / Master"}
                          </td>
                          <td className="py-2.5 font-mono text-[11px]">
                            {ev.affected_email || ev.affected_user_id || "—"}
                          </td>
                          <td className="py-2.5 text-[var(--color-muted-foreground)] text-[11px] max-w-sm truncate">
                            {formatLegibleMessage(ev.reason || ev.after_json || "Verified")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
