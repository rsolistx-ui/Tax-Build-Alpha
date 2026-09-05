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
- Only filed evidence enters the P&L.
- Receipt-level tax, tip, discounts, shipping, and rounding are kept as visible adjustment lines so the P&L reconciles to the approved receipt total.
- Every P&L category drills down to the contributing lines and exact source receipts.
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

Only receipts in `filed` status enter the P&L. Purchased line items remain their own ledger entries. When the approved receipt total differs from the item sum, Folio creates a visible receipt-level adjustment entry for the difference. This captures tax, tip, discounts, shipping, or rounding without hiding those amounts inside item rows.

A filed receipt with no line items falls back to its approved receipt total so evidence is not silently dropped.

`GET /api/clients/:clientId/pnl/drilldown?category=...` returns every contributing entry with its source receipt URL.

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
- payroll execution
- tax-year checklist UI
- e-file
- invoicing or accounts receivable
- full MFA rollout
- queue consumer and bulk async processing
- PDF or Excel report export
- item-level machine learning beyond correction rules

Those follow only after the real receipt, bank, and exception workflow is tested against Phyllis's actual operating process.

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
