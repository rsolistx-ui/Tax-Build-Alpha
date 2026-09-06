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
- Only filed evidence enters the P&L, sourced from the canonical ledger, never directly from unreviewed extraction.
- Every P&L category drills down to the exact ledger rows behind it and their source bank transaction and/or receipt.
- Bank CSVs are mapped, normalized, deduplicated, and stored in Neon without requiring a live bank integration.
- Filed receipts can be deterministically suggested against bank transactions, but no suggested match becomes final without a professional decision.
- Unmatched bank transactions become an exception inbox instead of a search problem.
- Missing receipt evidence can be uploaded directly from the bank exception and is resolved only after the deliberately linked receipt is reviewed and filed.
- A professional can link existing receipt evidence or explicitly document why a receipt is not required, with the decision preserved in the audit trail.
- Per-client merchant category corrections are remembered for future extracts.
- Client business profile data can inform extraction without leaking rules between clients.
- Production extraction failures are real failures. Production never silently substitutes mock data.
- A canonical ledger is the single source of book activity. A reconciled bank transaction and its matched receipt become one ledger expense, never two.
- Every transaction receives an explicit accounting class and business/personal treatment from a professional. Personal rows, transfers, owner contributions, and owner draws never enter operating P&L.
- Monthly periods track open and closed state. A closed period rejects accounting mutations until a professional explicitly reopens it with a recorded reason.

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
19. Generate controlled receipt and bank inputs and exercise the live production path through R2, Workers AI, line items, validation, filing, P&L reconciliation, source drill-down, bank normalization, duplicate protection, deterministic matching, explicit reconciliation, missing-receipt resolution, audit history, canonical ledger merging, explicit classification, personal/transfer exclusion from P&L, deterministic close blockers, clean period close, closed-period mutation rejection, and explicit reopen with audit history.
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
  -> one canonical ledger row per reconciled activity
  -> explicit professional classification
  -> personal and transfer rows excluded from ledger P&L
  -> deterministic period close blockers
  -> clean period close
  -> closed-period mutation rejection
  -> explicit reopen with audit history
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

`GET /api/clients/:clientId/pnl` is the single production P&L source. It builds income and expense totals from the canonical `ledger_entries` table, filtered to confirmed business income and business expense. A reconciled receipt plus bank transaction counts exactly once, since the two collapse into one ledger row on match. Transfers, owner contributions, owner draws, personal rows, and anything still `needs_review` are excluded regardless of source. An optional `period=YYYY-MM` query filters to a single period; omitting it returns all-time totals.

The response shape is `{ income, expenses, net, byCategory: { income: [...], expense: [...] }, note }`, where each `byCategory` row carries `categoryId`, `category`, `slug`, `total`, and `count`.

`GET /api/clients/:clientId/pnl/drilldown?categoryId=...&class=income|expense` traces every ledger row behind one category/class pair back to its exact source evidence (the matched bank transaction, the receipt, or both), with an optional `period=YYYY-MM` filter.

## Canonical ledger

A `ledger_entries` row is the single authoritative record of book activity. Every row traces to its source bank transaction, matched receipt, or both:

- A bank transaction represents the cash movement when present.
- A matched receipt is supporting evidence, not a second expense.
- Receipt-only activity creates a ledger row when no bank row exists.
- When a bank transaction and a filed receipt are reconciled, the receipt-only row absorbs the bank source so the activity appears exactly once, adopting the bank amount and currency as authoritative for the cash movement.

Supported transaction classes are expense, income, transfer, owner contribution, owner draw, and needs review. Business/personal treatment is explicit and separate from the class. No silent AI posting: a row enters operating P&L only after a professional classifies it as business income or business expense.

Classification and category changes record the actor and before/after state in `audit_events`. All ledger endpoints enforce the same authenticated firm/client boundary as the rest of the API.

## Professional classification

`POST /api/clients/:clientId/bank-transactions/:transactionId/classify` records the accounting class, business/personal treatment, and optional category for a resolved bank transaction and writes or updates its canonical ledger row. Closed periods reject the call with HTTP 409. Category changes on existing rows use `PATCH /api/clients/:clientId/ledger/:entryId/classify` and `PATCH .../category`.

## Period model

Periods use `YYYY-MM` keys with open and closed states.

- `GET /api/clients/:clientId/periods/:periodKey/summary` reports state, per-class/treatment totals, a deterministic blocker list, and whether the period can close.
- A period cannot close while any of the following exists in it: an unresolved bank exception, a pending linked receipt, an uncategorized business ledger row, a receipt in professional review, or a `needs_review` ledger class.
- `POST .../close` records the actor and timestamp, stamps the period's ledger rows, and writes a `period_closed` audit event.
- Accounting mutations against a closed period are rejected with HTTP 409.
- `POST .../reopen` requires an explicit reason, clears the close stamp, and writes a `period_reopened` audit event.
- `GET .../periods/:periodKey/audit` returns the period's close and reopen history.

## Workspace shell

The client workspace runs inside the permanent professional application shell. The shell mounts global navigation (Home, Clients, Inbox, Receipts, Banking, Transactions, Books, Reports, Tax, Documents, Settings) plus durable client-level navigation with a persistent client header, period selector, status/workload summary, and an evidence-first transactions table. Only real capabilities are wired; future sections are not faked.

The Transactions view is a dense table with date, description, amount, class, treatment, category, source type (bank, receipt, or manual), and period. It supports search, filters by class/treatment/category/period, batch selection foundation, open-row detail, and direct links to source evidence. Closed-period rows render read-only.

## Bank reconciliation and exceptions

Bank CSV intake detects common date, description, signed amount, debit, credit, and currency columns. The user can correct the mapping before import. Normalized transactions receive a client-scoped fingerprint so reimporting the same bank data does not silently duplicate the ledger workload.

Receipt suggestions are deterministic and currently use absolute amount tolerance, date proximity, and merchant token similarity. Suggestions never create a final accounting relationship on their own.

The bank exception workflow supports four deliberate outcomes:

- confirm a prepared filed-receipt suggestion
- link another existing filed receipt directly
- attach a receipt that is still in professional review, then resolve the bank transaction when that deliberately linked receipt is filed
- resolve the transaction without receipt evidence only when a professional records a reason

Matched, rejected, pending-receipt, uploaded-receipt, and no-receipt-required decisions are recorded in `audit_events`.

## Client correction memory

When a reviewer changes a merchant's top-level category, Folio stores a client-scoped `merchant_category` rule. Future receipts from the normalized merchant can inherit that client's remembered category. Rules are never shared across clients.

This is the first institutional-memory path. Item-level and vendor-specific learning can follow after the alpha proves the review loop.

## Cost guardrail

Workers AI currently includes a 10,000 Neuron daily free allocation on the Workers Free plan. Qwen 3.8 27B is available on Workers AI and uses the account's neuron allocation. The paid alpha should measure actual receipt usage before any volume commitment or model change.

The bootstrap does not upgrade the Cloudflare account or enable paid inference.

## Deliberately deferred

To protect the paid-alpha timeline, this milestone does not add:

- Plaid or any live bank feed
- payroll
- invoicing or accounts receivable
- e-file
- tax form calculation engine
- PDF or Excel export
- bulk receipt redesign beyond what supports the workspace shell
- speculative AI accounting decisions

Those follow only after the real receipt, bank, ledger, and period workflow is tested against Phyllis's actual operating process.

## Verification commands

```bash
npm run typecheck
npm run build
```

A build is not considered production-ready until the Neon schema has been applied, real Cloudflare bindings and secrets are present, and the production smoke test passes.

## Security notes

- Receipt sources remain private in R2.
- `DATABASE_URL`, `BETTER_AUTH_SECRET`, and optional `GEMINI_API_KEY` are Worker secrets only.
- No secret belongs in a `VITE_*` browser variable.
- Production auth cookies are `Secure`, first-party, and `SameSite=Lax` because the SPA and API share one Worker origin.
- Source endpoints enforce the same authenticated client boundary as receipt, bank, and P&L endpoints.
- Audit events record extraction, review edits, filing, reconciliation decisions, exception resolution, and validation override state.

## License

Private. All rights reserved.
