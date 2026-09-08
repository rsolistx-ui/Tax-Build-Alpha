# QuickBooks Integration Decision (2026-09-07)

This decision record precedes any QuickBooksOnlineAccountingProvider implementation. Per the locked product strategy, QuickBooks Online is an optional adapter, never a requirement, and never the primary UI. Folio's own domain model remains canonical for clients, evidence, workflow, requests, audit, and tax readiness.

## Verified current QBO developer platform facts (2026-09-07)

OAuth model: OAuth 2.0 Authorization Code flow through Intuit's identity platform. Access tokens expire after one hour; a refresh token obtains a new access token without re-prompting the user for consent.

Sandbox availability: yes, a distinct sandbox environment and base URL exist, separate from production, for development and testing before an app is submitted for production keys.

Production approval: Intuit requires an app review and approval process before an app can request production-scope access from real company files; this is a gated, non-instant process, not a self-serve token grant.

Rate limits: 500 requests per minute per company, realm ID, with a maximum of 10 concurrent requests per realm in production. The batch endpoint has a separate, lower throttle of 40 requests per minute per realm.

Pricing model change: Intuit's App Partner Program introduced tiered platform service fees, announced May 15, 2025 and live since July 28, 2025. A free Builder tier includes 500,000 read calls per month; higher-volume or write-heavy usage moves into paid tiers. This is a real, current per-firm or per-app cost input, not a one-time integration cost.

API entities confirmed available: Invoice, Customer, Payment, Bill, Vendor, Account, ProfitAndLoss report, Purchase Order, Sales Receipt, Credit Memo, Item, Class, Department. Journal entries are supported for read and write. Webhooks exist and deliver Create, Update, Delete, Merge, and Void notifications across most core accounting entities including Invoice, Payment, Customer, Bill, and Vendor.

## The critical limitation: bank-feed data is NOT fully exposed

This was independently verified, not assumed. Per Intuit's own developer community and third-party integration guides: transactions that have already been posted or matched inside QuickBooks are queryable through the standard API like any other transaction type. However, transactions sitting in the For Review tab, meaning imported by QuickBooks's own bank feed but not yet categorized or matched by the user, are NOT accessible through the public API. Intuit's stated reason is that the underlying bank-feed pipeline itself depends on third-party aggregators, Plaid and Yodlee, under commercial and security terms that do not extend to exposing that unposted data to third-party apps.

Practical consequence for Folio: Folio cannot use the QBO API as a source of live, unreviewed bank-feed transactions. If Folio needs live bank data for a QBO-connected firm, it must either rely only on transactions QuickBooks has already posted, meaning after the firm's own bookkeeper has already reviewed them in QBO, defeating much of the exception-automation value, or obtain bank data independently through a direct bank-data provider, Plaid, Finicity, MX, Akoya, or Teller. This is exactly what the QBO developer community itself recommends: use a direct bank-data provider and push settled data into QuickBooks on your own terms, not the reverse.

## Supported operations for a Folio QBO adapter, if built

Read and write: Accounts, Vendors, Customers, Bills, Bill Payments, Purchases, Invoices, Payments, Journal Entries, Classes, Departments, Attachable document attachment metadata, and reports including Profit and Loss, Balance Sheet, and Trial Balance.
Read: Deposits and Transfers as posted transaction types, consistent with other posted-transaction entities.
Change notification: webhooks for the entities listed above, sufficient to build an incremental sync loop rather than full re-pulls.

## Unsupported or unverified operations

Not exposed: unposted or For Review bank-feed line items, meaning the actual bank-feed download stream a human sees in the QBO banking tab.
Not verified in this pass: a dedicated General Ledger entity distinct from the underlying transaction entities and reports; QBO's model exposes GL detail through reports and individual transaction entities rather than one GL endpoint, and this should be re-confirmed against the exact QBO API version Folio would target before implementation.
Not verified: exact current per-tier platform service fee schedule under the App Partner Program; the tiered model exists and a free Builder tier with 500,000 monthly read calls was confirmed, but specific paid-tier price points were not retrieved in this research pass and must be pulled from Intuit's current partner pricing page before committing to a per-firm cost estimate.

## Can a Folio user do supported accounting actions entirely through Folio, without opening QBO

For posted transactions and the core entities listed as supported, yes in principle, a native Folio UI can read, create, and update those records through the API and present them natively, per the no-iframe mandate. For anything touching the live bank-feed review step itself, no, that step structurally cannot be performed through the API today, and Folio would need its own bank-data source for that function regardless of whether a firm is on QuickBooks.

## Synchronization strategy

Poll on-demand for the entities a session is actively viewing, plus webhook-driven incremental sync for background freshness, given the 500 requests per minute per realm ceiling and 10-concurrent-request limit. Full-history backfills should run once at connection time, then rely on webhooks and change-timestamp queries, not repeated full re-pulls.

## Conflict strategy

Every synced record must preserve its QBO source ID and last-synced version marker. When a professional edits a record that later receives a conflicting webhook update, the conflict must surface as a visible, resolvable exception, per the locked product strategy, never a silent overwrite in either direction.

## Estimated per-firm operating cost

Bounded by two variables not fully resolved in this pass: the App Partner Program's paid-tier pricing above the free Builder tier, and per-firm call volume, which scales with client count and sync frequency. This must be modeled with real numbers before QBO adapter work begins in Milestone 3; treat as an open item, not a placeholder zero.

## Dependency risk

Intuit controls OAuth approval, rate limits, and pricing unilaterally, and has changed its developer monetization model as recently as mid-2025. A Folio strategy that depended on QBO as a required component would inherit that platform risk directly. The adapter-behind-an-abstraction design is the correct mitigation: Folio's own domain model stays canonical regardless of what Intuit does to its API terms.

## Migration and export strategy

Any firm connecting QBO must be able to disconnect without data loss: Folio's own domain model, not QBO's, is the system of record for clients, evidence, workflow, and audit history even when QBO is connected for accounting-side operations. Synced QBO entities should be treated as a mirrored, replaceable cache with source IDs, not the origin of truth for anything Folio itself generates.

## Data ownership implications

Evidence, workflow state, requests, audit trail, and tax readiness live in Folio's Neon schema regardless of QBO connection status. Only accounting entities that a firm chooses to keep in QBO, chart of accounts, ledger transactions, live there, mirrored into Folio for native display per the no-iframe mandate.

## Native versus QBO responsibility matrix

Folio native, always: clients, evidence, documents, workflow, engagements, work items, client requests, portal, audit, tax readiness, corrections, intelligence.
QBO, only if firm is connected: chart of accounts, ledger transactions, invoices, bills, vendor and customer accounting records, financial statement generation for that firm.
Folio native, even for QBO-connected firms: bank-feed review and exception handling, because QBO does not expose that data through the API; this must be either CSV import today or a future direct bank-data provider, feeding Folio's own bank-transaction model, with reconciled results optionally pushed to QBO as posted transactions.

## Decision

Build the AccountingProvider abstraction now, architecture only, this milestone. Do not implement QuickBooksOnlineAccountingProvider in this milestone. Defer actual QBO OAuth and sync work to Milestone 3, gated on resolving the per-firm cost model and re-verifying GL and report entity behavior against the exact API version targeted at that time.
