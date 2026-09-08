# Folio Replacement Scorecard (2026-09-07)

Estimate of what percentage of Phyllis's normal work Folio can currently replace, and what remains, scored against the feature matrix and pain point analysis in this folder. This is an estimate for planning purposes, not a validated measurement. Section 8's acceptance matrix is the mechanism for real measurement once Phyllis is using the product.

## Scoring basis

Percentage reflects estimated share of her weekly hours across bookkeeping, tax prep, and client management that could be performed inside Folio without opening Wave, Excel, or MyTAXPrepOffice, based on what already exists in the codebase (receipts, client documents, checklist, bank transactions, P&L, categories) plus what this milestone adds (engagements, work items, client requests, portal, work queue).

## Before this milestone (existing production Folio)

Estimated replacement: roughly 55 to 65 percent.
Covered: receipt intake and extraction, document checklist, bank transaction import and categorization, P&L reporting, client records.
Not covered: any work-tracking layer, any client-facing request or portal, any structured way to chase a missing document without leaving Folio for email.

## After this milestone

Estimated replacement: roughly 75 to 85 percent.
Newly covered: engagement and work-item tracking, client requests with automated preparation from bookkeeping exceptions, request threads, a client portal for uploads and status, a firm-wide work queue, service templates for the three named engagement types.
Still not covered inside Folio: full double-entry ledger and AR and AP (Milestone 2), any QuickBooks-side operations if a firm is QBO-standardized (Milestone 3), direct bank connections beyond CSV (Milestone 4), invoicing and payments (Milestone 5), e-signature (Milestone 6), the tax preparation and e-file step itself (Milestones 7 and 8).

## Path to 90-95 percent

The remaining 10 to 20 percentage points are concentrated in two things Phyllis currently does outside Folio for every engagement: the tax-return preparation step in MyTAXPrepOffice, and, for any client already on QuickBooks, native QBO bookkeeping actions. Closing those requires Milestones 2, 3, and 7 to 8, in that dependency order, per the roadmap doc. Reaching 90-95 percent without a tax-return engine is possible only if tax preparation itself is treated as an exceptional fallback to MyTAXPrepOffice with all supporting evidence and organizer data already prepared in Folio, which is the stated approach in Section 7's Tax Workbench scope for the near term.

## Caveat

Do not report either the pre- or post-milestone percentage to Phyllis as an achieved result. These are engineering estimates against known feature coverage, not measured time-in-app data. Section 8's acceptance matrix and the beta acceptance script are the only valid source of a measured percentage, and only once she is actually using the product.
