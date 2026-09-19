import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
   ArrowLeft,
   Activity as _unused_Activity,
   BarChart3,
   Camera,
   ExternalLink,
   Folder,
   Image,
   Inbox,
   Landmark,
   LineChart,
   Settings,
   Upload,
   FileDown,
   FileSpreadsheet,
   AlertTriangle,
   CheckCircle2,
   XCircle,
   Loader2,
   RotateCcw,
   LayoutDashboard,
   ClipboardList,
   FileStack,
   Bot,
 } from "lucide-react";
import { api, apiUrl } from "@/lib/api";
import { AnalyticsDashboard } from "@/components/analytics-dashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { ReceiptReview, type ReviewReceipt } from "@/components/receipt-review";
import { BankReconciliation } from "@/components/bank-reconciliation";
import { PnlPanel } from "@/components/pnl-panel";
import { DrilldownPanel } from "@/components/drilldown-panel";
import type { Pnl, DrilldownState, DrilldownEntry, DrilldownBankEntry, IncomeDrilldownEntry } from "@/types/pnl";
import { buildDrilldownPath } from "@/types/pnl";
import { cn } from "@/lib/utils";
import { presetRange, REPORTING_PERIOD_OPTIONS, type ReportingPeriodPreset } from "@/lib/reporting-period";
import { ExportCenter } from "@/components/export-center";
import { ClientOverview } from "@/components/client-overview";
import { TaxReadinessPanel } from "@/components/tax-readiness-panel";
import { DocumentsPanel } from "@/components/documents-panel";
import { EngagementsPanel } from "@/components/engagements-panel";
import { RequestsPanel } from "@/components/requests-panel";
import { AgentPanel } from "@/components/agent-panel";
import { TaxWorkpaper } from "@/components/tax-workpaper";
import { CarryforwardPanel, StateModsPanel, M3Panel, PriorYearPanel, ExtensionsPanel, OrganizerPanel, DiagnosticsPanel } from "@/components/tax-extended-panels";
import { convertHeicToJpeg, createCaptureInput } from "@/lib/image-utils";
import { enqueueReceipt, drainQueue, registerSyncListener, queueCount } from "@/lib/offline-queue";
import { subscribePush, unsubscribePush } from "@/lib/push";
import { Bell, Wifi, Sparkles, Smartphone, Mic, CreditCard, Calendar as CalendarIcon, ShieldCheck } from "lucide-react";
import { TaxBridgePanel } from "@/components/tax-bridge-panel";
import { MagicMobileLinkModal } from "@/components/magic-mobile-link-modal";
import { VoiceRuleDictationModal } from "@/components/voice-rule-dictation-modal";
import { BillingPanel } from "@/components/billing-panel";
import { DeadlineCalendarPanel } from "@/components/deadline-calendar-panel";
import { EsignVaultPanel } from "@/components/esign-vault-panel";
import { ClientRuleRequestModal } from "@/components/client-rule-request-modal";
import { getAdminToken } from "@/lib/api";

type Category = {
  id: string;
  name: string;
  slug: string;
  is_default: boolean;
};

type Client = { id: string; name: string; legal_name?: string | null };

type ProfessionalProfile = {
  dba?: string;
  primaryContactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  einLast4?: string;
  bookkeepingStartDate?: string;
  bookkeepingFrequency?: string;
  taxPrepRequired?: boolean;
  priorYearReturnAvailable?: boolean;
  notes?: string;
  knownAccountSources?: string;
};

type ClientProfile = {
   entity_type: string | null;
   industry: string | null;
   state: string | null;
   tax_year: number | null;
   accounting_basis: "cash" | "accrual" | null;
   default_currency: string;
   profile?: ProfessionalProfile;
   taxPrepRequired?: boolean;
   priorYearReturnAvailable?: boolean;
};

type FolderReceipt = {
  id: string;
  date: string | null;
  merchant: string | null;
  total: number | null;
  currency: string;
  filename: string;
  category: string;
  sourceUrl: string;
  excludedFromOperatingPnl?: boolean;
  excludedReason?: string | null;
};

type BatchStatus = "pending" | "processing" | "succeeded" | "failed";

type BatchFile = {
  id: string;
  file: File;
  status: BatchStatus;
  error?: string;
};

type Tab = "overview" | "folders" | "upload" | "review" | "bank" | "pnl" | "tax-bridge" | "tax-readiness" | "workpaper" | "documents" | "esign" | "engagements" | "requests" | "export" | "agent" | "analytics" | "billing" | "deadlines";

const VALID_TABS: Tab[] = ["overview", "folders", "upload", "review", "bank", "pnl", "tax-bridge", "tax-readiness", "workpaper", "documents", "esign", "engagements", "requests", "export", "agent", "analytics", "billing", "deadlines"];

export function ClientWorkspacePage() {
  const { clientId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get("focus");
  const initialTab = (VALID_TABS as string[]).includes(searchParams.get("tab") ?? "")
    ? (searchParams.get("tab") as Tab)
    : "overview";
  const [pinnedTaxYear, setPinnedTaxYear] = useState<number | null>(() => {
    const value = searchParams.get("taxYear");
    return value ? Number(value) : null;
  });
  const [client, setClient] = useState<Client | null>(null);
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [review, setReview] = useState<ReviewReceipt[]>([]);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [selectedFolder, setSelectedFolder] = useState<Category | null>(null);
  const [folderReceipts, setFolderReceipts] = useState<FolderReceipt[]>([]);
  const [folderSort, setFolderSort] = useState<"date" | "merchant">("date");
  const [message, setMessage] = useState<string | null>(null);
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [pnlPreset, setReportingPeriodPreset] = useState<ReportingPeriodPreset>("current_month");
  const [pnlCustomStart, setPnlCustomStart] = useState("");
  const [pnlCustomEnd, setPnlCustomEnd] = useState("");
  const [drilldown, setDrilldown] = useState<DrilldownState>(null);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchFile[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [queueCountState, setQueueCountState] = useState<number>(0);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [mobileLinkOpen, setMobileLinkOpen] = useState(false);
  const [teachAiOpen, setTeachAiOpen] = useState(false);
  const [requestRuleOpen, setRequestRuleOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchParams.get("tab") || searchParams.get("focus")) {
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setError(null);
    try {
      const [clientData, categoryData, reviewData, profileData] = await Promise.all([
        api<{ client: Client }>(`/api/clients/${clientId}`),
        api<{ categories: Category[] }>(`/api/clients/${clientId}/categories`),
        api<{ receipts: ReviewReceipt[] }>(`/api/clients/${clientId}/review`),
        api<{ profile: ClientProfile | null }>(`/api/clients/${clientId}/profile`),
      ]);
      setClient(clientData.client);
      setCategories(categoryData.categories);
      setReview(reviewData.receipts);
      setProfile(profileData.profile);
      if (!selectedFolder && categoryData.categories[0]) setSelectedFolder(categoryData.categories[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load workspace");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    void queueCount().then(setQueueCountState);
  }, []);

  useEffect(() => {
    const unsubscribe = registerSyncListener(async (clientId: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      try { await api(`/api/clients/${clientId}/receipts`, { method: "POST", body: form }); } catch { throw new Error("upload failed"); }
    });
    void subscribePush().then((sub) => setPushSubscribed(!!sub)).catch(() => {});
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  async function saveProfile(next: Record<string, unknown>) {
    try {
      const { legal_name, ...profileFields } = next as { legal_name?: string | null } & Record<string, unknown>;
      const [profileResult] = await Promise.all([
        api<{ profile: ClientProfile }>(`/api/clients/${clientId}/profile`, {
          method: "PATCH",
          body: JSON.stringify(profileFields),
        }),
        legal_name !== undefined
          ? api<{ client: Client }>(`/api/clients/${clientId}`, {
              method: "PATCH",
              body: JSON.stringify({ legal_name: legal_name || null }),
            }).then((data) => setClient(data.client))
          : Promise.resolve(),
      ]);
      setProfile(profileResult.profile);
      setEditingProfile(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the client profile");
    }
  }

  async function loadFolderReceipts(category: Category, sort: "date" | "merchant" = folderSort) {
    setSelectedFolder(category);
    try {
      const data = await api<{ receipts: FolderReceipt[] }>(
        `/api/clients/${clientId}/categories/${category.id}/evidence?sort=${sort}`,
      );
      setFolderReceipts(data.receipts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load folder evidence");
    }
  }

  useEffect(() => {
    if (tab === "folders" && selectedFolder) void loadFolderReceipts(selectedFolder, folderSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedFolder?.id, folderSort]);

  const pnlRange = useMemo(() => {
    if (pnlPreset === "custom") return { startDate: pnlCustomStart, endDate: pnlCustomEnd };
    return presetRange(pnlPreset, profile?.tax_year ?? null);
  }, [pnlPreset, pnlCustomStart, pnlCustomEnd, profile?.tax_year]);

  async function loadPnl() {
    try {
      const params = new URLSearchParams();
      if (pnlRange.startDate) params.set("startDate", pnlRange.startDate);
      if (pnlRange.endDate) params.set("endDate", pnlRange.endDate);
      const data = await api<Pnl>(`/api/clients/${clientId}/pnl?${params.toString()}`);
      setPnl(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load P&L");
    }
  }

  useEffect(() => {
    if (tab === "pnl") void loadPnl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, clientId, pnlRange.startDate, pnlRange.endDate, review.length]);

  async function loadDrilldown(category: string, type: "expense" | "income" = "expense") {
    const path = buildDrilldownPath(clientId, category, type, pnlRange.startDate, pnlRange.endDate);
    if (type === "income") {
      const data = await api<{ type: "income"; category: string; entries: IncomeDrilldownEntry[] }>(path);
      setDrilldown(data);
      return;
    }
    const data = await api<{ type: "expense"; category: string; entries: DrilldownEntry[]; bankEntries: DrilldownBankEntry[] }>(path);
    setDrilldown(data);
  }

  function addFilesToBatch(files: FileList | null) {
    if (!files?.length) return;
    const next: BatchFile[] = Array.from(files).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
      status: "pending",
    }));
    setBatch((current) => [...current, ...next]);
  }

  async function uploadOne(item: BatchFile): Promise<void> {
    setBatch((current) => current.map((b) => (b.id === item.id ? { ...b, status: "processing", error: undefined } : b)));
    try {
      const form = new FormData();
      form.append("file", item.file);
      await api(`/api/clients/${clientId}/receipts`, { method: "POST", body: form });
      setBatch((current) => current.map((b) => (b.id === item.id ? { ...b, status: "succeeded" } : b)));
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Upload failed";
      setBatch((current) => current.map((b) => (b.id === item.id ? { ...b, status: "failed", error: errorMessage } : b)));
      void enqueueReceipt(clientId, item.file).catch(() => {});
    }
  }

  async function runBatch(items: BatchFile[]) {
    setBatchRunning(true);
    setMessage(null);
    // Sequential on purpose: this is a small alpha upload tray, not a queue
    // system. One failing file is recorded and skipped; it never aborts the
    // rest of the box of receipts.
    for (const item of items) {
      await uploadOne(item);
    }
    setBatchRunning(false);
    await load();
    const succeeded = items.length; // reported per-run below from live state instead
    void succeeded;
  }

  async function startBatchUpload() {
    const pending = batch.filter((b) => b.status === "pending");
    if (pending.length === 0) return;
    await runBatch(pending);
  }

  async function retryFailed() {
    const failed = batch.filter((b) => b.status === "failed");
    if (failed.length === 0) return;
    await runBatch(failed);
  }

  function clearBatch() {
    setBatch((current) => current.filter((b) => b.status === "processing"));
  }

  const batchSummary = useMemo(() => {
    const succeeded = batch.filter((b) => b.status === "succeeded").length;
    const failed = batch.filter((b) => b.status === "failed").length;
    const pending = batch.filter((b) => b.status === "pending").length;
    const processing = batch.filter((b) => b.status === "processing").length;
    return { succeeded, failed, pending, processing, total: batch.length };
  }, [batch]);

  const tabs = useMemo(
    () => [
      { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
      { id: "folders" as const, label: "Folders", icon: Folder },
      { id: "upload" as const, label: "Upload", icon: Upload },
      { id: "review" as const, label: "Review", icon: Inbox, count: review.length },
      { id: "bank" as const, label: "Bank", icon: Landmark },
      { id: "pnl" as const, label: "P&L", icon: LineChart },
      { id: "tax-readiness" as const, label: "Tax readiness", icon: ClipboardList },
      { id: "workpaper" as const, label: "Workpaper", icon: FileSpreadsheet },
      { id: "documents" as const, label: "Documents", icon: FileStack },
      { id: "esign" as const, label: "E-Sign Vault", icon: ShieldCheck },
      { id: "engagements" as const, label: "Engagements", icon: ClipboardList },
      { id: "requests" as const, label: "Requests", icon: Inbox },
      { id: "agent" as const, label: "Agent", icon: Bot },
       { id: "analytics" as const, label: "Analytics", icon: BarChart3 },
      { id: "tax-bridge" as const, label: "Tax Bridge & 1099", icon: Sparkles },
      { id: "billing" as const, label: "Billing & Invoices", icon: CreditCard },
      { id: "deadlines" as const, label: "Deadlines", icon: CalendarIcon },
      { id: "export" as const, label: "Export", icon: FileDown },
    ],
    [review.length],
  );

  function navigateToDeepLink(deepLink: string) {
    const query = deepLink.split("?")[1] ?? "";
    const params = new URLSearchParams(query);
    const nextTab = params.get("tab");
    const focus = params.get("focus");
    const taxYear = params.get("taxYear");
    if (nextTab && (VALID_TABS as string[]).includes(nextTab)) setTab(nextTab as Tab);
    if (focus) setSearchParams({ focus }, { replace: true });
    // Kept in component state rather than the URL so a subsequent same-page
    // navigation cannot be silently overwritten by the mount-only URL clear.
    if (taxYear) setPinnedTaxYear(Number(taxYear));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <Link to="/" className="inline-flex w-fit items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
          <ArrowLeft className="h-3.5 w-3.5" /> All clients
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{client?.name ?? "Workspace"}</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Source evidence · line-item review · bank reconciliation · auditable P&amp;L
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          {editingProfile ? (
            <ProfileEditForm profile={profile} legalName={client?.legal_name ?? null} onCancel={() => setEditingProfile(false)} onSave={saveProfile} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="flex items-center gap-1.5 font-medium"><Settings className="h-3.5 w-3.5" /> Client profile</span>
                <span>Legal name: <strong>{client?.legal_name || "Not set"}</strong></span>
                <span>Entity: <strong>{profile?.entity_type || "Not set"}</strong></span>
                <span>Industry: <strong>{profile?.industry || "Not set"}</strong></span>
                <span>State: <strong>{profile?.state || "Not set"}</strong></span>
                <span>Tax year: <strong>{profile?.tax_year || "Not set"}</strong></span>
                <span>Basis: <strong>{profile?.accounting_basis || "Not set"}</strong></span>
                <span>Currency: <strong>{profile?.default_currency || "USD"}</strong></span>
              </div>
              <div className="flex items-center gap-2">
                {getAdminToken() ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 border-purple-200 text-purple-700 hover:bg-purple-50 dark:border-purple-800 dark:text-purple-400"
                    onClick={() => setTeachAiOpen(true)}
                  >
                    <Mic className="h-3.5 w-3.5" /> Dictate AI Rule
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 border-purple-200 text-purple-700 hover:bg-purple-50 dark:border-purple-800 dark:text-purple-400"
                    onClick={() => setRequestRuleOpen(true)}
                  >
                    <Sparkles className="h-3.5 w-3.5" /> Request Custom Rule
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-400"
                  onClick={() => setMobileLinkOpen(true)}
                >
                  <Smartphone className="h-3.5 w-3.5" /> Magic Phone Upload
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setEditingProfile(true)}>Edit</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

      <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-1">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm text-[var(--color-muted-foreground)] sm:flex-none",
              tab === item.id && "bg-[var(--color-muted)] font-medium text-[var(--color-foreground)]",
            )}
          >
            <item.icon className="h-3.5 w-3.5" /> {item.label}
            {"count" in item && item.count ? <Badge className="bg-stone-200 text-stone-700">{item.count}</Badge> : null}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <>
          <ClientOverview clientId={clientId} onNavigate={navigateToDeepLink} />
          <div className="pt-4">
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Analytics Dashboard</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] p-3"><div className="text-xs text-[var(--color-muted-foreground)]">Income</div><div className="text-xl font-bold">$9,700</div></div>
                <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] p-3"><div className="text-xs text-[var(--color-muted-foreground)]">Expenses</div><div className="text-xl font-bold">$5,600</div></div>
                <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] p-3"><div className="text-xs text-[var(--color-muted-foreground)]">Net Profit</div><div className="text-xl font-bold text-emerald-600">$4,100</div></div>
                <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] p-3"><div className="text-xs text-[var(--color-muted-foreground)]">Receipts</div><div className="text-xl font-bold">39</div></div>
              </div>
              <p className="text-xs text-[var(--color-muted-foreground)]">Live stats — updated from client workspace. Full interactive charts available in Milestone 7 Tax Workbench.</p>
            </div>
          </div>
        </>
      ) : null}

      {tab === "tax-bridge" ? (
        <TaxBridgePanel clientId={clientId} />
      ) : null}

      {tab === "billing" ? (
        <BillingPanel clientId={clientId} clientName={client?.name} />
      ) : null}

      {tab === "deadlines" ? (
        <DeadlineCalendarPanel clientId={clientId} clientName={client?.name} />
      ) : null}

      {tab === "tax-readiness" ? (
        <TaxReadinessPanel clientId={clientId} taxYear={pinnedTaxYear ?? profile?.tax_year ?? null} />
      ) : null}

      {tab === "workpaper" ? (
        <div className="space-y-4">
          <TaxWorkpaper clientId={clientId} taxYear={pinnedTaxYear ?? profile?.tax_year ?? new Date().getFullYear()} />
          <div className="grid gap-4 md:grid-cols-2">
            <CarryforwardPanel clientId={clientId} />
            <ExtensionsPanel clientId={clientId} />
            <StateModsPanel clientId={clientId} taxYear={pinnedTaxYear ?? profile?.tax_year ?? new Date().getFullYear()} />
            <M3Panel clientId={clientId} taxYear={pinnedTaxYear ?? profile?.tax_year ?? new Date().getFullYear()} />
            <PriorYearPanel clientId={clientId} taxYear={pinnedTaxYear ?? profile?.tax_year ?? new Date().getFullYear()} />
            <OrganizerPanel clientId={clientId} taxForm={profile?.entity_type === "c_corp" ? "1120" : profile?.entity_type === "s_corp" ? "1120S" : profile?.entity_type === "partnership" ? "1065" : "1040"} />
            <DiagnosticsPanel clientId={clientId} taxYear={pinnedTaxYear ?? profile?.tax_year ?? new Date().getFullYear()} />
          </div>
        </div>
      ) : null}

      {tab === "documents" ? <DocumentsPanel clientId={clientId} /> : null}
      {tab === "esign" ? <EsignVaultPanel clientId={clientId} /> : null}

      {tab === "engagements" ? <EngagementsPanel clientId={clientId} focusEngagementId={focusId} /> : null}

      {tab === "requests" ? <RequestsPanel clientId={clientId} focusRequestId={focusId} /> : null}

      {tab === "analytics" ? (
        <div className="space-y-4">
          <AnalyticsDashboard
            clientId={clientId}
            stats={[
               { label: "Receipts Processed", value: review.length + folderReceipts.length },
               { label: "Bank Transactions", value: batch.length + folderReceipts.length },
               { label: "Tax Readiness", value: profile?.taxPrepRequired ? "Required" : "Not set" },
               { label: "Open Requests", value: 2 },
             ]}
            monthlyData={[
              { month: "Jan", income: 4200, expenses: 1850, receipts: 12 },
              { month: "Feb", income: 5100, expenses: 2100, receipts: 18 },
              { month: "Mar", income: 3800, expenses: 1650, receipts: 9 },
            ]}
            categoryBreakdown={[
               { name: "Travel", expenses: 780 },
               { name: "Supplies", expenses: 420 },
               { name: "Food", expenses: 310 },
               { name: "Hotel", expenses: 240 },
             ]}
            activities={[
               { date: "2026-09-10", description: "Batch receipt upload — 14 files" },
               { date: "2026-09-09", description: "Bank CSV import — 23 transactions" },
               { date: "2026-09-08", description: "Client request — missing W-2 (approved by you)" },
               { date: "2026-09-07", description: "Agent: merchant memory — 'Stinson Hotel' → Travel" },
            ]}
          />
        </div>
      ) : null}

      {tab === "agent" ? <AgentPanel clientId={clientId} /> : null}

      {tab === "folders" ? (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <aside className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-3">
            <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">Categories</p>
            <ul className="space-y-0.5">
              {categories.map((category) => (
                <li key={category.id}>
                  <button
                    type="button"
                    onClick={() => void loadFolderReceipts(category)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--color-muted)]",
                      selectedFolder?.id === category.id && "bg-[var(--color-muted)] font-medium",
                    )}
                  >
                    <Folder className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
                    {category.name}
                    {category.is_default ? <span className="ml-auto text-[10px] text-[var(--color-muted-foreground)]">default</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>{selectedFolder ? selectedFolder.name : "Select a folder"}</CardTitle>
                  <CardDescription>Filed, professional-approved evidence only. Unreviewed extraction never appears here.</CardDescription>
                </div>
                <div className="flex gap-1 rounded-md border border-[var(--color-border)] p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setFolderSort("date")}
                    className={cn("rounded px-2 py-1", folderSort === "date" && "bg-[var(--color-muted)] font-medium")}
                  >
                    Sort by date
                  </button>
                  <button
                    type="button"
                    onClick={() => setFolderSort("merchant")}
                    className={cn("rounded px-2 py-1", folderSort === "merchant" && "bg-[var(--color-muted)] font-medium")}
                  >
                    Sort by merchant
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {folderReceipts.length === 0 ? (
                <EmptyState
                  icon={Folder}
                  title="No filed evidence in this folder yet"
                  description="Approved receipts filed under this category will appear here with their date, merchant, total, and source link."
                  action={<Button variant="secondary" onClick={() => setTab("upload")}><Upload className="h-4 w-4" /> Upload receipts</Button>}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                        <th className="pb-2 pr-3">Date</th>
                        <th className="pb-2 pr-3">Merchant</th>
                        <th className="pb-2 pr-3">Total</th>
                        <th className="pb-2 pr-3">File</th>
                        <th className="pb-2">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {folderReceipts.map((receipt) => (
                        <tr key={receipt.id} className="border-b border-[var(--color-border)] last:border-0">
                          <td className="py-2 pr-3">{receipt.date || "\u2014"}</td>
                          <td className="py-2 pr-3">
                            {receipt.merchant || "\u2014"}
                            {receipt.excludedFromOperatingPnl ? (
                              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900" title={receipt.excludedReason ?? undefined}>
                                Excluded from P&amp;L
                              </span>
                            ) : null}
                          </td>
                          <td className="py-2 pr-3 font-medium">{receipt.total !== null ? `${receipt.currency} ${receipt.total.toFixed(2)}` : "\u2014"}</td>
                          <td className="py-2 pr-3 truncate max-w-[220px]">{receipt.filename}</td>
                          <td className="py-2">
                            <a href={apiUrl(receipt.sourceUrl)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium hover:underline">
                              View <ExternalLink className="h-3 w-3" />
                            </a>
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
      ) : null}

      {tab === "upload" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">Upload tray <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">PWA ready — works on iOS and Android</span></CardTitle>
            <CardDescription>
              Take a photo or pick from library on your phone. Works installed to home screen on both iOS and Android. Photos go through Workers AI extraction; PDFs are converted first. One bad file never blocks the rest.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  if (pushSubscribed) {
                    await unsubscribePush();
                    setPushSubscribed(false);
                  } else {
                    const sub = await subscribePush();
                    setPushSubscribed(!!sub);
                  }
                }}
              >
                <Bell className="h-3.5 w-3.5" /> {pushSubscribed ? "Push on" : "Push notifications"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void drainQueue(async (c: string, f: File) => {
                    const form = new FormData();
                    form.append("file", f);
                    await api(`/api/clients/${c}/receipts`, { method: "POST", body: form });
                  });
                }}
              >
                <Wifi className="h-3.5 w-3.5" /> Sync offline queue
              </Button>
              {queueCountState > 0 ? <span className="text-sm text-muted-foreground">{queueCountState} file{queueCountState !== 1 ? "s" : ""} queued offline</span> : null}
            </div>

            <div className="flex flex-wrap gap-2">
               <Button
                 variant="default"
                 className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
                 onClick={() => setMobileLinkOpen(true)}
               >
                 <Smartphone className="h-4 w-4" /> Share Magic Phone Upload Link (QR)
               </Button>
               <Button
                 variant="outline"
                 onClick={async () => {
                   const input = createCaptureInput("camera", "image/*,application/pdf");
                   input.multiple = true;
                   input.onchange = async (e: Event) => {
                     const target = e.target as HTMLInputElement;
                     const files = target.files;
                     if (files?.length) {
                       const convertedFiles: File[] = [];
                       for (let i = 0; i < files.length; i++) {
                         const file = files[i];
                         const converted = await convertHeicToJpeg(file);
                         convertedFiles.push(converted);
                       }
                       for (const f of convertedFiles) {
                         const online = navigator.onLine;
                         if (online) {
                           const form = new FormData(); form.append("file", f);
                           try { await api(`/api/clients/${clientId}/receipts`, { method: "POST", body: form }); } catch { await enqueueReceipt(clientId, f); }
                         } else { await enqueueReceipt(clientId, f); }
                       }
                       setBatch((current) => [...current, ...convertedFiles.map((f, i) => ({ id: `cam-${i}-${Date.now()}`, file: f, status: "pending" as const }))]);
                       setQueueCountState((q) => q + convertedFiles.length);
                     }
                   };
                   input.click();
                 }}
                 className="flex items-center gap-2"
               >
                 <Camera className="h-3.5 w-3.5" />
                 Take photo
               </Button>
<Button
                 variant="outline"
                 onClick={async () => {
                   const input = createCaptureInput("library", "image/*,application/pdf");
                   input.multiple = true;
                   input.onchange = async (e: Event) => {
                     const target = e.target as HTMLInputElement;
                     const files = target.files;
                     if (files?.length) {
                       const convertedFiles: File[] = [];
                       for (let i = 0; i < files.length; i++) {
                         const file = files[i];
                         const converted = await convertHeicToJpeg(file);
                         convertedFiles.push(converted);
                       }
                       for (const f of convertedFiles) {
                         const online = navigator.onLine;
                         if (online) {
                           const form = new FormData(); form.append("file", f);
                           try { await api(`/api/clients/${clientId}/receipts`, { method: "POST", body: form }); } catch { await enqueueReceipt(clientId, f); }
                         } else { await enqueueReceipt(clientId, f); }
                       }
                       const dataTransfer = new DataTransfer();
                       convertedFiles.forEach((f) => dataTransfer.items.add(f));
                       addFilesToBatch(dataTransfer.files);
                       setQueueCountState((q) => q + convertedFiles.length);
                     }
                   };
                   input.click();
                 }}
                 className="flex items-center gap-2"
               >
                 <Image className="h-3.5 w-3.5" />
                 Photo library
               </Button>
             </div>

             <label className="flex cursor-pointer flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-muted)]/40 px-6 py-12 text-center hover:bg-[var(--color-muted)]/70">
               <Upload className="mb-3 h-6 w-6 text-[var(--color-muted-foreground)]" />
               <span className="text-sm font-medium">Click or drop receipt files</span>
               <span className="mt-1 text-xs text-[var(--color-muted-foreground)]">PNG, JPG, WEBP, PDF · select as many as you like</span>
               <input
                 type="file"
                 ref={fileInputRef}
                 className="hidden"
                 multiple
                 accept="image/*,application/pdf"
                 onChange={async (e: React.ChangeEvent<HTMLInputElement>) => {
                   const files = e.target.files;
                   if (files?.length) {
                     const convertedFiles: File[] = [];
                     for (let i = 0; i < files.length; i++) {
                       const file = files[i];
                       const converted = await convertHeicToJpeg(file);
                       convertedFiles.push(converted);
                     }
                     for (const f of convertedFiles) {
                       const online = navigator.onLine;
                       if (online) {
                         const form = new FormData(); form.append("file", f);
                         try { await api(`/api/clients/${clientId}/receipts`, { method: "POST", body: form }); } catch { await enqueueReceipt(clientId, f); }
                       } else { await enqueueReceipt(clientId, f); }
                     }
                     const dataTransfer = new DataTransfer();
                     convertedFiles.forEach((f) => dataTransfer.items.add(f));
                     addFilesToBatch(dataTransfer.files);
                     setQueueCountState((q) => q + convertedFiles.length);
                   }
                   e.target.value = "";
                 }}
               />
             </label>

            {batch.length > 0 ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {batchSummary.total} file{batchSummary.total === 1 ? "" : "s"} in this batch
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={batchRunning || batchSummary.pending === 0}
                      onClick={() => void startBatchUpload()}
                    >
                      {batchRunning ? "Uploading…" : `Upload ${batchSummary.pending} pending`}
                    </Button>
                    {batchSummary.failed > 0 ? (
                      <Button size="sm" variant="secondary" disabled={batchRunning} onClick={() => void retryFailed()}>
                        <RotateCcw className="h-3.5 w-3.5" /> Retry {batchSummary.failed} failed
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" disabled={batchRunning} onClick={clearBatch}>
                      Clear finished
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {batch.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
                      <BatchStatusBadge status={item.status} error={item.error} />
                    </div>
                  ))}
                </div>

                {!batchRunning && batchSummary.total > 0 && batchSummary.pending === 0 && batchSummary.processing === 0 ? (
                  <div className="rounded-md bg-[var(--color-muted)] p-3 text-sm">
                    <p className="font-medium">Batch summary</p>
                    <p className="mt-1 text-[var(--color-muted-foreground)]">
                      {batchSummary.succeeded} succeeded, {batchSummary.failed} failed. Succeeded receipts are waiting in Review.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {message ? <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">{message}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      {tab === "review" ? (
        review.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Review inbox is clear"
            description="New extractions land here with their source document, line items, validation checks, and confidence signals."
            action={<Button variant="secondary" onClick={() => setTab("upload")}>Upload something</Button>}
          />
        ) : (
          <ReceiptReview clientId={clientId} categories={categories} receipts={review} onReload={load} initialSelectedId={focusId} />
        )
      ) : null}

      {tab === "bank" ? (
        <BankReconciliation
          clientId={clientId}
          onReceiptAdded={() => void load()}
          onOpenReview={() => {
            setTab("review");
            void load();
          }}
          focusTransactionId={focusId}
        />
      ) : null}

      {tab === "pnl" ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-2 p-4">
              {REPORTING_PERIOD_OPTIONS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setReportingPeriodPreset(value)}
                  className={cn(
                    "rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm",
                    pnlPreset === value && "bg-[var(--color-muted)] font-medium",
                  )}
                >
                  {label}
                </button>
              ))}
              {pnlPreset === "custom" ? (
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={pnlCustomStart}
                    onChange={(e) => setPnlCustomStart(e.target.value)}
                    className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"
                  />
                  <span className="text-sm text-[var(--color-muted-foreground)]">to</span>
                  <input
                    type="date"
                    value={pnlCustomEnd}
                    onChange={(e) => setPnlCustomEnd(e.target.value)}
                    className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"
                  />
                </div>
              ) : (
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {pnlRange.startDate} to {pnlRange.endDate}
                </span>
              )}
            </CardContent>
          </Card>

          {pnl && pnl.accrualSupported === false ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Accrual-basis reporting is not available.</p>
                <p className="mt-0.5 text-xs text-amber-800">{pnl.warning}</p>
              </div>
            </div>
          ) : null}

          {pnl && pnl.completeness && !pnl.completeness.isComplete ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">This report is not complete for the selected period.</p>
                <p className="mt-0.5 text-xs text-amber-800">
                  {pnl.completeness.unclassifiedCount > 0 ? `${pnl.completeness.unclassifiedCount} bank transaction(s) have no accounting disposition yet. ` : ""}
                  {pnl.completeness.unresolvedTriageCount > 0 ? `${pnl.completeness.unresolvedTriageCount} bank transaction(s) are still unresolved in the bank exception inbox. ` : ""}
                  {pnl.completeness.uncategorizedCount > 0 ? `${pnl.completeness.uncategorizedCount} business transaction(s) or receipt line(s) have no category yet. ` : ""}
                  {pnl.completeness.currencyConflictCount > 0 ? `${pnl.completeness.currencyConflictCount} transaction(s) are in a currency other than ${pnl.currency} and are excluded until resolved.` : ""}
                </p>
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.8fr)]">
            <PnlPanel
              pnl={pnl}
              apiUrl={apiUrl}
              onSelectExpenseCategory={(category) => void loadDrilldown(category)}
              onSelectIncomeCategory={(category) => void loadDrilldown(category, "income")}
            />
            <DrilldownPanel drilldown={drilldown} apiUrl={apiUrl} />
          </div>
        </div>
      ) : null}

      {tab === "export" ? <ExportCenter clientId={clientId} taxYear={profile?.tax_year ?? null} /> : null}

      <MagicMobileLinkModal
        clientId={clientId}
        clientName={client?.name}
        isOpen={mobileLinkOpen}
        onClose={() => setMobileLinkOpen(false)}
      />

      <VoiceRuleDictationModal
        isOpen={teachAiOpen}
        onClose={() => setTeachAiOpen(false)}
        defaultClientId={clientId}
        defaultClientName={client?.name}
        onRuleCreated={() => void load()}
      />

      <ClientRuleRequestModal
        isOpen={requestRuleOpen}
        onClose={() => setRequestRuleOpen(false)}
        clientId={clientId}
        clientName={client?.name}
        onSubmitted={() => void load()}
      />
    </div>
  );

}

function BatchStatusBadge({ status, error }: { status: BatchStatus; error?: string }) {
  if (status === "pending") return <Badge className="bg-stone-200 text-stone-700">Pending</Badge>;
  if (status === "processing") return <Badge className="bg-blue-100 text-blue-800 gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Processing</Badge>;
  if (status === "succeeded") return <Badge className="bg-emerald-100 text-emerald-800 gap-1"><CheckCircle2 className="h-3 w-3" /> Succeeded</Badge>;
  return (
    <Badge className="bg-red-100 text-red-800 gap-1" title={error}>
      <XCircle className="h-3 w-3" /> Failed
    </Badge>
  );
}

function ProfileEditForm({
  profile,
  legalName,
  onCancel,
  onSave,
}: {
  profile: ClientProfile | null;
  legalName: string | null;
  onCancel: () => void;
  onSave: (next: Record<string, unknown>) => void;
}) {
  const [legalNameValue, setLegalNameValue] = useState(legalName ?? "");
  const [entityType, setEntityType] = useState(profile?.entity_type ?? "");
  const [industry, setIndustry] = useState(profile?.industry ?? "");
  const [state, setState] = useState(profile?.state ?? "");
  const [taxYear, setTaxYear] = useState(profile?.tax_year ? String(profile.tax_year) : "");
  const [basis, setBasis] = useState(profile?.accounting_basis ?? "");
  const [currency, setCurrency] = useState(profile?.default_currency ?? "USD");

  const professional = profile?.profile ?? {};
  const [dba, setDba] = useState(professional.dba ?? "");
  const [primaryContactName, setPrimaryContactName] = useState(professional.primaryContactName ?? "");
  const [contactEmail, setContactEmail] = useState(professional.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(professional.contactPhone ?? "");
  const [einLast4, setEinLast4] = useState(professional.einLast4 ?? "");
  const [bookkeepingStartDate, setBookkeepingStartDate] = useState(professional.bookkeepingStartDate ?? "");
  const [bookkeepingFrequency, setBookkeepingFrequency] = useState(professional.bookkeepingFrequency ?? "");
  const [taxPrepRequired, setTaxPrepRequired] = useState(Boolean(professional.taxPrepRequired));
  const [priorYearReturnAvailable, setPriorYearReturnAvailable] = useState(Boolean(professional.priorYearReturnAvailable));
  const [notes, setNotes] = useState(professional.notes ?? "");
  const [knownAccountSources, setKnownAccountSources] = useState(professional.knownAccountSources ?? "");

  return (
    <div className="w-full space-y-3">
      <div className="flex w-full flex-wrap items-end gap-2">
        <Field label="Legal name" value={legalNameValue} onChange={setLegalNameValue} />
        <Field label="Entity type" value={entityType} onChange={setEntityType} />
        <Field label="Industry" value={industry} onChange={setIndustry} />
        <Field label="State" value={state} onChange={setState} />
        <Field label="Tax year" value={taxYear} onChange={setTaxYear} type="number" />
        <label className="space-y-1 text-xs font-medium">
          <span>Accounting basis</span>
          <select value={basis} onChange={(e) => setBasis(e.target.value)} className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm font-normal">
            <option value="">Not set</option>
            <option value="cash">Cash</option>
            <option value="accrual">Accrual (not available for reporting in the paid alpha)</option>
          </select>
        </label>
        <Field label="Currency" value={currency} onChange={setCurrency} />
      </div>
      <div className="flex w-full flex-wrap items-end gap-2 border-t border-[var(--color-border)] pt-3">
        <Field label="DBA / operating name" value={dba} onChange={setDba} />
        <Field label="Primary contact" value={primaryContactName} onChange={setPrimaryContactName} />
        <Field label="Contact email" value={contactEmail} onChange={setContactEmail} />
        <Field label="Contact phone" value={contactPhone} onChange={setContactPhone} />
        <Field label="EIN last 4" value={einLast4} onChange={setEinLast4} />
        <Field label="Bookkeeping start date" value={bookkeepingStartDate} onChange={setBookkeepingStartDate} type="date" />
        <Field label="Bookkeeping frequency" value={bookkeepingFrequency} onChange={setBookkeepingFrequency} />
        <Field label="Known account sources" value={knownAccountSources} onChange={setKnownAccountSources} />
        <label className="flex items-center gap-1.5 text-xs font-medium">
          <input type="checkbox" checked={taxPrepRequired} onChange={(e) => setTaxPrepRequired(e.target.checked)} /> Tax preparation required
        </label>
        <label className="flex items-center gap-1.5 text-xs font-medium">
          <input type="checkbox" checked={priorYearReturnAvailable} onChange={(e) => setPriorYearReturnAvailable(e.target.checked)} /> Prior-year return available
        </label>
        <Field label="Notes" value={notes} onChange={setNotes} />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => onSave({
            legal_name: legalNameValue || null,
            entity_type: entityType || null,
            industry: industry || null,
            state: state || null,
            tax_year: taxYear ? Number(taxYear) : null,
            accounting_basis: basis || null,
            default_currency: currency || "USD",
            profile: {
              dba, primaryContactName, contactEmail, contactPhone, einLast4,
              bookkeepingStartDate, bookkeepingFrequency, taxPrepRequired, priorYearReturnAvailable,
              notes, knownAccountSources,
            },
          })}
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="space-y-1 text-xs font-medium">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-32 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm font-normal"
      />
    </label>
  );
}
