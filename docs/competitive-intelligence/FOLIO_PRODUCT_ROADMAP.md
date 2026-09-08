# Folio Product Roadmap (2026-09-07)

Dependency-aware roadmap. This milestone (Unified Practice OS plus Exception-Driven Client Portal) is the only one implemented now. Everything below is planned, not built.

## This milestone

Unified Practice OS plus Exception-Driven Client Portal: engagements, work items, client requests, request threads, exception-to-request automation, client portal, practice work queue, service templates, reminder-preparation fields. Depends on: existing clients, receipts, bank-transaction, and client-document tables, all already in production.

## Milestone 2: Accounting Foundation

Canonical chart of accounts, double-entry ledger, journals, transaction posting, trial balance, balance sheet, period close, reconciliation, audit controls, FolioNativeAccountingProvider foundation. Depends on: this milestone's engagement and work-item model, so period close can be tracked as engagement lifecycle state.

## Milestone 3: QuickBooks Optional Provider

Only if research confirms value at implementation time. OAuth, account mapping, customer and vendor sync, transactions, journals, invoices and bills where supported, reports, webhook and change sync, conflict queue, sync audit. Depends on: Milestone 2's AccountingProvider interface existing as a real, exercised abstraction, not just a design doc; and a resolved per-firm cost model per the QBO decision doc in this folder. Folio UI remains primary; no iframe wrapper.

## Milestone 4: Bank Connectivity

Selected direct-bank provider, account linking, refresh, normalized transactions, disconnect and reconnect, connection health, CSV fallback preserved. Depends on: this milestone's BankFeedProvider interface; a provider selection decision informed by real research into Plaid, Finicity, MX, Akoya, and Teller pricing and reliability at the volume Folio actually needs, not assumed from marketing claims.

## Milestone 5: AR/AP and Billing

Customers and vendors, estimates and proposals, engagement letters, invoices, bills, payments, recurring billing, client payment portal. Depends on: Milestone 2's ledger existing, so invoices and bills post real accounting entries rather than being disconnected records.

## Milestone 6: Document and Signature System

Document versioning, templates, field placement, signature requests, signature evidence, KBA where required. Depends on: this milestone's document client-visibility flags and request threads, so a signature request is a specific request type rather than a separate disconnected flow.

## Milestone 7: Tax Workbench

Organizers, tax-source extraction, workpapers, prior-year comparison, tax questions, diagnostics, return data model, review queue, preparation status. Depends on: this milestone's engagement model for 1040, 1065, 1120, and 1120S service types, and the existing receipt and document extraction pipeline from prior milestones.

## Milestone 8: Regulated Return Engine

Separate program. Tax-year rules, federal calculations, state calculations, forms, IRS schemas, MeF, acknowledgements, rejection resolution, ATS and testing requirements, regulatory release process. Depends on: Milestone 7's tax workbench providing clean, reviewed source data; this is explicitly a separate regulated engineering track, not a natural extension of the workbench, and must not be started casually.

## Sequencing rationale

Accounting foundation (2) before QuickBooks (3), because the QBO adapter needs a real AccountingProvider interface to adapt to, not a placeholder. Bank connectivity (4) can proceed in parallel with 2 or 3 since it only depends on this milestone's BankFeedProvider interface. Billing (5) depends on the ledger existing (2) so invoices post real entries. Documents and signature (6) depends on this milestone's request and document-visibility model. Tax workbench (7) depends on this milestone's engagement types. The return engine (8) is deliberately last and separate, gated on 7 producing trustworthy source data, consistent with Section 10's rule that AI and automation may prepare and suggest but never silently finalize a tax position or filing.
