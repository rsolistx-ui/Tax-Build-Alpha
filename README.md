# Folio (Tax-Build-Alpha)

Evidence-first bookkeeping and tax workspace alpha for professional firms. The operating rule is simple: software prepares, evidence verifies, and the professional decides what becomes part of the books.

## Paid-alpha architecture

| Layer | Choice |
|---|---|
| Client | React, Vite, TypeScript, Tailwind |
| Production delivery | Cloudflare Worker Static Assets, same origin as the API |
| API | Cloudflare Workers, Hono |
| Auth state | Better Auth on Cloudflare D1 |
| Business database | Neon Postgres |
| Source documents | Private Cloudflare R2 |
| Primary extraction | Workers AI, `@cf/qwen/qwen3.8-27b` |
| PDF preparation | Workers AI `toMarkdown()` |
| AI fallback | Gemini Flash only when `GEMINI_API_KEY` is configured |
| Local development | Deterministic mock provider only when explicitly selected |

D1 is auth-only. Firm, client, receipt, line-item, validation, audit, correction-memory, bank, and reporting data live in Neon.

The paid alpha intentionally serves the React app and API from one Worker origin. This removes the Pages-to-Workers third-party cookie path, keeps Better Auth first-party, reduces CORS complexity, and removes one production moving part. Cloudflare Pages can still be reintroduced later if there is a product reason for a separate frontend origin.

## What the alpha proves

- Receipt truth is a receipt header plus purchased line items, not one guessed transaction.
- Every extraction runs deterministic arithmetic validation before review.
- Review is evidence-first. The source document is visible beside editable extracted facts and validation results.
- Clicking Approve always saves the visible draft first, reruns validation, and only then files the receipt.
- Failed validation cannot be filed without an explicit professional override.
- Only filed receipt evidence and explicitly classified bank activity enter the P&L, never unreviewed extraction or an unconfirmed disposition.
- Receipt-level tax, tip, discounts, shipping, and rounding are kept as visible adjustment lines so the P&L reconciles to the approved receipt total.
- Every P&L category drills down to the contributing receipt lines, no-receipt bank transactions, and exact source evidence.
- The P&L genuinely filters by reporting period (custom range, month, year to date, or tax year) and warns explicitly when unresolved or unclassified activity could make the report incomplete.
- A bank transaction's accounting disposition (business expense, business income, personal, transfer, owner activity, loan, or excluded) is always an explicit professional decision, never a silent inference, and is fully audited.
- Filed evidence is browsable by category in real evidence folders, not a placeholder listing category names.
- A whole box of receipts can be uploaded at once; one bad file never destroys the rest of the batch.
- Bank CSVs are mapped, normalized, deduplicated, and stored in Neon without requiring a live bank integration.
- Filed receipts can be deterministically suggested against bank transactions, but no suggested match becomes final without a professional decision.
- Unmatched bank transactions become an exception inbox instead of a search problem.
- Missing receipt evidence can be uploaded directly from the bank exception and is resolved only after the deliberately linked receipt is reviewed and filed.
- A professional can link existing receipt evidence or explicitly document why a receipt is not required, with the decision preserved in the audit trail.
- Per-client merchant category corrections are remembered for future extracts.
- Client business profile data can inform extraction without leaking rules between clients.
- Production extraction failures are real failures. Production never silently substitutes mock data.

## Repository layout

```text
apps/web/                         React client
apps/api/                         Hono Worker, auth, R2, Workers AI
migrations/                       D1 auth schema
migrations/neon/                 Neon business schema
scripts/neon-migrate.mjs          Neon migration runner
scripts/bootstrap-production.ps1  Neon + Cloudflare production bootstrap
scripts/smoke-production.ps1      End-to-end paid-alpha verification
```

## Local setup

Requirements:

- Node 20+
- Cloudflare account
- Neon account
- Windows PowerShell for the production bootstrap scripts

Install dependencies:

```bash
npm install
```

Copy the Worker environment template:

```powershell
Copy-Item apps/api/.dev.vars.example apps/api/.dev.vars
```

For local development, set a pooled Neon `DATABASE_URL` in `apps/api/.dev.vars`, then apply the business schema:

```powershell
$env:DATABASE_URL="postgresql://..."
npm run db:migrate:neon
```

Apply the local D1 auth migration and run both apps:

```powershell
npm run auth:migrate:local
npm run dev
```

Local URLs:

- Web: `http://localhost:5173`
- API: `http://localhost:8787`
- Health: `http://localhost:8787/api/health`

Local development defaults to `LLM_PROVIDER=mock`. Mock output is never an automatic production fallback.

## One-command production bootstrap and proof

The production bootstrap provisions or reuses Neon and Cloudflare resources, applies both database schemas, generates the Better Auth secret, stores Worker secrets, builds the SPA, deploys the single-origin Worker, verifies `/api/health`, and then runs the complete receipt, reporting, bank reconciliation, and exception-resolution production smoke test. A normal production setup is one command.

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-production.ps1
```

The default Neon project name is `folio-alpha`. Override it only when needed:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-production.ps1 -NeonProjectName "folio-alpha"
```

The script will:

1. Run `npm ci`.
2. Verify Cloudflare authentication and open `wrangler login` if required.
3. Use `DATABASE_URL` if one is already present in the PowerShell session. Otherwise it invokes the current Neon CLI with `npx --yes neon@latest`.
4. Authenticate Neon through browser OAuth if needed.
5. Reuse a Neon project named `folio-alpha` when it exists, otherwise create it. If the account requires an organization or region choice, the script falls back to Neon's guided `link` flow rather than guessing.
6. Resolve the project's pooled Postgres connection string without writing it into the repository.
7. Create or reuse D1 `folio-db` for Better Auth.
8. Patch the local Wrangler config with the real D1 database ID.
9. Create or reuse private R2 bucket `folio-receipts`.
10. Apply the D1 auth migration.
11. Apply all ordered Neon business migrations through `npm run db:migrate:neon`.
12. Build the React client.
13. Deploy the Worker with the client as static assets.
14. Generate and upload `BETTER_AUTH_SECRET`.
15. Upload `DATABASE_URL` as a Worker secret.
16. Upload `GEMINI_API_KEY` only when it is already present in the environment.
17. Set production `BETTER_AUTH_URL` and `APP_ORIGIN` to the same Worker origin.
18. Redeploy and verify Neon plus Workers AI through the health endpoint.
19. Generate controlled receipt and bank inputs and exercise the live production path through R2, Workers AI, line items, validation, filing, P&L reconciliation, source drill-down, bank normalization, duplicate protection, deterministic matching, explicit reconciliation, missing-receipt resolution, and audit history.
20. Stop with an error instead of silently overriding any failed deterministic validation.

No database credential or auth secret is written into the repository. The Neon CLI may create a local `.neon` context when its guided fallback is needed. Neon manages that file as local project context and adds it to git ignore.

If infrastructure needs to be deployed without running the smoke test immediately, use `-SkipSmokeTest`. That should be the exception rather than the paid-alpha release path:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-production.ps1 -SkipSmokeTest
```

## Standalone end-to-end production proof

The bootstrap runs this automatically by default. It can also be rerun independently against the deployed Worker:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-production.ps1 -BaseUrl "https://folio-api.<your-subdomain>.workers.dev"
```

By default, the smoke script generates a receipt image with two purchased items, subtotal, tax, and grand total. You can instead pass a real receipt image or PDF:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-production.ps1 `
  -BaseUrl "https://folio-api.<your-subdomain>.workers.dev" `
  -ReceiptPath "C:\path\to\receipt.jpg"
```

The smoke test exercises the complete production path:

```text
receipt file
  -> private R2 source
  -> Workers AI extraction
  -> receipt header + line items
  -> arithmetic validation
  -> professional review state
  -> filed ledger
  -> reconciled P&L
  -> source drill-down
  -> bank CSV normalization
  -> duplicate protection
  -> deterministic match suggestion
  -> explicit confirmation
  -> unmatched exception inbox
  -> missing receipt upload or documented no-receipt resolution
  -> receipt review and filing
  -> resolved bank relationship
  -> audit history
```

The smoke test never auto-overrides failed validation. If deterministic validation fails, it stops in review and prints the failed checks.

## Receipt lifecycle

```text
upload
  -> private R2 source
  -> Workers AI or configured Gemini fallback
  -> receipt header + line items
  -> arithmetic validation
  -> review queue
  -> professional edit or approval
  -> audit event + correction memory
  -> filed ledger
  -> reconciled P&L
  -> source drill-down
```

Validation currently checks:

- receipt total is present
- line items are present
- item amounts reconcile to subtotal when both exist
- subtotal plus tax plus tip reconciles to total
- receipt and line-item confidence signals

The arithmetic tolerance is two cents for normal rounding differences.

## P&L traceability

`GET /api/clients/:clientId/pnl` accepts optional `startDate`/`endDate` (YYYY-MM-DD) query parameters and genuinely filters every underlying row by reporting period; omitting both returns all-time totals. Both bounds are validated as real calendar dates (a malformed string, an out-of-range month, or a day that does not exist in its month all return HTTP 400) and `startDate` may never be after `endDate` (also HTTP 400). An invalid bound is rejected outright, never silently treated as unbounded. The workspace UI offers current month, previous month, year to date, tax year (from the client's configured `tax_year`), and custom range presets.

Bank amounts are signed cash movements, not magnitudes: a debit is negative and a credit is positive. Expense totals are computed as `-sum(amount)` over included transactions, so a vendor refund or contra credit naturally reduces the net expense instead of being added on top of it (a -100 debit plus a 20 refund nets to 80, not 120). Income totals are computed as `+sum(amount)`, so an income reversal naturally reduces net income (a +1000 credit plus a -100 reversal nets to 900, not 1000). Receipt-derived expense amounts are unsigned line-item and adjustment amounts, added directly.

Business expenses combine two sources without double counting: filed receipts (line items plus a visible receipt-level adjustment line when the approved total differs from the item sum) and bank transactions that were deliberately resolved without a receipt (`no_receipt_required`) and then explicitly classified `business_expense`. A bank transaction matched to a filed receipt is never counted a second time; the receipt supplies the expense detail and the bank transaction confirms the cash movement.

A filed receipt whose matched bank transaction is explicitly classified `personal`, `transfer`, `owner_contribution`, `owner_draw`, `loan`, `other_excluded`, or `business_income` is excluded from operating expense entirely rather than silently kept: the bank-side professional decision always wins over the receipt's own extracted category, and the exclusion updates immediately if the disposition changes after filing.

Business income comes only from bank transactions explicitly classified `business_income`. Receipts never represent income.

Personal, transfer, owner contribution, owner draw, loan, other-excluded, and still-unclassified bank activity never enters operating income or expense. The response includes a `completeness` block (`unclassifiedCount`, `unresolvedTriageCount`, `uncategorizedCount`, `currencyConflictCount`, `isComplete`). `uncategorizedCount` covers uncategorized business-expense and business-income bank transactions plus uncategorized filed-receipt expense lines; excluded/personal transactions are never required to carry a category. The workspace UI shows an explicit warning banner whenever a reporting period is not yet complete, so a P&L is never presented as final while unresolved, uncategorized, or currency-conflicted activity remains.

Category identity is canonical, never a display-string coincidence: a receipt's own `category_id` foreign key is used directly, and a receipt line item's free-text category is resolved against the client's categories table by slug or name (case-insensitive) before grouping. "Supplies" and "supplies", or "Office Supplies" and "office-supplies", always merge into one P&L category, never two. A receipt is discoverable in its evidence folder via either its own category or any line item's category, so source evidence is never lost to line-item-level allocation.

The P&L reports in the client's configured `default_currency`. Filed receipts and bank activity in any other currency are excluded from the totals and counted as a currency conflict (surfaced through `currencyConflictCount` and `completeness`) rather than silently summed together. There is no currency conversion in this milestone; a conflict must be resolved by the professional, not converted automatically.

Cash-basis clients use this operational P&L directly. A client configured for accrual accounting never receives it: the endpoint returns `accrualSupported: false` with an explicit warning and no income/expense figures, so a cash-derived report is never presented as if it were accrual. Accrual reporting is not implemented in this milestone.

`GET /api/clients/:clientId/pnl/drilldown?category=...&startDate=...&endDate=...` returns every contributing receipt line (with its source receipt URL) plus every no-receipt bank transaction behind that category, including the professional's recorded no-receipt reason.

## Bank reconciliation and exceptions

Bank CSV intake detects common date, description, signed amount, debit, credit, and currency columns. The user can correct the mapping before import. Normalized transactions receive a client-scoped fingerprint so reimporting the same bank data does not silently duplicate the ledger workload.

Receipt suggestions are deterministic and currently use absolute amount tolerance, date proximity, and merchant token similarity. Suggestions never create a final accounting relationship on their own.

The bank exception workflow supports four deliberate outcomes:

- confirm a prepared filed-receipt suggestion
- link another existing filed receipt directly
- attach a receipt that is still in professional review, then resolve the bank transaction when that deliberately linked receipt is filed
- resolve the transaction without receipt evidence only when a professional records a reason

Matched, rejected, pending-receipt, uploaded-receipt, and no-receipt-required decisions are recorded in `audit_events`.

## Bookkeeping disposition

Receipt matching and accounting disposition are separate professional decisions: a bank transaction can be matched to evidence without deciding whether it is business activity, and disposition can be set independent of matching. `PATCH /api/clients/:clientId/bank-transactions/:transactionId/disposition` sets one of `business_expense`, `business_income`, `personal`, `transfer`, `owner_contribution`, `owner_draw`, `loan`, `other_excluded`, or `unclassified`, with an optional category and note. Every disposition change is recorded in `audit_events` with before/after state.

Import prepares a deterministic `suggestedDisposition` (income-shaped for a positive amount, expense-shaped for a negative one) so the workspace can show a starting point, but every transaction starts and stays `unclassified` until a professional explicitly confirms it. No disposition is ever inferred automatically into the real `disposition` field.

## Evidence folders

`GET /api/clients/:clientId/categories/:categoryId/evidence` returns the filed, professional-approved receipts belonging to one category: date, merchant, total, filename, category, and source link, sortable by date or merchant. Unreviewed AI extraction never appears as folder evidence regardless of its tentative category.

## Batch receipt intake

The upload tray accepts a whole box of receipts in one selection. Each file tracks its own pending/processing/succeeded/failed state; uploads run one at a time so a single bad file is recorded and skipped without aborting or discarding the rest of the batch. Succeeded receipts land in the review inbox as usual, and a failed file can be retried without re-selecting the whole batch. This is a small, self-contained upload tray, not a queue processing system.

## Client correction memory

When a reviewer changes a merchant's top-level category, Folio stores a client-scoped `merchant_category` rule. Future receipts from the normalized merchant can inherit that client's remembered category. Rules are never shared across clients.

This is the first institutional-memory path. Item-level and vendor-specific learning can follow after the alpha proves the review loop.

## Cost guardrail

Workers AI currently includes a 10,000 Neuron daily free allocation on the Workers Free plan. Qwen 3.8 27B is available on Workers AI and uses the account's neuron allocation. The paid alpha should measure actual receipt usage before any volume commitment or model change.

The bootstrap does not upgrade the Cloudflare account or enable paid inference.

## Professional reporting and export

Each client workspace has an Export tab (the Export Center). It uses the
same reporting-period semantics as the P&L tab (this month, last month,
year to date, tax year, custom range) rather than a second definition of
reporting dates, and shows a preview - client, period, accounting basis,
currency, income/expenses/net, P&L completeness, unresolved/uncategorized/
currency-conflict counts, and excluded-activity count - before anything is
downloaded, so a professional never has to open a file to discover it is a
working draft.

**Folio Professional Excel workbook** (Download Excel Workbook) is a real
.xlsx file (built with exceljs, which has no filesystem or native-binary
dependency and runs cleanly under Cloudflare Workers) with seven worksheets:

- **SUMMARY** - client, legal name, reporting dates, tax year, accounting
  basis, currency, generated timestamp, report status, income/expenses/net,
  and the same completeness counts as the preview.
- **P&L** - income and expense categories and totals, reconciled exactly to
  the existing P&L API. The workbook never recomputes accounting totals
  itself; it reads the same assemblePnlReport service the P&L tab uses.
- **BANK LEDGER** - every bank transaction in the period, including
  personal, transfer, owner, loan, excluded, and unclassified activity that
  the P&L correctly leaves out of operating totals. The professional ledger
  stays complete even when the P&L is not.
- **RECEIPT EVIDENCE** - every filed receipt in the period with its
  authenticated Folio source URL (requires an active, logged-in account -
  the link is never a public URL).
- **OPEN ITEMS** - every item still blocking a complete report: unclassified
  bank transactions, unresolved bank triage, uncategorized business
  activity, currency conflicts, and receipt/bank disposition conflicts.
- **EXCLUDED - NONBUSINESS** - deliberate personal/transfer/owner/loan/
  other-excluded activity, proof it was reviewed rather than accidentally
  omitted.
- **TRANSACTION REVIEW** - date, description, amount, Folio disposition,
  Folio category, business/nonbusiness status, matched receipt, receipt
  filename, professional note, and source transaction id for every
  transaction in the period - a professional reference for cross-checking
  or completing work in any other system by hand.

If the P&L is incomplete for the selected period, the SUMMARY sheet marks
the report DRAFT - ITEMS REQUIRE PROFESSIONAL REVIEW and the filename
includes DRAFT; a complete period is never labeled that way. Every
user/source-controlled text field (merchant, description, filename,
professional note, imported category text) is written as inert text when it
begins with an equals, plus, minus, or at sign, so the workbook can never
carry a live spreadsheet formula it did not deliberately generate.
Filenames are deterministic and human-readable (for example, "Client Name -
Folio - 2026-01-01 to 2026-12-31.xlsx"), sanitized against Windows-invalid
characters - never an opaque UUID.

**Bank Transactions CSV** (Download Bank Transactions CSV) is a generic
data-portability escape hatch containing only Date, Description, and Amount
columns. **This file does not transfer Folio's category, disposition, or
evidence decisions** - those live in the workbook's TRANSACTION REVIEW
worksheet above. The professional must select a single source/import batch
and a single currency; Folio never silently merges unrelated bank accounts
or currencies into one statement file. This CSV and the workbook are output
formats, not the operating workflow - routine financial review happens
inside Folio itself.

## Deliberately deferred

To protect the paid-alpha timeline, this milestone does not add:

- Plaid or any live bank feed
- payroll execution
- tax-year checklist UI
- e-file
- invoicing or accounts receivable
- full MFA rollout
- queue consumer and bulk async processing
- item-level machine learning beyond correction rules
- direct integration with any specific third-party accounting product's
  import format; Folio will not hardcode a guessed format until a real
  prepared input sheet from Phyllis's own accounting software is available

Those follow only after the real receipt, bank, and exception workflow is tested against Phyllis's actual operating process.

## Verification commands

```bash
npm run typecheck
npm run build
npm run test
```

A build is not considered production-ready until the Neon schema has been applied, real Cloudflare bindings and secrets are present, and the production smoke test passes.

## Beta access

Folio is invitation-only during the paid beta. There is no public sign-up. The
owner issues a one-time invitation (email + beta duration, 30 days by
default) from the in-app Beta Access page; the invitation token is hashed
before storage and can only be redeemed once, by the exact invited email.
Every protected business API call is checked server-side against a
Neon-stored entitlement (`active` / `expired` / `revoked`) with the server's
own clock as the sole authority — a changed local clock, a copied installer,
or a copied `.exe` cannot extend or fabricate access. Expiration and
revocation never delete, modify, or corrupt Neon rows or R2 receipt files;
the server simply refuses further protected operations and the client shows
a dedicated locked screen instead of broken API errors or a fake $0 report.

## Windows beta distribution

The Windows beta (`Folio Beta`) is a Tauri desktop wrapper around the same
production web client at the same origin; it holds no `DATABASE_URL`,
Better Auth secret, Cloudflare credential, Neon credential, AI key, or any
other server credential. The desktop window can only navigate within the
production origin — any other link opens in the user's normal browser
instead of inside the app. `.github/workflows/windows-build.yml` builds an
NSIS `.exe` (and MSI where the toolchain supports it) on `windows-latest`
and uploads it as a GitHub Actions artifact named
`folio-beta-windows-<version>-<shortsha>`.

**The installer is unsigned in this alpha.** No paid Windows code-signing
certificate is used. Windows SmartScreen will very likely warn that the
publisher is unrecognized on first run ("Windows protected your PC"). This is
expected or an unsigned beta binary and not a sign of tampering; testers can
proceed via "More info" -> "Run anyway". Do not disable Windows Defender,
SmartScreen, or any other OS protection to install this beta.

## Mobile beta (PWA)

Phyllis can install Folio to a phone home screen today without waiting for
App Store distribution: `apps/web/public/manifest.webmanifest` plus
`apps/web/public/sw.js` make the production site installable on Android
("Add to Home screen") and iOS/iPadOS (Share -> "Add to Home Screen"). The
service worker only ever caches a fixed list of static shell assets (icons
and the manifest); it never intercepts `/api/*`, receipt source responses,
bank data, P&L responses, authentication responses, or any other financial
or session data — those always go straight to the network, uncached.

## Security notes

- Receipt sources remain private in R2.
- `DATABASE_URL`, `BETTER_AUTH_SECRET`, `OWNER_EMAIL`, `SMOKE_CLEANUP_TOKEN`, and optional `GEMINI_API_KEY` are Worker secrets only.
- Public registration is closed; the only way to create a usable account is redeeming a hashed, single-use, owner-issued invitation.
- The production smoke-cleanup path is a token-gated internal endpoint, never exposed in any UI, and hard-refuses to touch any tenant whose firm name does not match the literal smoke-harness naming convention.
- No secret belongs in a `VITE_*` browser variable.
- Production auth cookies are `Secure`, first-party, and `SameSite=Lax` because the SPA and API share one Worker origin.
- Source endpoints enforce the same authenticated client boundary as receipt, bank, and P&L endpoints.
- Audit events record extraction, review edits, filing, reconciliation decisions, exception resolution, and validation override state.

## License

Private. All rights reserved.
