# Competitor Feature Matrix (2026)

Research date: 2026-09-07. Sources are cited inline; see individual analysis docs for full citations.

## Legend
Y = confirmed present, P = partial/plan-gated, N = not present, ? = unverified from public sources.

| Capability | QuickBooks Online | Wave | Xero | TaxDome | Canopy | Financial Cents | Karbon | MyTAXPrepOffice |
|---|---|---|---|---|---|---|---|---|
| Double-entry ledger / GL | Y | Y | Y | N (uses QBO) | N | N | N | N/A (tax only) |
| Bank feed import (bank-owned connection) | Y (via Plaid/Yodlee under the hood) | Y | Y | N | N | N | N | N/A |
| Bank feed via public API for pending items | **N** (see QUICKBOOKS_INTEGRATION_DECISION.md) | N/A | ? | N/A | N/A | N/A | N/A | N/A |
| Receipt OCR / extraction | P (Receipts add-on) | P (Pro-plan gated as of June 2026) | Y (Hubdoc) | N (documents only) | N | N | N | Y (AI source-doc extraction) |
| Bulk receipt intake (>10 at once) | ? | **N** (capped at 10 files/batch) | ? | N/A | N/A | N/A | N/A | Y (multi-doc upload) |
| Client portal | N (separate Intuit product) | N | N | Y | Y | Y | Y | Y |
| Document requests / checklists | N | N | N | Y | Y | Y | P | Y |
| E-signature | N | N | N | Y | Y | Y | P | Y (remote signatures) |
| Practice workflow / pipelines | N | N | N | Y | Y | Y | Y | N |
| CRM (contacts, engagements) | P | N | N | Y | Y | Y | Y | P (client mgmt) |
| Billing / invoicing / recurring billing | Y | Y | Y | Y | Y | Y | Y | N |
| Tax preparation / e-file | N | N | N | N | N | N | N | Y |
| Tax organizer | N | N | N | Y | Y | P | N | Y |
| P&L / Balance Sheet / Trial Balance reports | Y | Y | Y | N (relies on QBO) | N | N | N | N/A |
| QBO integration | native | N | N | Y | Y | Y | Y | N |
| Native mobile app | Y | Y | Y | Y | Y | P | Y | P |

## Tax preparation desktop/professional suites (added after the release-gate audit)

Research date: 2026-09-07. Facts below come from each vendor's own pricing/feature pages and independent review roundups (Capterra, aggregator sites); pain themes are labeled USER-REPORTED COMPLAINT, not verified defects.

| Capability | Intuit ProConnect Tax | Drake Tax | UltraTax CS (Thomson Reuters) |
|---|---|---|---|
| Pricing model | Pay-per-return from about $95/return, or feature-tier annual | Volume tiers (Pro line, 1040 line) plus pay-per-return; promotional pricing before Dec 1 rate reset | Custom-quoted, about $1,650/year base plus $150/user setup for a mid-sized firm |
| Client portal | Free built-in client portal | Portal via add-on/integration | Portal via eSignature add-on module |
| QBO integration | Deep native integration (same vendor) | Third-party/import-based | Integrates with Thomson Reuters Accounting CS / Practice CS |
| e-file | Yes | Yes, federal and state, with error-checking | Yes, federal and state |
| AI/OCR source-document extraction | Not confirmed in this pass | Gruntworx add-on reduces data entry | Not confirmed in this pass |
| Capterra review population (2026-09-07) | 23 reviews, 87% positive / 9% neutral / 4% negative | Not confirmed in this pass | Not confirmed in this pass |
| USER-REPORTED COMPLAINT | Pay-per-return pricing expensive for low-volume firms; recent price increases for new integrations | Outdated UI; unclear plan/refund terms alongside price increases | Slow with large client databases; cannot open multiple returns at once |

## Key takeaways for Folio

1. No competitor combines **native bookkeeping + native tax workbench + client portal + document/evidence workflow** in one system. QBO/Wave/Xero own accounting but have no portal or tax layer. TaxDome/Canopy/Financial Cents/Karbon own portal + workflow but have no ledger and depend on QBO for accounting. MyTAXPrepOffice owns tax prep but has no bookkeeping or workflow layer.
2. This gap is exactly the "leave Folio" surface Phyllis experiences today (Wave for books, Excel for P&L, MyTAXPrepOffice for tax, email/paper for documents) — see `PHYLIS_SURVEY_TO_PRODUCT_REQUIREMENTS.md`.
3. Wave's receipt bulk-import cap (10 files) and its June 2026 move of OCR behind the Pro plan directly validate Phyllis's #1 requested automation (bulk receipt intake) as a genuine, currently-unserved gap, not a solved problem competitors already do well.
4. QBO's public API does not expose pending/uncategorized bank-feed transactions (only posted ones) — this constrains any "QBO as bank source" strategy; see `QUICKBOOKS_INTEGRATION_DECISION.md`.

Sources:
- [Wave Software Pricing, Alternatives & More 2026 | Capterra](https://www.capterra.com/p/178021/Wave-Apps/)
- [Wave Accounting's Bank Feeds and Collaborator Paywall: What Changed in June 2026](https://beancount.io/blog/2026/08/05/wave-accounting-bank-feeds-collaborator-paywall-guide)
- [Scan and upload your receipts – Wave Help Center](https://support.waveapps.com/hc/en-us/articles/360059848112-Scan-and-upload-your-receipts)
- [TaxDome Reviews 2026 | Capterra](https://www.capterra.com/p/186749/TaxDome/reviews/)
- [10 best client portals for accountants in 2026 - TaxDome](https://taxdome.com/blog/client-portals-for-accountants)
- [Financial Cents Vs Canopy](https://financial-cents.com/financial-cents-vs-canopy/)
- [Financial Cents Vs Karbon](https://financial-cents.com/financial-cents-vs-karbon/)
- [MyTAXPrepOffice Reviews 2026 | Capterra](https://www.capterra.com/p/179883/my-TAXprep-office/reviews/)
- [i want to fetch bank feed pending transactions in my APP is it possible? - Intuit Developer](https://help.developer.intuit.com/s/question/0D5TR00001JtbjS0AR/i-want-to-fetch-bank-feed-pending-trasnactions-in-my-app-is-it-possible)
