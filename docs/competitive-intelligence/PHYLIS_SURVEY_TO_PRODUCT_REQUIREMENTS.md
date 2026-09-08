# Phylis Survey to Product Requirements (2026-09-07)

This maps Phyllis's documented pain points directly to Folio product requirements. Source: direct conversation with Phyllis (recorded in the milestone brief), cross-referenced against competitor research in this same folder.

## Her stack today

- Wave Accounting: bookkeeping
- Excel: manual P&L construction, ad hoc analysis
- MyTAXPrepOffice: tax preparation and e-file

## Pain point to requirement mapping

Pain point: individually scanning receipts, boxes and batches of receipts and financial documents.
Requirement: bulk receipt intake with no artificial per-batch cap (Wave caps at 10 files; Folio must not).
Evidence: Wave Help Center bulk upload documentation, this folder's pain point analysis.

Pain point: transaction-by-transaction bank statement review.
Requirement: bank import and normalization with exception-first review, not full manual line review.
Evidence: existing Folio CSV bank-transaction pipeline (already in production) plus Section 12 exception-to-request automation.

Pain point: deciding business versus personal activity manually.
Requirement: merchant memory and suggested classification the professional approves, never auto-finalizes silently.
Evidence: Section 10 intelligence model, AI may suggest, never finalize.

Pain point: manually categorizing expenses.
Requirement: category suggestion with correction memory so repeated corrections are not repeated forever.
Evidence: Section 9 accounting metrics, professional correction rate.

Pain point: repetitive data entry.
Requirement: single evidence intake feeding both receipts and bank-transaction matching, no duplicate entry across tools.
Evidence: Section 6 bank data architecture, Section 12 exception automation.

Pain point: manually creating P&Ls in Excel.
Requirement: native reporting inside Folio, already partially built (existing pnl.ts service); this milestone does not rebuild the ledger but must keep P&L in Folio's own domain, not push her back into Excel.
Evidence: existing apps/api/src/services/pnl.ts and reporting.ts.

Pain point: repeatedly moving between programs.
Requirement: this is the core one-workspace mandate. Measured directly by the workspace metrics in Section 9, external-app launches required, context switches.
Evidence: Section 4, 90 to 95 percent of normal work without opening another application.

Pain point: repeated client-document chasing.
Requirement: exception-to-request automation, Section 12.E, so a missing document becomes a prepared, professional-approved client request automatically, not a manual email.
Evidence: this milestone's core deliverable.

Pain point: fragmented evidence and bookkeeping workflows.
Requirement: evidence must be a first-class relationship to the work that needs it, not a folder. Directly answers the TaxDome document-friction finding in the pain point analysis.

## Her number-one requested automation

BULK RECEIPT INTAKE WITH AUTOMATIC ORGANIZATION AND FILING.
Expected benefit: more than 10 hours per week saved.
Status: receipt intake and extraction already exist in Folio's production system from prior milestones (receipts, client_documents, checklist tables per the existing schema). This milestone adds the work-management and client-chasing layer around that existing capability; it does not rebuild receipt intake itself.

## Hard requirement restated

She wants to stay in one workspace. This is now a hard product requirement, not a nice-to-have, and is tracked explicitly as a workspace metric (external-app launches required) rather than asserted.

## What this milestone does and does not close

Closes: work management (engagements, work items), client requests, request threads, exception-to-request automation, client portal, work queue, service templates. This is the largest remaining leave-Folio surface for client chasing and status tracking.

Does not close: full native ledger, AR/AP and invoicing, paid bank aggregation, QuickBooks sync, e-signature, payroll, tax calculation engine, e-file. These are scoped into Milestones 2 through 8 per the roadmap doc in this folder.
