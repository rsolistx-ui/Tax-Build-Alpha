# Survey-to-Release Evidence Audit — 09/20/2026

## Status

**In progress — not ready to represent as a fully autonomous, production-ready replacement for every existing tool.**

This audit compares the single response in `Business Systems & Workflow Discovery_Submissions_2026-09-20.csv` with the current source tree, automated checks, and deployed Cloudflare Worker. It deliberately separates source evidence from production configuration and from unperformed pilot validation.

## What the survey actually asks for

The respondent provides accounting, bookkeeping, and tax-preparation services using Excel, Wave Accounting, and My Tax Prep Office. Their specific operational pain is:

1. scanning receipts one at a time;
2. deciding whether bank-statement activity is business or personal; and
3. manually producing monthly and annual P&Ls in categories such as hotel, travel, food, and supplies.

They estimate that solving those problems would save **more than 10 hours per week**. The response does **not** itself ask for DocuSign replacement, SMS workflows, direct bank feeds, autonomous overnight work, or state-tax engines.

## Evidence matrix

| Survey need | What the repository implements | Evidence status | Release assessment |
|---|---|---|---|
| Bulk receipt intake | Upload tray accepts multiple PNG/JPG/WEBP/PDF files; each is stored, extracted, categorized, and routed to Review. A failed extraction preserves the source and becomes `Unreadable / Blurry Receipt (Manual Review)`. | Source and unit-test evidence; no real-client end-to-end pilot yet. | Strong match, but validate on Phyllis's actual scans before making time-saving claims. |
| Human review of bad receipts | Review queue exposes source evidence, confidence/validation signals, manual corrections, approval, and replacement-request action. | Source and unit-test evidence. | Strong match. Confirm mobile and accessibility behavior in a pilot. |
| Business vs. personal bank decisions | Bank CSV preview/import, disposition choices, reconciliation, and completeness-gated cash P&L logic exist. The P&L only includes eligible, resolved business activity. | Source and unit-test evidence. | Strong match for manual CSV workflow. No live bank-feed provider is configured. |
| Monthly and yearly categorized P&Ls | Reporting ranges and a cash-derived P&L endpoint/UI exist. | Source and unit-test evidence. | Match with an important boundary: this is not accrual accounting or a replacement for a regulated tax-preparation calculation engine. |
| Wave migration | UI and API support CSV import marketed for Wave standard exports. | Source evidence only; no representative Wave export run against a controlled tenant. | Needs a real import rehearsal. Do not promise one-click, lossless Wave migration yet. |
| My Tax Prep Office handoff | Tax Bridge creates copy-ready Schedule C values for manual paste. | Source evidence. | Do **not** call this an integration, sync, connector, or automated filing bridge. |
| Ordinary document signing | Native signing, certificate/audit data, and sealed document storage are implemented. | Source/tests; current production provider secrets are absent. | Use for in-house ordinary documents only until legal review and a real signing workflow are validated. Form 8879/remote tax authorization claims must remain excluded. |

## Production configuration facts (09/20/2026)

The deployed Worker health endpoint is reachable, reports Workers AI enabled, and reports **Queues disabled**. Its current static-asset references match the locally built web assets. Unauthenticated client, admin, and portal requests returned `401`.

The deployed secret inventory contains only `BETTER_AUTH_SECRET`, `DATABASE_URL`, `GROQ_API_KEY`, `OWNER_EMAIL`, and `SMOKE_CLEANUP_TOKEN`. Therefore the following code paths are **not configured as live production services**:

- Cloudflare Turnstile;
- 64-hex admin master token and separate power-user email;
- Telegram notifications;
- Resend/sender configuration for outbound email;
- Plaid/Teller bank feeds;
- QuickBooks OAuth;
- Stripe;
- Google Calendar; and
- any configured SMS carrier credentials.

Code presence is not production activation. The public login currently shows no Turnstile widget, which matches the absent Turnstile keys.

## Release blockers

### P0 — Correct misleading client data before any pilot

`apps/web/src/pages/client-workspace.tsx` presents hard-coded values as "Live stats": income `$9,700`, expenses `$5,600`, net profit `$4,100`, and `39` receipts. The same overview includes placeholder open-request and activity values. This is unacceptable in a financial client workspace. Replace these with verified API-derived values or an explicit empty/onboarding state.

The separate `/analytics` page is also not release-safe: it renders arbitrary revenue/cost graph percentages, describes systems as "Live," "Configured," and "Ready," and its apparent token check is not the production owner-token middleware. Remove it from public navigation or rebuild it against a verified owner-only metrics contract before it is presented to any user.

### P0 — Do not expose the current public inbound-SMS route

`POST /api/sms/inbound` accepts form fields without carrier signature verification and fetches `MediaUrl0` directly. It needs carrier webhook signature validation, approved media-host validation, bounded/typed download handling, and security tests before it receives public traffic. The current UI's "SMS Receipt Drop" capability is not evidence of safe carrier integration.

### P0 — Remove unsupported product/security claims

Turnstile is optional and unconfigured; its server route returns a simulated success when no secret is present. A master admin token is also unconfigured. Neither may be described as a live third factor or active superadmin lock.

The DIF feature must be renamed and constrained as an **internal pre-filing risk heuristic**. The IRS's actual DIF formula is confidential; source copy currently implies access to it and makes unsupported assertions about audit selection. It should never be marketed as an IRS audit probability or a penalty shield.

### P1 — Establish a controlled production-like acceptance run

All current automated checks passed at audit time: 430 API tests, 81 web tests, and 42 script tests (553 total), plus API/web TypeScript checks. These are meaningful regression evidence, but they do not prove a real tenant's receipt → review → bank CSV → P&L → export journey.

The existing production smoke tooling requires a real non-placeholder Neon connection configured locally; one was not available for this audit. Run a disposable test-firm journey with representative receipts, a real Wave CSV export, a mixed business/personal bank CSV, and P&L reconciliation before inviting a real client.

### P1 — Fix direct-upload contract and language

The so-called direct upload creates a Worker URL and streams through the Worker into R2; it is not a browser-to-R2 presigned upload. The API returns a `100MB` maximum but does not enforce file size/type or consume its issued upload ticket. Either implement a signed, bounded direct-to-R2 contract or call this a streamed document upload and cap/enforce it accurately.

### P1 — Make navigation and modal interactions accessible

The client workspace exposes 21 peer tabs, but the tab strip has no tablist/tab semantics, selected-state ARIA, or arrow-key behavior. The direct-scale and accounting-import overlays need semantic dialogs, labelled close controls, focus trapping, and focus restoration. A UI review also found eight controls that remove focus outlines without a verified replacement. This is usability and accessibility debt in the exact workflow the survey respondent will use daily.

## Important product boundaries

- P&L is explicitly cash-derived. It does not prove accrual accounting, payroll, inventory, or a complete QuickBooks replacement.
- CSV bank import is active; live bank-feed integrations are not configured.
- Schedule C information is copy-ready for manual entry, not transmitted into My Tax Prep Office or the IRS.
- The system has no deployed queue or scheduled job demonstrated for autonomous overnight work. Receipt extraction is inline; do not claim that it completes work while the practitioner sleeps.
- Do not estimate dollar or hour savings as achieved facts until a measured pilot establishes them. The survey's own expectation is more than ten hours per week; it is not proof of realized savings.

## Recommended release sequence

1. Correct P0 client-data fabrication and secure/disable the public SMS webhook.
2. Remove/rewrite unsupported public copy: live Turnstile, master-token gate, IRS DIF score, 8879/e-sign compliance, direct-to-R2, autonomous overnight work, and unconfigured third-party integrations.
3. Simplify the workspace around the survey's daily flow: **Overview → Upload → Review → Bank → P&L → Tax Bridge**, with advanced tools grouped under a deliberate "More" menu.
4. Run the controlled acceptance script and document actual results with one test firm.
5. Configure external services only after owner-controlled credentials, sender domains, carrier webhooks, retention rules, and observability are ready.
6. Invite Phyllis only after the acceptance journey and its failure/recovery paths pass.

## What can be marketed now, carefully

> A review-first practice workspace for bringing receipt evidence and bank CSV activity into a categorized, cash-derived P&L. It preserves unclear receipts for human review, makes business/personal decisions explicit, and prepares tax workpaper values for practitioner review.

That is specific, useful, and supported by the current implementation. Broader replacement, compliance, savings, automation, and integration claims require the corrections and acceptance proof above.
