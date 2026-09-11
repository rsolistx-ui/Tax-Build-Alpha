# Phylis Acceptance Matrix

Status legend: NOT_STARTED, EXISTING (built in a prior milestone), THIS_MILESTONE (built now), PLANNED (future milestone per the roadmap).

Every measured field (time before/after, steps before/after, context switches before/after) is left blank until measured against Phyllis directly, per Section 8's instruction not to claim either the 10-hour or 90-95 percent target until measured. Do not fill these in from estimates.

## 1. Bulk receipt intake

Original pain point: individually scanning receipts, boxes and batches of documents.
Current manual workflow: scan or photograph each receipt individually, upload one at a time to Wave, capped at 10 per batch.
Folio replacement workflow: bulk receipt tray accepting a large batch in one intake action, existing production capability from a prior milestone.
Status: EXISTING.
Evidence of implementation: existing receipts and client_documents tables and intake routes in apps/api/src.
Production validation method: not yet measured with Phyllis.
Remaining gaps: this milestone does not change receipt intake itself; it connects a missing-receipt exception to an automated client request, see row 6.

## 2. Receipt extraction

Original pain point: manual reading and transcription of receipt data.
Current manual workflow: manual entry of vendor, amount, date into Wave.
Folio replacement workflow: automatic extraction via existing Workers AI pipeline.
Status: EXISTING.
Remaining gaps: none identified this milestone; extraction accuracy metrics not yet instrumented per Section 9.

## 3. Automatic client and category organization

Original pain point: manually filing and categorizing each document.
Folio replacement workflow: document checklist and category assignment on intake.
Status: EXISTING.
Remaining gaps: category suggestion memory, correction rate tracking, not yet instrumented.

## 4. Bank transaction review

Original pain point: transaction-by-transaction manual review of bank statements.
Folio replacement workflow: CSV import into the existing bank-transaction model with categorization.
Status: EXISTING.
Remaining gaps: exception-driven review, row 6, is new this milestone; full reconciliation workflow is Milestone 2.

## 5. Business versus personal classification

Original pain point: manually deciding business versus personal on every transaction.
Folio replacement workflow: existing categorization; AI may suggest, professional confirms, per Section 10.
Status: EXISTING.
Remaining gaps: not yet measured for correction rate.

## 6. Receipt-to-bank matching and missing-receipt handling

Original pain point: chasing missing receipts and matching them to bank activity by hand.
Folio replacement workflow: a bank transaction needing a receipt automatically prepares a client request, the professional approves it, the client uploads through the portal, the receipt enters the existing extraction flow and stays linked to the originating transaction and request.
Status: THIS_MILESTONE.
Evidence of implementation: client_requests, request_threads, and the exception-to-request service added this milestone.
Production validation method: production smoke test with a synthetic missing-receipt request end to end, per Section 17.
Remaining gaps: automated reminder sending is explicitly out of scope this milestone, only reminder-due fields are stored.

## 7. Missing-receipt handling generally

Covered by row 6; listed separately per the required minimum rows.
Status: THIS_MILESTONE.

## 8. Repetitive merchant categorization

Original pain point: re-categorizing the same recurring merchants repeatedly.
Folio replacement workflow: merchant-category corrections are stored per-client; future extractions from the same normalized merchant automatically inherit the remembered category. Agent approval of a categorization recommendation writes the rule.
Status: THIS_MILESTONE.
Evidence of implementation: `correction_rules` table, `applyCorrectionMemory` in `receipt-intake.ts:229`, `correctionRuleStatement` in `receipts.ts:413`, agent approval writes rule in `agent-supervisor.ts:76`, `GET /api/clients/:id/correction-rules` and the Merchant memory panel in `agent-panel.tsx`.
Remaining gaps: explicit "Folio remembered X for this merchant" confirmation inline in the receipt review flow.

## 9. P&L creation

Original pain point: manually building P&Ls in Excel.
Folio replacement workflow: existing native P&L reporting service.
Status: EXISTING.
Remaining gaps: full accounting foundation, ledger and trial balance, is Milestone 2.

## 10. Excel manipulation generally

Original pain point: repeated ad hoc spreadsheet construction outside any system of record.
Folio replacement workflow: native reporting reduces but does not yet eliminate all Excel use; full elimination depends on Milestone 2 and 5.
Status: PARTIAL, EXISTING plus PLANNED.

## 11. Tax-document collection

Original pain point: chasing W-2, 1099, K-1, prior returns, and organizer responses by email.
Folio replacement workflow: client request types for each document category, prepared automatically where possible, resolved through the portal.
Status: THIS_MILESTONE for the request and portal mechanism; PLANNED for tax-specific organizer prefill, Milestone 7.

## 12. Client chasing generally

Original pain point: the umbrella pain point behind rows 6, 7, and 11.
Folio replacement workflow: the exception-to-request-to-portal-to-resolution chain, Section 12.E.
Status: THIS_MILESTONE.
Evidence of implementation: client_requests, request_threads, portal authorization, work-item completion linkage.
Production validation method: cross-tenant isolation tests plus synthetic end-to-end smoke, Section 17.

## 13. Tax readiness

Original pain point: no clear view of whether a client's file is actually ready for preparation.
Folio replacement workflow: engagement status field, work-item completion, and the practice work queue surface readiness; full tax-readiness diagnostics are Milestone 7.
Status: PARTIAL, THIS_MILESTONE for engagement status, PLANNED for diagnostics.

## 14. Document review

Original pain point: reviewing documents scattered across email and folders.
Folio replacement workflow: documents remain attached to the work and request that needed them, not a folder.
Status: THIS_MILESTONE for the relationship model; EXISTING for underlying document storage.

## 15. Client communication

Original pain point: fragmented email threads per client per issue.
Folio replacement workflow: request threads tied to a specific request, visible to both professional and client within authorization boundaries.
Status: THIS_MILESTONE.

## 16. Engagement status

Original pain point: no shared, current view of where an engagement stands.
Folio replacement workflow: engagement status field plus the practice work queue.
Status: THIS_MILESTONE.

## 17. Billing

Original pain point: separate invoicing workflow outside the bookkeeping system.
Folio replacement workflow: not addressed this milestone.
Status: PLANNED, Milestone 5.

## 18. Tax-return preparation

Original pain point: full return preparation happens entirely in MyTAXPrepOffice, disconnected from Folio's evidence.
Folio replacement workflow: not addressed this milestone; Folio can prepare organizer data and evidence ahead of the MyTAXPrepOffice step once Milestone 7 exists.
Status: PLANNED, Milestone 7 and 8.

## 19. Signatures

Original pain point: separate e-signature tools or manual physical signatures.
Folio replacement workflow: not addressed this milestone; a signature-placeholder request type exists in the client-request schema for future wiring.
Status: PLANNED, Milestone 6.

## 20. Filing

Original pain point: e-file happens entirely outside Folio.
Folio replacement workflow: not addressed this milestone; separate regulated track.
Status: PLANNED, Milestone 8.

## 21. Overall app switching

Original pain point: repeatedly moving between Wave, Excel, MyTAXPrepOffice, and email.
Folio replacement workflow: measured directly as the workspace metric, external-app launches required, once instrumented.
Status: PARTIAL. This milestone closes the largest remaining switching cause, client chasing and work tracking, per the Folio Replacement Scorecard in docs/competitive-intelligence/. Full 90-95 percent target requires Milestones 2 through 8.

## Targets

Ten-plus hours per week returned: not claimed achieved. Requires measurement with Phyllis per docs/PHYLIS_BETA_ACCEPTANCE_SCRIPT.md, not run yet.
90-95 percent of normal work without leaving Folio: not claimed achieved. Estimated at 75-85 percent after this milestone per the Folio Replacement Scorecard; requires the remaining roadmap milestones plus real measurement to confirm.
