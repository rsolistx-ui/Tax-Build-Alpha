import { useState, useEffect, useCallback } from "react";
import {
  CreditCard,
  Plus,
  DollarSign,
  Send,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Trash2,
  Loader2,
  Receipt,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface Invoice {
  id: string;
  firmId: string;
  clientId: string;
  number: string;
  status: "draft" | "sent" | "paid" | "void" | "overdue";
  issueDate: string;
  dueDate: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  notes: string | null;
  memo: string | null;
  createdAt: string;
}

export function BillingPanel({ clientId, clientName }: { clientId: string; clientName?: string }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New Invoice Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return d.toISOString().slice(0, 10);
  });
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<InvoiceLine[]>([
    { description: "Tax Preparation & Bookkeeping Review", quantity: 1, unitPrice: 350 },
  ]);

  // Payment Recording Modal state
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [showPayModal, setShowPayModal] = useState(false);
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<"credit_card" | "ach" | "check" | "cash" | "wire">("credit_card");
  const [paymentRef, setPaymentRef] = useState("");

  // Payment Link copied toast state
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ invoices: Invoice[] }>(`/api/billing/${clientId}/invoices`);
      setInvoices(res.invoices || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load invoices.");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  // Metrics
  const totalBilled = invoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0);
  const totalCollected = invoices.reduce((sum, inv) => sum + Number(inv.amountPaid || 0), 0);
  const totalOutstanding = invoices
    .filter((inv) => inv.status !== "paid" && inv.status !== "void")
    .reduce((sum, inv) => sum + Number(inv.balanceDue ?? inv.total ?? 0), 0);

  // Create invoice handler
  async function handleCreateInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (lines.length === 0) return;
    setCreating(true);
    try {
      await api(`/api/billing/${clientId}/invoices`, {
        method: "POST",
        body: JSON.stringify({
          issueDate,
          dueDate,
          lines: lines.map((l) => ({
            description: l.description,
            quantity: Number(l.quantity),
            unitPrice: Number(l.unitPrice),
          })),
          notes: notes || undefined,
        }),
      });
      setShowCreateModal(false);
      // Reset form
      setLines([{ description: "Tax Preparation & Bookkeeping Review", quantity: 1, unitPrice: 350 }]);
      await loadInvoices();
    } catch (err: any) {
      alert(err?.message || "Failed to create invoice");
    } finally {
      setCreating(false);
    }
  }

  // Send / Mark Sent handler
  async function handleSendInvoice(inv: Invoice) {
    try {
      await api(`/api/billing/${clientId}/invoices/${inv.id}/send`, { method: "POST" });
      await loadInvoices();
    } catch (err: any) {
      alert(err?.message || "Failed to send invoice");
    }
  }

  // Record Payment handler
  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedInvoice) return;
    setRecordingPayment(true);
    try {
      await api(`/api/billing/${clientId}/payments`, {
        method: "POST",
        body: JSON.stringify({
          invoiceId: selectedInvoice.id,
          amount: Number(paymentAmount),
          method: paymentMethod,
          reference: paymentRef || undefined,
          receivedDate: new Date().toISOString().slice(0, 10),
        }),
      });
      setShowPayModal(false);
      setSelectedInvoice(null);
      await loadInvoices();
    } catch (err: any) {
      alert(err?.message || "Failed to record payment");
    } finally {
      setRecordingPayment(false);
    }
  }

  // Copy payment text for client
  async function copyPaymentText(inv: Invoice) {
    const text = `Invoice #${inv.number} from Folio for ${clientName || "Client"}\nAmount: $${inv.total.toFixed(2)}\nDue Date: ${inv.dueDate}\nBalance: $${inv.balanceDue.toFixed(2)}`;
    await navigator.clipboard.writeText(text);
    setCopiedId(inv.id);
    setTimeout(() => setCopiedId(null), 2500);
  }

  function addLine() {
    setLines([...lines, { description: "", quantity: 1, unitPrice: 0 }]);
  }

  function removeLine(index: number) {
    setLines(lines.filter((_, i) => i !== index));
  }

  function updateLine(index: number, field: keyof InvoiceLine, val: any) {
    const next = [...lines];
    next[index] = { ...next[index], [field]: val };
    setLines(next);
  }

  const invoiceTotal = lines.reduce((sum, l) => sum + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0);

  return (
    <div className="space-y-6">
      {/* Top Metrics Banner */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-[var(--color-border)]">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--color-muted-foreground)]">Total Invoiced</span>
              <DollarSign className="h-4 w-4 text-[var(--color-muted-foreground)]" />
            </div>
            <div className="text-2xl font-bold text-[var(--color-foreground)] mt-1">
              ${totalBilled.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-[10px] text-[var(--color-muted-foreground)] mt-0.5">{invoices.length} total invoices</p>
          </CardContent>
        </Card>

        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">Total Collected</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-bold text-emerald-600 mt-1">
              ${totalCollected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-[10px] text-emerald-700/80 mt-0.5">Cleared via card, ACH, or check</p>
          </CardContent>
        </Card>

        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">Outstanding Balance</span>
              <AlertCircle className="h-4 w-4 text-amber-600" />
            </div>
            <div className="text-2xl font-bold text-amber-600 mt-1">
              ${totalOutstanding.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-[10px] text-amber-700/80 mt-0.5">Awaiting client payment</p>
          </CardContent>
        </Card>
      </div>

      {/* Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-foreground)]">Invoices & Payments</h2>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Create professional invoices, collect Stripe payments, and track receivables for {clientName || "this client"}.
          </p>
        </div>
        <Button size="sm" className="gap-1.5 text-xs h-8" onClick={() => setShowCreateModal(true)}>
          <Plus className="h-3.5 w-3.5" />
          Create Invoice
        </Button>
      </div>

      {/* Invoice List */}
      {error ? (
        <div className="rounded-md bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="py-12 text-center">
          <Loader2 className="h-7 w-7 animate-spin mx-auto text-[var(--color-primary)]" />
          <p className="text-xs text-[var(--color-muted-foreground)] mt-2">Loading client invoices...</p>
        </div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-12 border border-dashed rounded-lg border-[var(--color-border)]">
          <Receipt className="h-10 w-10 mx-auto text-[var(--color-muted-foreground)] opacity-40 mb-2" />
          <h3 className="text-sm font-semibold text-[var(--color-foreground)]">No invoices yet</h3>
          <p className="text-xs text-[var(--color-muted-foreground)] max-w-sm mx-auto mt-1 mb-4">
            Phyllis can bill for tax return preparation, monthly bookkeeping, or advisory services in 15 seconds.
          </p>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setShowCreateModal(true)}>
            <Plus className="h-3.5 w-3.5" /> Create First Invoice
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {invoices.map((inv) => {
            const isPaid = inv.status === "paid";
            const isDraft = inv.status === "draft";
            const isOverdue = inv.status === "overdue";

            return (
              <div
                key={inv.id}
                className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] flex flex-wrap items-center justify-between gap-4 transition-all hover:border-[var(--color-primary)]/40 shadow-sm"
              >
                <div className="space-y-1 min-w-[200px]">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm text-[var(--color-foreground)]">
                      #{inv.number}
                    </span>
                    {isPaid ? (
                      <Badge className="bg-emerald-100 text-emerald-800 text-[10px] border-none">Paid</Badge>
                    ) : isDraft ? (
                      <Badge className="bg-slate-100 text-slate-700 text-[10px] border-none">Draft</Badge>
                    ) : isOverdue ? (
                      <Badge className="bg-rose-100 text-rose-800 text-[10px] border-none">Overdue</Badge>
                    ) : (
                      <Badge className="bg-blue-100 text-blue-800 text-[10px] border-none">Sent</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[var(--color-muted-foreground)]">
                    <span>Issued: {inv.issueDate}</span>
                    <span>•</span>
                    <span>Due: {inv.dueDate}</span>
                  </div>
                  {inv.notes ? <p className="text-[11px] text-[var(--color-muted-foreground)] italic">{inv.notes}</p> : null}
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <div className="font-mono font-bold text-base text-[var(--color-foreground)]">
                      ${Number(inv.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-[11px] text-[var(--color-muted-foreground)]">
                      {isPaid ? "Paid in full" : `Balance: $${Number(inv.balanceDue ?? inv.total).toFixed(2)}`}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Send / Mark Sent Action */}
                    {isDraft ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs gap-1"
                        onClick={() => handleSendInvoice(inv)}
                      >
                        <Send className="h-3.5 w-3.5" /> Send
                      </Button>
                    ) : null}

                    {/* Copy Details */}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1"
                      onClick={() => copyPaymentText(inv)}
                      title="Copy invoice details"
                    >
                      {copiedId === inv.id ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-600" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" /> Copy Details
                        </>
                      )}
                    </Button>

                    {/* Record Payment Action */}
                    {!isPaid ? (
                      <Button
                        size="sm"
                        className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => {
                          setSelectedInvoice(inv);
                          setPaymentAmount(inv.balanceDue ?? inv.total);
                          setShowPayModal(true);
                        }}
                      >
                        <CreditCard className="h-3.5 w-3.5" /> Record Payment
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CREATE INVOICE MODAL */}
      {showCreateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl max-h-[90vh] overflow-y-auto">
            <CardHeader className="pb-3 border-b border-[var(--color-border)]">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Create New Invoice</span>
                <span className="text-sm font-mono text-[var(--color-primary)]">
                  Total: ${invoiceTotal.toFixed(2)}
                </span>
              </CardTitle>
              <CardDescription className="text-xs">
                Bill {clientName || "this client"} for tax preparation, compliance, or advisory services.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleCreateInvoice}>
              <CardContent className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Issue Date</Label>
                    <Input
                      type="date"
                      value={issueDate}
                      onChange={(e) => setIssueDate(e.target.value)}
                      required
                      className="mt-1 h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Due Date</Label>
                    <Input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      required
                      className="mt-1 h-8 text-xs"
                    />
                  </div>
                </div>

                {/* Line Items */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold">Service Line Items</Label>
                    <Button type="button" size="sm" variant="ghost" className="h-6 text-xs text-[var(--color-primary)]" onClick={addLine}>
                      + Add Item
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {lines.map((line, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Input
                          placeholder="Description (e.g. 1040 Schedule C Preparation)"
                          value={line.description}
                          onChange={(e) => updateLine(idx, "description", e.target.value)}
                          required
                          className="flex-1 h-8 text-xs"
                        />
                        <Input
                          type="number"
                          placeholder="Qty"
                          min="1"
                          value={line.quantity}
                          onChange={(e) => updateLine(idx, "quantity", Number(e.target.value))}
                          required
                          className="w-16 h-8 text-xs"
                        />
                        <Input
                          type="number"
                          placeholder="Price"
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(e) => updateLine(idx, "unitPrice", Number(e.target.value))}
                          required
                          className="w-24 h-8 text-xs"
                        />
                        {lines.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-rose-500 hover:text-rose-700"
                            onClick={() => removeLine(idx)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Notes / Memo to Client (Optional)</Label>
                  <Input
                    placeholder="Thank you for your business. Payment due within 15 days."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="mt-1 h-8 text-xs"
                  />
                </div>

                <div className="pt-3 border-t border-[var(--color-border)] flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setShowCreateModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" className="h-8 text-xs" disabled={creating}>
                    {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                    Save & Create Invoice
                  </Button>
                </div>
              </CardContent>
            </form>
          </Card>
        </div>
      ) : null}

      {/* RECORD PAYMENT MODAL */}
      {showPayModal && selectedInvoice ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl">
            <CardHeader className="pb-3 border-b border-[var(--color-border)]">
              <CardTitle className="text-base">Record Payment for #{selectedInvoice.number}</CardTitle>
              <CardDescription className="text-xs">
                Total Balance: ${Number(selectedInvoice.balanceDue ?? selectedInvoice.total).toFixed(2)}
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleRecordPayment}>
              <CardContent className="space-y-4 pt-4">
                <div>
                  <Label className="text-xs">Payment Amount ($)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(Number(e.target.value))}
                    required
                    className="mt-1 h-8 text-xs"
                  />
                </div>

                <div>
                  <Label className="text-xs">Payment Method</Label>
                  <select
                    value={paymentMethod}
                    onChange={(e: any) => setPaymentMethod(e.target.value)}
                    className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-xs text-[var(--color-foreground)] outline-none"
                  >
                    <option value="credit_card">Credit / Debit Card (Stripe)</option>
                    <option value="ach">ACH Bank Transfer</option>
                    <option value="check">Paper Check</option>
                    <option value="cash">Cash</option>
                    <option value="wire">Wire Transfer</option>
                  </select>
                </div>

                <div>
                  <Label className="text-xs">Reference / Check # (Optional)</Label>
                  <Input
                    placeholder="Check #1042 or Stripe confirmation"
                    value={paymentRef}
                    onChange={(e) => setPaymentRef(e.target.value)}
                    className="mt-1 h-8 text-xs"
                  />
                </div>

                <div className="pt-3 border-t border-[var(--color-border)] flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setShowPayModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={recordingPayment}
                  >
                    {recordingPayment ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                    Confirm Payment
                  </Button>
                </div>
              </CardContent>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
