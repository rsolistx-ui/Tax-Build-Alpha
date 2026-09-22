import { useState, useEffect, useCallback } from "react";
import { Repeat, Plus, Trash2, PlayCircle, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface WorkflowStep {
  title: string;
  daysOffset: number;
}

interface ServiceTemplate {
  id: string;
  serviceType: string;
  name: string;
  steps: WorkflowStep[];
}

interface Subscription {
  id: string;
  templateId: string;
  recurrence: "once" | "monthly" | "quarterly" | "annually";
  nextRunDate: string;
  isActive: boolean;
}

const RECURRENCE_OPTIONS: Subscription["recurrence"][] = ["once", "monthly", "quarterly", "annually"];

export function RecurringWorkPanel({ clientId }: { clientId: string }) {
  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showBuilder, setShowBuilder] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [steps, setSteps] = useState<WorkflowStep[]>([{ title: "", daysOffset: 0 }]);

  const [subscribeTemplateId, setSubscribeTemplateId] = useState("");
  const [recurrence, setRecurrence] = useState<Subscription["recurrence"]>("annually");
  const [firstRunDate, setFirstRunDate] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [templatesRes, subsRes] = await Promise.all([
        api<{ templates: ServiceTemplate[] }>(`/api/workflow-templates/templates`),
        api<{ subscriptions: Subscription[] }>(`/api/workflow-templates/${clientId}/subscriptions`),
      ]);
      setTemplates(templatesRes.templates || []);
      setSubscriptions((subsRes.subscriptions || []).filter((s) => s.isActive));
      setSubscribeTemplateId((prev) => prev || templatesRes.templates?.[0]?.id || "");
    } catch (err: any) {
      setError(err?.message || "Failed to load recurring work.");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  function addStepRow() {
    setSteps((prev) => [...prev, { title: "", daysOffset: 0 }]);
  }

  function removeStepRow(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function updateStep(index: number, patch: Partial<WorkflowStep>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  async function handleCreateTemplate(e: React.FormEvent) {
    e.preventDefault();
    const cleanSteps = steps.filter((s) => s.title.trim().length > 0);
    if (cleanSteps.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/workflow-templates/templates`, {
        method: "POST",
        body: JSON.stringify({ name: templateName, serviceType: serviceType || templateName, steps: cleanSteps }),
      });
      setShowBuilder(false);
      setTemplateName("");
      setServiceType("");
      setSteps([{ title: "", daysOffset: 0 }]);
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to create template.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubscribe() {
    if (!subscribeTemplateId) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/workflow-templates/${clientId}/subscriptions`, {
        method: "POST",
        body: JSON.stringify({ templateId: subscribeTemplateId, recurrence, firstRunDate }),
      });
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to subscribe this client.");
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyNow(templateId: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/workflow-templates/${clientId}/apply-now`, {
        method: "POST",
        body: JSON.stringify({ templateId, anchorDate: new Date().toISOString().slice(0, 10) }),
      });
    } catch (err: any) {
      setError(err?.message || "Failed to apply this checklist.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelSubscription(id: string) {
    setBusy(true);
    try {
      await api(`/api/workflow-templates/subscriptions/${id}`, { method: "DELETE" });
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to cancel.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="py-6 text-center">
        <Loader2 className="h-5 w-5 animate-spin mx-auto text-[var(--color-primary)]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-foreground)] flex items-center gap-1.5">
            <Repeat className="h-4 w-4" /> Recurring Work
          </h2>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Build a checklist once (e.g. "every March, prepare the 1040"), then it runs itself on schedule.
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowBuilder((v) => !v)}>
          <Plus className="h-3.5 w-3.5" /> New template
        </Button>
      </div>

      {error ? (
        <div className="rounded-md bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">{error}</div>
      ) : null}

      {showBuilder ? (
        <Card className="border-[var(--color-border)]">
          <CardContent className="p-4 space-y-3">
            <form onSubmit={handleCreateTemplate} className="space-y-3">
              <div className="flex flex-wrap gap-3">
                <div className="flex-1 min-w-[160px]">
                  <Label className="text-xs">Template name</Label>
                  <Input className="h-8 text-xs" placeholder="Annual 1040 Prep" value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)} required />
                </div>
                <div className="flex-1 min-w-[160px]">
                  <Label className="text-xs">Service type</Label>
                  <Input className="h-8 text-xs" placeholder="1040_prep" value={serviceType}
                    onChange={(e) => setServiceType(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Steps (in order)</Label>
                {steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input className="h-8 text-xs flex-1" placeholder="Send organizer" value={step.title}
                      onChange={(e) => updateStep(i, { title: e.target.value })} />
                    <Input className="h-8 text-xs w-28" type="number" placeholder="Day offset"
                      value={step.daysOffset} onChange={(e) => updateStep(i, { daysOffset: Number(e.target.value) })} />
                    <button type="button" onClick={() => removeStepRow(i)} className="text-[var(--color-muted-foreground)] hover:text-rose-600">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={addStepRow}>
                  <Plus className="h-3.5 w-3.5" /> Add step
                </Button>
              </div>

              <div className="flex gap-2">
                <Button size="sm" type="submit" disabled={busy} className="h-8 text-xs">Save template</Button>
                <Button size="sm" type="button" variant="ghost" className="h-8 text-xs" onClick={() => setShowBuilder(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {templates.length === 0 ? (
        <p className="text-xs text-[var(--color-muted-foreground)]">No templates yet. Create one above to start automating recurring checklists.</p>
      ) : (
        <Card className="border-[var(--color-border)]">
          <CardContent className="p-4 space-y-3">
            <span className="text-xs font-semibold text-[var(--color-foreground)]">Subscribe this client</span>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[160px]">
                <Label className="text-xs">Template</Label>
                <select
                  className="h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs text-[var(--color-foreground)]"
                  value={subscribeTemplateId}
                  onChange={(e) => setSubscribeTemplateId(e.target.value)}
                >
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="w-32">
                <Label className="text-xs">Recurrence</Label>
                <select
                  className="h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs text-[var(--color-foreground)]"
                  value={recurrence}
                  onChange={(e) => setRecurrence(e.target.value as Subscription["recurrence"])}
                >
                  {RECURRENCE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="w-36">
                <Label className="text-xs">First run</Label>
                <Input className="h-8 text-xs" type="date" value={firstRunDate} onChange={(e) => setFirstRunDate(e.target.value)} />
              </div>
              <Button size="sm" className="h-8 text-xs" disabled={busy} onClick={handleSubscribe}>Subscribe</Button>
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1" disabled={busy || !subscribeTemplateId}
                onClick={() => handleApplyNow(subscribeTemplateId)}>
                <PlayCircle className="h-3.5 w-3.5" /> Apply now
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {subscriptions.length > 0 ? (
        <Card className="border-[var(--color-border)]">
          <CardContent className="p-4 space-y-2">
            <span className="text-xs font-semibold text-[var(--color-foreground)]">Active subscriptions</span>
            <div className="divide-y divide-[var(--color-border)]">
              {subscriptions.map((sub) => {
                const template = templates.find((t) => t.id === sub.templateId);
                return (
                  <div key={sub.id} className="flex items-center justify-between py-2 text-xs">
                    <span className="text-[var(--color-foreground)]">{template?.name ?? sub.templateId}</span>
                    <span className="text-[var(--color-muted-foreground)]">{sub.recurrence} · next {sub.nextRunDate}</span>
                    <button onClick={() => handleCancelSubscription(sub.id)} className="text-[var(--color-muted-foreground)] hover:text-rose-600">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
