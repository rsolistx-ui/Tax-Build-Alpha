// Service-aware defaults for the three named engagement types, per the
// locked product strategy: prepared workflow, not an arbitrary pipeline
// builder. Each step becomes one work item attached to the new engagement.

export type ServiceTemplateStep = { title: string; workType: string };

const TEMPLATES: Record<string, ServiceTemplateStep[]> = {
  bookkeeping: [
    { title: "Import or receive activity", workType: "bookkeeping" },
    { title: "Collect evidence", workType: "bookkeeping" },
    { title: "Resolve exceptions", workType: "bookkeeping" },
    { title: "Categorize transactions", workType: "bookkeeping" },
    { title: "Reconcile accounts", workType: "bookkeeping" },
    { title: "Professional review", workType: "review" },
    { title: "Close period", workType: "bookkeeping" },
    { title: "Produce reporting", workType: "reporting" },
  ],
  monthly_close: [
    { title: "Import or receive activity", workType: "bookkeeping" },
    { title: "Collect evidence", workType: "bookkeeping" },
    { title: "Resolve exceptions", workType: "bookkeeping" },
    { title: "Categorize transactions", workType: "bookkeeping" },
    { title: "Reconcile accounts", workType: "bookkeeping" },
    { title: "Professional review", workType: "review" },
    { title: "Close period", workType: "bookkeeping" },
    { title: "Produce reporting", workType: "reporting" },
  ],
  tax_1040: [
    { title: "Intake", workType: "tax_prep" },
    { title: "Send organizer", workType: "tax_prep" },
    { title: "Collect source documents", workType: "tax_prep" },
    { title: "Professional review", workType: "review" },
    { title: "Ready for preparation", workType: "tax_prep" },
  ],
  tax_1065: [
    { title: "Intake", workType: "tax_prep" },
    { title: "Collect source documents", workType: "tax_prep" },
    { title: "Confirm bookkeeping readiness", workType: "bookkeeping" },
    { title: "Financial review", workType: "review" },
    { title: "Professional review", workType: "review" },
    { title: "Ready for preparation", workType: "tax_prep" },
  ],
  tax_1120: [
    { title: "Intake", workType: "tax_prep" },
    { title: "Collect source documents", workType: "tax_prep" },
    { title: "Confirm bookkeeping readiness", workType: "bookkeeping" },
    { title: "Financial review", workType: "review" },
    { title: "Professional review", workType: "review" },
    { title: "Ready for preparation", workType: "tax_prep" },
  ],
  tax_1120s: [
    { title: "Intake", workType: "tax_prep" },
    { title: "Collect source documents", workType: "tax_prep" },
    { title: "Confirm bookkeeping readiness", workType: "bookkeeping" },
    { title: "Financial review", workType: "review" },
    { title: "Professional review", workType: "review" },
    { title: "Ready for preparation", workType: "tax_prep" },
  ],
};

export function getServiceTemplateSteps(serviceType: string): ServiceTemplateStep[] {
  return TEMPLATES[serviceType] ?? [];
}
