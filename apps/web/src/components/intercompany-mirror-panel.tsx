import { useEffect, useState } from "react";
import {
  ArrowRightLeft,
  CheckCircle2,
  RefreshCw,
  Building2,
  Network,
  Link2,
  Plus,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/formatters";

export interface IntercompanyMatchCandidate {
  matchId: string;
  confidenceScore: number;
  matchRating: "high_confidence" | "probable_match" | "suggested_match";
  matchReason: string;
  dateDifferenceDays: number;
  amount: number;
  source: {
    clientId: string;
    clientName: string;
    transactionId: string;
    txnDate: string;
    description: string;
    amount: number;
    triage: string;
  };
  mirror: {
    clientId: string;
    clientName: string;
    transactionId: string;
    txnDate: string;
    description: string;
    amount: number;
    triage: string;
  };
  suggestedClassification: {
    sourceCategory: string;
    mirrorCategory: string;
  };
}

export interface AffiliateRelationship {
  id: string;
  firmId: string;
  clientIdA: string;
  clientNameA: string;
  clientIdB: string;
  clientNameB: string;
  relationshipLabel: string;
  createdAt: string;
}

interface MatchesResponse {
  matches: IntercompanyMatchCandidate[];
  clientName: string;
  legalName?: string | null;
  count: number;
}

interface AffiliatesResponse {
  affiliates: AffiliateRelationship[];
}

export function IntercompanyMirrorPanel({ clientId }: { clientId: string }) {
  const [data, setData] = useState<MatchesResponse | null>(null);
  const [affiliates, setAffiliates] = useState<AffiliateRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  const [reconciledIds, setReconciledIds] = useState<Set<string>>(new Set());
  const [lastScannedAt, setLastScannedAt] = useState<Date | null>(null);

  // Link Affiliate Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [allClients, setAllClients] = useState<{ id: string; name: string }[]>([]);
  const [selectedAffiliateId, setSelectedAffiliateId] = useState("");
  const [relationshipLabel, setRelationshipLabel] = useState("Operating / Holding Company");
  const [savingLink, setSavingLink] = useState(false);

  async function loadMatches() {
    setLoading(true);
    setError(null);
    try {
      const [matchesRes, affRes] = await Promise.all([
        api<MatchesResponse>(`/api/clients/${clientId}/intercompany/matches`),
        api<AffiliatesResponse>(`/api/clients/${clientId}/intercompany/affiliates`),
      ]);
      setData(matchesRes);
      setAffiliates(affRes.affiliates || []);
      setLastScannedAt(new Date());
    } catch (e: any) {
      setError(e?.message || "Failed to scan intercompany mirror transactions.");
    } finally {
      setLoading(false);
    }
  }

  async function loadAllClients() {
    try {
      const res = await api<{ clients: { id: string; name: string }[] }>("/api/clients");
      setAllClients((res.clients || []).filter((c) => c.id !== clientId));
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadMatches();
    loadAllClients();
  }, [clientId]);

  async function handleReconcile(match: IntercompanyMatchCandidate) {
    setReconcilingId(match.matchId);
    try {
      await api(`/api/clients/${clientId}/intercompany/reconcile`, {
        method: "POST",
        body: JSON.stringify({
          sourceTxnId: match.source.transactionId,
          sourceClientId: match.source.clientId,
          sourceClientName: match.source.clientName,
          mirrorTxnId: match.mirror.transactionId,
          mirrorClientId: match.mirror.clientId,
          mirrorClientName: match.mirror.clientName,
          amount: match.amount,
          reason: `1-Click Mirror Match: ${match.matchReason}`,
        }),
      });

      setReconciledIds((prev) => new Set([...prev, match.matchId]));
    } catch (e: any) {
      alert("Failed to reconcile mirror transactions: " + (e?.message || "Unknown error"));
    } finally {
      setReconcilingId(null);
    }
  }

  async function handleCreateAffiliate() {
    if (!selectedAffiliateId) return;
    setSavingLink(true);
    try {
      await api(`/api/clients/${clientId}/intercompany/affiliates`, {
        method: "POST",
        body: JSON.stringify({
          relatedClientId: selectedAffiliateId,
          relationshipLabel,
        }),
      });
      setShowAddModal(false);
      setSelectedAffiliateId("");
      await loadMatches();
    } catch (e: any) {
      alert("Failed to link affiliate entity: " + (e?.message || "Unknown error"));
    } finally {
      setSavingLink(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-3">
        <RefreshCw className="h-7 w-7 animate-spin text-emerald-600" />
        <p className="text-sm font-medium text-[var(--color-muted-foreground)]">
          Scanning firm ledgers for intercompany transfers and mirror deposits...
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-6 text-center space-y-3">
        <p className="text-sm font-medium text-rose-700 dark:text-rose-400">{error || "Failed to load mirror data."}</p>
        <Button size="sm" variant="outline" onClick={loadMatches}>
          Retry Scan
        </Button>
      </div>
    );
  }

  const { matches, clientName } = data;
  const activeMatches = matches.filter((m) => !reconciledIds.has(m.matchId));
  const totalVolume = activeMatches.reduce((acc, m) => acc + m.amount, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-[var(--color-foreground)] flex items-center gap-2">
              <Network className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              Multi-Entity Intercompany Mirror Reconciliation
            </h2>
            <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[10px]">
              Dual-Book Ledger Sync
            </Badge>
          </div>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
            Automated detection of matching transfers, rents, and fees across affiliated business entities.
            {lastScannedAt ? ` · Last scanned ${formatDateTime(lastScannedAt)}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowAddModal(true)} className="text-xs h-8 gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Link Affiliate Entity
          </Button>
          <Button size="sm" variant="outline" onClick={loadMatches} className="text-xs h-8 gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Re-Scan Ledgers
          </Button>
        </div>
      </div>

      {/* Snapshot Counters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Pending Mirror Matches
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-[var(--color-foreground)]">
              {activeMatches.length} Candidate{activeMatches.length === 1 ? "" : "s"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Unreconciled cross-entity transfers needing dual clearance.
            </p>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Matched Dollar Volume
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              ${totalVolume.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Total intercompany liquidity currently balancing across books.
            </p>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Linked Affiliates
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-[var(--color-foreground)]">
              {affiliates.length} Entit{affiliates.length === 1 ? "y" : "ies"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Sister entities, holding companies, and shared operating LLCs.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Candidate Matches Section */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          Detected Mirror Transaction Pairs
        </h3>

        {activeMatches.length === 0 ? (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center space-y-2">
            <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto" />
            <h4 className="text-base font-semibold text-[var(--color-foreground)]">
              All Intercompany Ledgers Balanced
            </h4>
            <p className="text-xs text-[var(--color-muted-foreground)] max-w-md mx-auto">
              No unreconciled cross-entity disbursements or matching deposits were detected. All intercompany transfers between {clientName} and sister entities are currently cleared.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {activeMatches.map((match) => {
              const isReconciling = reconcilingId === match.matchId;

              return (
                <Card key={match.matchId} className="border shadow-sm overflow-hidden">
                  <div className="bg-[var(--color-muted)]/50 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)]">
                    <div className="flex items-center gap-2">
                      <Badge className={match.confidenceScore >= 90 ? "bg-emerald-600 text-white text-[10px]" : "bg-amber-600 text-white text-[10px]"}>
                        {match.confidenceScore}% Match Confidence
                      </Badge>
                      <span className="text-xs font-medium text-[var(--color-foreground)]">
                        {match.matchReason}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--color-muted-foreground)]">
                        Cleared within {match.dateDifferenceDays === 0 ? "same day" : `${match.dateDifferenceDays} day(s)`}
                      </span>
                      <Button
                        size="sm"
                        onClick={() => handleReconcile(match)}
                        disabled={isReconciling}
                        className="bg-[var(--color-primary)] hover:opacity-90 text-[var(--color-primary-foreground)] text-xs h-7 gap-1.5 shadow-sm ml-2"
                      >
                        {isReconciling ? (
                          <>
                            <RefreshCw className="h-3 w-3 animate-spin" /> Reconciling...
                          </>
                        ) : (
                          <>
                            <ArrowRightLeft className="h-3 w-3" /> Reconcile Both Books (1-Click)
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  <CardContent className="p-4">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-center">
                      {/* Entity A: Disbursement (Source) */}
                      <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-[var(--color-foreground)] flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5 text-rose-600" />
                            {match.source.clientName}
                          </span>
                          <span className="text-xs font-semibold text-rose-700 dark:text-rose-400">
                            Disbursement Out
                          </span>
                        </div>

                        <div className="flex items-baseline justify-between pt-1">
                          <span className="text-lg font-extrabold text-rose-600 dark:text-rose-400">
                            -${match.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                          <span className="text-xs text-[var(--color-muted-foreground)]">
                            {formatDate(match.source.txnDate)}
                          </span>
                        </div>

                        <p className="text-xs text-[var(--color-muted-foreground)] truncate" title={match.source.description}>
                          {match.source.description}
                        </p>

                        <div className="pt-1 border-t border-rose-500/10 flex items-center justify-between text-[11px]">
                          <span className="text-[var(--color-muted-foreground)]">Designated Account:</span>
                          <span className="font-semibold text-[var(--color-foreground)]">
                            {match.suggestedClassification.sourceCategory}
                          </span>
                        </div>
                      </div>

                      {/* Center Transfer Indicator */}
                      <div className="hidden md:flex flex-col items-center justify-center px-2 text-[var(--color-muted-foreground)]">
                        <div className="rounded-full bg-[var(--color-muted)] p-2">
                          <ArrowRightLeft className="h-4 w-4 text-emerald-600" />
                        </div>
                        <span className="text-[10px] font-semibold mt-1 uppercase tracking-wider">Mirror Match</span>
                      </div>

                      {/* Entity B: Deposit (Mirror) */}
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-[var(--color-foreground)] flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5 text-emerald-600" />
                            {match.mirror.clientName}
                          </span>
                          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                            Deposit In
                          </span>
                        </div>

                        <div className="flex items-baseline justify-between pt-1">
                          <span className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">
                            +${match.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                          <span className="text-xs text-[var(--color-muted-foreground)]">
                            {formatDate(match.mirror.txnDate)}
                          </span>
                        </div>

                        <p className="text-xs text-[var(--color-muted-foreground)] truncate" title={match.mirror.description}>
                          {match.mirror.description}
                        </p>

                        <div className="pt-1 border-t border-emerald-500/10 flex items-center justify-between text-[11px]">
                          <span className="text-[var(--color-muted-foreground)]">Designated Account:</span>
                          <span className="font-semibold text-[var(--color-foreground)]">
                            {match.suggestedClassification.mirrorCategory}
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Linked Affiliates List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Link2 className="h-4 w-4 text-emerald-600" />
                Intercompany Affiliates &amp; Sister Entities
              </CardTitle>
              <CardDescription className="text-xs">
                Entities linked to {clientName} for automatic mirror detection and intercompany trial balance consolidation.
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setShowAddModal(true)} className="text-xs h-7 gap-1">
              <Plus className="h-3 w-3" /> Link Another Entity
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {affiliates.length === 0 ? (
            <p className="text-xs text-[var(--color-muted-foreground)] italic">
              No formal affiliate relationships linked yet. Truepost scans all clients in your firm automatically, but linking entities prioritizes high-confidence matching and generates consolidated intercompany schedules.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {affiliates.map((aff) => {
                const partnerName = aff.clientIdA === clientId ? aff.clientNameB : aff.clientNameA;
                return (
                  <div key={aff.id} className="rounded-lg border border-[var(--color-border)] p-3 flex items-center justify-between text-xs">
                    <div className="space-y-0.5">
                      <div className="font-semibold text-[var(--color-foreground)] flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-stone-500" />
                        {partnerName}
                      </div>
                      <div className="text-[11px] text-[var(--color-muted-foreground)]">
                        {aff.relationshipLabel}
                      </div>
                    </div>
                    <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10px]">
                      Linked
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Affiliate Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-[var(--color-foreground)] flex items-center gap-2">
              <Link2 className="h-5 w-5 text-emerald-600" />
              Link Intercompany Affiliate Entity
            </h3>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Link another client in your firm to {clientName} to establish intercompany relationships and mirror rules.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-[var(--color-muted-foreground)] block mb-1">
                  Select Affiliate Client
                </label>
                <select
                  value={selectedAffiliateId}
                  onChange={(e) => setSelectedAffiliateId(e.target.value)}
                  className="w-full text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2"
                >
                  <option value="">-- Choose affiliate client --</option>
                  {allClients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-[var(--color-muted-foreground)] block mb-1">
                  Relationship Label
                </label>
                <input
                  type="text"
                  value={relationshipLabel}
                  onChange={(e) => setRelationshipLabel(e.target.value)}
                  placeholder="e.g. Operating / Holding Company"
                  className="w-full text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
              <Button size="sm" variant="ghost" onClick={() => setShowAddModal(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreateAffiliate}
                disabled={!selectedAffiliateId || savingLink}
                className="bg-[var(--color-primary)] hover:opacity-90 text-[var(--color-primary-foreground)] text-xs"
              >
                {savingLink ? "Linking..." : "Save Link"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
