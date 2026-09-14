export const ORGANIZER_CHECKLIST: Record<string, Array<{ code: string; label: string; required: boolean }>> = {
  "1040": [
    { code: "w2", label: "W-2 Wages", required: true },
    { code: "1099int", label: "1099-INT", required: false },
    { code: "1099div", label: "1099-DIV", required: false },
    { code: "1099nec", label: "1099-NEC", required: false },
    { code: "k1", label: "K-1", required: false },
    { code: "prior_return", label: "Prior year return", required: true },
    { code: "id_docs", label: "ID / SSN docs", required: true },
  ],
  "1120": [
    { code: "prior_return", label: "Prior year 1120", required: true },
    { code: "trial_balance", label: "Trial balance / books", required: true },
    { code: "bank_statements", label: "Bank statements", required: true },
    { code: "loan_statements", label: "Loan statements", required: false },
  ],
  "1120S": [
    { code: "prior_return", label: "Prior year 1120S", required: true },
    { code: "trial_balance", label: "Trial balance / books", required: true },
    { code: "k1_prior", label: "Prior K-1s", required: false },
  ],
  "1065": [
    { code: "prior_return", label: "Prior year 1065", required: true },
    { code: "trial_balance", label: "Trial balance / books", required: true },
  ],
};

export function getOrganizerChecklist(taxForm: string) {
  return ORGANIZER_CHECKLIST[taxForm] ?? [];
}

export function getOrganizerPrefill(taxForm: string, priorYearData: Record<string, any> | null) {
  const checklist = getOrganizerChecklist(taxForm);
  if (!priorYearData) return checklist.map(c => ({ ...c, prefilled: false }));
  return checklist.map(c => ({ ...c, prefilled: Boolean(priorYearData[c.code]) }));
}
