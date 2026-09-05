# Folio (Tax-Build-Alpha)

Evidence-first bookkeeping and tax-workspace alpha for professional firms. The product rule is simple: AI proposes, evidence verifies, and the professional decides what becomes part of the books.

## Married architecture

This branch keeps the Cloudflare chassis that already shipped and replaces the accounting spine.

| Layer | Choice |
|---|---|
| Frontend | Cloudflare Pages, Vite, React, TypeScript, Tailwind |
| API | Cloudflare Workers, Hono |
| Auth state | Better Auth on Cloudflare D1 |
| Business database | Neon Postgres |
| Source documents | Private Cloudflare R2 |
| Primary extraction | Workers AI, `@cf/qwen/qwen3.8-27b` |
| PDF preparation | Workers AI `toMarkdown()` |
| AI fallback | Gemini Flash when `GEMINI_API_KEY` is configured |
| Local development | Deterministic mock provider only when explicitly selected |

D1 is now intentionally auth-only. Firm, client, receipt, line-item, validation, audit, correction-memory, bank, and reporting data live in Neon.

## What changed in the married spine

- Receipt truth moved from one header-level transaction to receipt header plus line items.
- Every extraction runs deterministic arithmetic validation before review.
- Review is evidence-first: source document on one side, editable extracted facts and validation on the other.
- Failed validation cannot be filed without an explicit professional override.
- Filed line items feed the P&L. Unreviewed AI output does not.
- Every P&L category drills down to the exact line items and source receipts behind the number.
- Per-client merchant category corrections are remembered and applied to future extracts.
- A client business profile is available to give extraction client-specific context.
- Extraction failures are real failures. Production never silently substitutes fabricated mock data.

## Repository layout

```text
apps/web/                         React app
apps/api/                         Worker API
migrations/                       Legacy D1 auth migration
migrations/neon/                 Neon business-data schema
scripts/neon-migrate.mjs          Dependency-free Neon migration runner
```

## Local setup

Requirements:

- Node 20+
- Cloudflare account
- Neon project
- R2 bucket named `folio-receipts`

Install dependencies:

```bash
npm install
```

Copy the Worker environment template:

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

For PowerShell:

```powershell
Copy-Item apps/api/.dev.vars.example apps/api/.dev.vars
```

Set a real `DATABASE_URL` in `apps/api/.dev.vars`. Use the pooled Neon PostgreSQL connection string from Neon.

Apply the Neon schema. PowerShell example:

```powershell
$env:DATABASE_URL="postgresql://..."
npm run db:migrate:neon
```

Apply the existing D1 migration for Better Auth when setting up a fresh local auth database:

```bash
npm run auth:migrate:local
```

Run both apps:

```bash
npm run dev
```

Local URLs:

- Web: `http://localhost:5173`
- API: `http://localhost:8787`
- Health: `http://localhost:8787/api/health`

Local development defaults to `LLM_PROVIDER=mock`. This keeps development free and deterministic. The mock is never used as an automatic production fallback.

## Cloudflare production setup

The active Worker config is `apps/api/wrangler.toml`.

1. Create or reuse the D1 database for Better Auth and replace the placeholder `database_id` in `apps/api/wrangler.toml`.
2. Create the private R2 bucket `folio-receipts`.
3. Create a Neon project and apply `migrations/neon/0001_married_spine.sql` with `npm run db:migrate:neon`.
4. Set Worker secrets:

```bash
cd apps/api
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put DATABASE_URL
npx wrangler secret put GEMINI_API_KEY
```

`GEMINI_API_KEY` is optional. It is only the fallback behind Workers AI.

5. Set `BETTER_AUTH_URL` to the deployed Worker URL and `APP_ORIGIN` to the Pages origin.
6. Keep `LLM_PROVIDER=workers-ai` in production.
7. Deploy the Worker and Pages app.

Workers AI is bound as `AI` in `apps/api/wrangler.toml`. Receipt photos are sent to Qwen 3.8 27B. PDFs first use Cloudflare document conversion, then Qwen receives the extracted document text. If that path fails and Gemini is configured, the provider adapter falls back to Gemini.

## Receipt lifecycle

```text
upload
  -> private R2 source
  -> Workers AI or Gemini extraction
  -> receipt header + line items
  -> arithmetic validation
  -> review queue
  -> professional edit or approval
  -> audit event + correction memory
  -> filed ledger
  -> P&L
  -> source drill-down
```

Validation currently checks:

- receipt total is present
- line items are present
- item amounts reconcile to subtotal when both exist
- subtotal plus tax plus tip reconciles to total
- receipt and line-item confidence signals

The tolerance for receipt arithmetic is two cents to allow normal rounding differences.

## Client correction memory

When a reviewer changes a merchant's top-level category, Folio stores a client-scoped `merchant_category` rule. Future receipts from the normalized merchant can inherit that client's remembered category without leaking a rule to another client.

This is the first institutional-memory path. More granular item-level and vendor-specific correction learning can be added after the alpha proves the review loop.

## P&L traceability

Only receipts in `filed` status enter the P&L. When line items exist, the P&L is built from those line items. A receipt with no line items falls back to its reviewed receipt total so evidence is not silently dropped.

`GET /api/clients/:clientId/pnl/drilldown?category=...` returns every contributing line with a source URL. The UI exposes the same drill-down next to the report.

## Deliberately deferred

To protect the paid-alpha timeline, this milestone does not add:

- bank CSV reconciliation
- tax-year checklist UI
- e-file
- full MFA rollout
- queue consumer and bulk async processing
- PDF or Excel report export
- item-level machine learning beyond correction rules

Those should follow only after the line-item review and evidence drill-down are working with real Phyllis documents.

## Verification commands

```bash
npm run typecheck
npm run build
```

A build is not considered production-ready until the Neon schema has been applied and real Cloudflare bindings and secrets are present.

## Security notes

- Receipt sources remain private in R2.
- `DATABASE_URL`, `BETTER_AUTH_SECRET`, and optional `GEMINI_API_KEY` are Worker secrets only.
- No secret belongs in a `VITE_*` browser variable.
- Production auth cookies use `Secure` and `SameSite=None` when `BETTER_AUTH_URL` is HTTPS so Pages can authenticate to the Worker across origins.
- Source endpoints enforce the same authenticated client boundary as receipt and P&L endpoints.
- Audit events record extraction, review edits, filing, and validation override state.

## License

Private. All rights reserved.
