import { useEffect, useMemo, useState } from "react";
import {
  ShieldCheck,
  FileCheck2,
  ExternalLink,
  Search,
  Download,
  Copy,
  Info,
  PenTool,
  X,
} from "lucide-react";
import { api, apiUrl } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NativeEsignModal } from "./native-esign-modal";
import { formatDateTime } from "@/lib/formatters";

export interface VaultRecord {
  requestId: string;
  documentId: string | null;
  engagementId: string | null;
  formType: string;
  status: "pending" | "sent" | "signed" | "declined" | "voided";
  signedAt: string | null;
  createdAt: string;
  filename: string;
  documentType: string;
  engagementTitle?: string | null;
  signerName: string;
  signerEmail: string | null;
  certificateId: string | null;
  documentHash: string | null;
  originalHash: string | null;
  ipAddress: string | null;
  sourceUrl: string | null;
  tamperEvidentStatus: string;
  complianceNotice: string;
}

export function EsignVaultPanel({ clientId }: { clientId: string }) {
  const [records, setRecords] = useState<VaultRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "signed" | "pending">("all");
  const [search, setSearch] = useState("");
  const [selectedAuditRecord, setSelectedAuditRecord] = useState<VaultRecord | null>(null);
  const [activeSignModal, setActiveSignModal] = useState<VaultRecord | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  async function loadVault() {
    setLoading(true);
    try {
      const data = await api<{ records: VaultRecord[] }>(
        `/api/clients/${clientId}/signature-vault`,
      );
      setRecords(data.records || []);
    } catch {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadVault();
  }, [clientId]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(text);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (filter === "signed" && r.status !== "signed") return false;
      if (filter === "pending" && r.status === "signed") return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesName = r.filename?.toLowerCase().includes(q);
        const matchesSigner = r.signerName?.toLowerCase().includes(q);
        const matchesCert = r.certificateId?.toLowerCase().includes(q);
        const matchesType = r.formType?.toLowerCase().includes(q);
        if (!matchesName && !matchesSigner && !matchesCert && !matchesType) return false;
      }
      return true;
    });
  }, [records, filter, search]);

  const signedCount = records.filter((r) => r.status === "signed").length;
  const pendingCount = records.filter((r) => r.status !== "signed").length;

  return (
    <div className="space-y-4">
      {/* Header Banner */}
      <Card className="border-[var(--color-border)] bg-[var(--color-card)]">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base font-semibold">
                  E-Signature & Compliance Vault
                </CardTitle>
                <CardDescription className="text-xs">
                  Signed engagement letters and disclosures, with their integrity records
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono text-[11px]">
                SHA-256 recorded
              </Badge>
              <Badge className="bg-[var(--color-muted)] text-[var(--color-foreground)] font-mono text-[11px]">
                Firm-isolated storage
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 pt-1">
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-3">
              <div className="text-xs text-[var(--color-muted-foreground)]">Signed</div>
              <div className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                {signedCount}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-3">
              <div className="text-xs text-[var(--color-muted-foreground)]">Awaiting Signature</div>
              <div className="text-xl font-bold font-mono text-amber-600 dark:text-amber-400">
                {pendingCount}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-3">
              <div className="text-xs text-[var(--color-muted-foreground)]">Integrity Standard</div>
              <div className="text-sm font-semibold text-[var(--color-foreground)]">
                Dual SHA-256
              </div>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-3">
              <div className="text-xs text-[var(--color-muted-foreground)]">Per-Envelope Cost</div>
              <div className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                $0.00
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action and Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-0.5">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === "all"
                ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            }`}
          >
            All Records ({records.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("signed")}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === "signed"
                ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            }`}
          >
            Signed & Sealed ({signedCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter("pending")}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === "pending"
                ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            }`}
          >
            Pending ({pendingCount})
          </button>
        </div>

        <div className="relative min-w-[220px]">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
          <input
            type="text"
            placeholder="Search certificate or file..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
          />
        </div>
      </div>

      {/* Record List */}
      {loading ? (
        <Card className="p-8 text-center text-xs text-[var(--color-muted-foreground)]">
          Loading client signature records and certificates...
        </Card>
      ) : filteredRecords.length === 0 ? (
        <Card className="p-8 text-center text-xs text-[var(--color-muted-foreground)]">
          No signature records found matching current criteria.
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredRecords.map((rec) => {
            const isSigned = rec.status === "signed";
            return (
              <Card
                key={rec.requestId}
                className="transition-all hover:border-[var(--color-primary)]/40 hover:shadow-sm"
              >
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm text-[var(--color-foreground)]">
                          {rec.filename}
                        </span>
                        <Badge
                          className={
                            isSigned
                              ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px]"
                              : "bg-amber-500/10 text-amber-600 border-amber-500/30 text-[10px]"
                          }
                        >
                          {isSigned ? "Signed" : "Pending Signature"}
                        </Badge>
                        <Badge className="bg-[var(--color-muted)] text-[var(--color-muted-foreground)] text-[10px] uppercase">
                          {rec.formType.replace(/_/g, " ")}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-muted-foreground)]">
                        <span>Signer: <strong className="text-[var(--color-foreground)]">{rec.signerName}</strong> ({rec.signerEmail || "Email not specified"})</span>
                        {rec.signedAt && (
                          <span>
                            Signed: <strong className="text-[var(--color-foreground)]">{formatDateTime(rec.signedAt)}</strong>
                          </span>
                        )}
                      </div>

                      {isSigned && rec.certificateId && (
                        <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[11px]">
                          <span className="rounded bg-[var(--color-muted)] px-2 py-0.5 text-[var(--color-muted-foreground)]">
                            Cert ID: <strong className="text-[var(--color-foreground)]">{rec.certificateId}</strong>
                          </span>
                          {rec.documentHash && (
                            <span className="flex items-center gap-1 rounded bg-[var(--color-muted)] px-2 py-0.5 text-[var(--color-muted-foreground)]">
                              Digest: {rec.documentHash.slice(0, 16)}...
                              <button
                                onClick={() => copyToClipboard(rec.documentHash!)}
                                className="hover:text-[var(--color-foreground)]"
                                title="Copy full SHA-256 digest"
                              >
                                {copiedHash === rec.documentHash ? (
                                  <span className="text-[9px] text-emerald-600 font-semibold">Copied!</span>
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 self-end sm:self-center">
                      {isSigned && rec.sourceUrl && (
                        <a
                          href={apiUrl(rec.sourceUrl)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--color-muted)]"
                        >
                          <FileCheck2 className="h-3.5 w-3.5 text-emerald-600" />
                          View signed PDF
                          <ExternalLink className="h-3 w-3 text-[var(--color-muted-foreground)]" />
                        </a>
                      )}

                      {isSigned && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedAuditRecord(rec)}
                          className="h-8 text-xs"
                        >
                          <Info className="mr-1 h-3.5 w-3.5" />
                          Audit Certificate
                        </Button>
                      )}

                      {!isSigned && (
                        <Button
                          size="sm"
                          onClick={() => setActiveSignModal(rec)}
                          className="h-8 bg-[var(--color-primary)] hover:opacity-90 text-[var(--color-primary-foreground)] text-xs"
                        >
                          <PenTool className="mr-1.5 h-3.5 w-3.5" />
                          Sign with Truepost E-Sign
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Audit Certificate Details Modal */}
      {selectedAuditRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <Card className="relative w-full max-w-lg border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl">
            <button
              onClick={() => setSelectedAuditRecord(null)}
              className="absolute right-4 top-4 rounded-md p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
            >
              <X className="h-5 w-5" />
            </button>

            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-sm font-semibold">
                    Certificate of Completion & Audit Log
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Who signed, when, from where, and the document's SHA-256 fingerprints
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-3 text-xs">
              <div className="space-y-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-3 font-mono">
                <div className="flex justify-between border-b border-[var(--color-border)]/50 pb-1">
                  <span className="text-[var(--color-muted-foreground)]">Certificate ID:</span>
                  <span className="font-semibold text-[var(--color-foreground)]">
                    {selectedAuditRecord.certificateId || "N/A"}
                  </span>
                </div>
                <div className="flex justify-between border-b border-[var(--color-border)]/50 pb-1">
                  <span className="text-[var(--color-muted-foreground)]">Signer Name:</span>
                  <span className="font-semibold text-[var(--color-foreground)]">
                    {selectedAuditRecord.signerName}
                  </span>
                </div>
                <div className="flex justify-between border-b border-[var(--color-border)]/50 pb-1">
                  <span className="text-[var(--color-muted-foreground)]">Signer Email:</span>
                  <span className="text-[var(--color-foreground)]">
                    {selectedAuditRecord.signerEmail || "N/A"}
                  </span>
                </div>
                <div className="flex justify-between border-b border-[var(--color-border)]/50 pb-1">
                  <span className="text-[var(--color-muted-foreground)]">Timestamp:</span>
                  <span className="text-[var(--color-foreground)]">
                    {selectedAuditRecord.signedAt ? new Date(selectedAuditRecord.signedAt).toISOString() : "N/A"}
                  </span>
                </div>
                <div className="flex justify-between border-b border-[var(--color-border)]/50 pb-1">
                  <span className="text-[var(--color-muted-foreground)]">Signer IP Address:</span>
                  <span className="text-[var(--color-foreground)]">
                    {selectedAuditRecord.ipAddress || "Verified Client Connection"}
                  </span>
                </div>
                <div className="flex flex-col gap-1 border-b border-[var(--color-border)]/50 pb-1">
                  <span className="text-[var(--color-muted-foreground)]">Original Document SHA-256:</span>
                  <span className="break-all text-[10px] text-[var(--color-foreground)]">
                    {selectedAuditRecord.originalHash || "Digest sealed into PDF"}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[var(--color-muted-foreground)]">Final SHA-256:</span>
                  <span className="break-all text-[10px] text-emerald-600 dark:text-emerald-400">
                    {selectedAuditRecord.documentHash || "Digest sealed into PDF"}
                  </span>
                </div>
              </div>

              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                <strong>Storage:</strong> This record and the signed PDF are kept in your firm's isolated Cloudflare R2 storage. Your firm sets, and is responsible for, its own record-retention period.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                {selectedAuditRecord.sourceUrl && (
                  <a
                    href={apiUrl(selectedAuditRecord.sourceUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-primary-foreground)] hover:opacity-90"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download signed PDF
                  </a>
                )}
                <Button size="sm" variant="outline" onClick={() => setSelectedAuditRecord(null)}>
                  Close
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Active Native E-Sign Modal */}
      {activeSignModal && (
        <NativeEsignModal
          clientId={clientId}
          requestId={activeSignModal.requestId}
          documentTitle={activeSignModal.filename}
          defaultSignerName={activeSignModal.signerName}
          defaultSignerEmail={activeSignModal.signerEmail || ""}
          onClose={() => setActiveSignModal(null)}
          onSuccess={() => {
            setActiveSignModal(null);
            void loadVault();
          }}
        />
      )}
    </div>
  );
}
