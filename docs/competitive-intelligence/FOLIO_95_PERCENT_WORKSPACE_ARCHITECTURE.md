# Folio 95 Percent Workspace Architecture (2026-09-07)

This is the target-state architecture for the one-workspace product. This document describes design intent for the full roadmap; only the pieces in Section 12 of the milestone brief are implemented now. Everything else here is architecture, not a build commitment for this milestone.

## Provider abstractions

AccountingProvider: canonical interface for chart of accounts, transactions, invoices, bills, and financial reports. Implementations: FolioNativeAccountingProvider (Milestone 2), QuickBooksOnlineAccountingProvider (Milestone 3, gated per the QBO decision doc in this folder). A firm picks one active provider; Folio's own domain model, clients, evidence, workflow, requests, audit, stays canonical regardless of which provider is active.

BankFeedProvider: canonical interface that normalizes bank activity into Folio's existing bank-transaction model. Implementations: CSVImportBankFeedProvider, the current production path, which must not break; future PlaidBankFeedProvider, FinicityBankFeedProvider, MXBankFeedProvider, or another provider once research in Milestone 4 selects one. This interface exists specifically so a future direct bank connection does not require rewriting bookkeeping logic downstream of it.

## Workspace surfaces (target state, not all built now)

Home and Operations: firm-wide command center, deadlines, work queue, exceptions, waiting-on-client, team workload, recent activity, critical alerts. Partially built this milestone via the Operations Command Center integration in Section 12.K.
Client CRM: identity, entity, contacts, addresses, tax profile, services, engagement history, communication, notes, account sources, documents, deadlines. Client identity and documents already exist; engagement history is added this milestone.
Engagements: bookkeeping, monthly close, quarterly work, 1040, 1065, 1120, 1120S, payroll and compliance, advisory, custom. Built this milestone (Section 12.A) with the three named service templates.
Client Requests and Portal: built this milestone (Sections 12.C, 12.D, 12.F).
Receipts: already in production from prior milestones; this milestone connects receipt requests into the new request and work-item model rather than rebuilding intake.
Banking: existing CSV import and categorization stays; exception-to-request automation (Section 12.E) is new this milestone.
Accounting: chart of accounts, ledger, journals, trial balance, balance sheet, reconciliation, period close remain Milestone 2 scope, not built now.
Documents: existing document model; this milestone adds client-visible flags used by the portal.
Tax Workbench: organizer, checklist, extraction, prior-year comparison, workpapers, diagnostics, preparer review remain Milestone 7 scope.
Billing: Milestone 5 scope.
Filing: Milestone 8 scope, a separate regulated engineering track.

## Tenancy and scale design

Every tenant-owned table carries firm_id; client-scoped tables also carry client_id. All new tables in this milestone follow the existing pattern already established by clients, receipts, and client_documents. Work-queue and request-listing queries are indexed on (firm_id, status, due date or created_at) and paginated with cursor-based pagination, matching the existing pagination pattern already used elsewhere in the API, rather than loading full firm history client-side. Portal-facing queries additionally filter by client_id server-side; the client-facing API surface never trusts a client-supplied firm_id or client_id, it derives both from the authenticated session.

## Measurement architecture

The metrics in Section 9 of the milestone brief, receipt, bank, client-request, accounting, workspace, and tax metrics, are not implemented as a dashboard in this milestone. This milestone's Operations Command Center surfaces the subset directly relevant to work management: open engagements, waiting-on-client count, overdue work, due work, request aging. Full metrics instrumentation across all six categories is deferred until enough real usage exists to make the numbers meaningful, consistent with Section 9's own acceptance principle that no target is claimed as achieved until measured.
