# Folio (Tax-Build-Alpha)

Zero-cost B2B bookkeeping alpha for accounting firms with many clients.
Working title **Folio** — calm, Linear/Stripe-quality UX. Not Wave.

## Stack (locked)

| Layer | Choice |
|-------|--------|
| Frontend | Cloudflare Pages · Vite · React · TypeScript · Tailwind v4 · shadcn/ui |
| API | Cloudflare Workers · Hono |
| DB | Cloudflare D1 |
| Files | Cloudflare R2 |
| Jobs | Cloudflare Queues (stubbed; inline LLM path works today) |
| Auth | Better Auth on D1 (email/password) |
| AI | Gemini Flash adapter + mock provider (`GEMINI_API_KEY` on Worker only) |

**Not in alpha:** IRS e-file, Wave API, native apps, local LLMs, Netlify, Supabase.

## Repo layout

```
apps/web/          Vite + React UI (Pages)
apps/api/          Hono Worker (API + Better Auth + R2 + LLM)
migrations/        D1 SQL migrations
wrangler.toml      Root pointer (active config: apps/api/wrangler.toml)
```

## Prerequisites

- Node 20+
- Cloudflare account (free)
- Wrangler (installed via workspace)
- Optional: free Google AI Studio key for Gemini Flash (https://aistudio.google.com/apikey)

## Local development

```bash
# Install
npm install

# Copy Worker secrets
cp apps/api/.dev.vars.example apps/api/.dev.vars
# Edit BETTER_AUTH_SECRET (32+ chars). Leave LLM_PROVIDER=mock for offline.

# Apply D1 migrations locally
npm run db:migrate:local

# Run API (:8787) + web (:5173) together
npm run dev
```

- Web: http://localhost:5173 (proxies `/api` → Worker)
- API health: http://localhost:8787/api/health

### Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Web + API |
| `npm run typecheck` | TypeScript on both apps |
| `npm run build` | Build web + dry-run Worker bundle |
| `npm run db:migrate:local` | Apply D1 migrations to local D1 |
| `npm run deploy:api` | Deploy Worker |
| `npm run deploy:web` | Pages deploy notes |

## Cloudflare setup

1. **Login:** `npx wrangler login`
2. **D1:** `npx wrangler d1 create folio-db` → paste `database_id` into `apps/api/wrangler.toml`
3. **R2:** `npx wrangler r2 bucket create folio-receipts`
4. **Migrations (remote):** `npm run db:migrate:remote -w @folio/api`
5. **Secrets (Worker only — never in the browser):**
   ```bash
   cd apps/api
   npx wrangler secret put BETTER_AUTH_SECRET
   npx wrangler secret put GEMINI_API_KEY   # optional if using mock
   ```
6. **Vars:** set `BETTER_AUTH_URL` to your Worker URL; set `LLM_PROVIDER=gemini` when key is present.
7. **Pages:** create a Pages project from this repo
   - Root directory / app: `apps/web`
   - Build: `npm run build -w @folio/web` (from monorepo root) or `npm run build` inside `apps/web`
   - Output directory: `dist`
   - Env: `VITE_API_URL=https://<your-worker>.workers.dev`
8. **CORS / auth:** add your Pages origin to `trustedOrigins` in `apps/api/src/auth.ts`.

### Queues (optional Days 3+)

```bash
npx wrangler queues create folio-jobs
```

Uncomment the `[[queues.producers]]` / `[[queues.consumers]]` blocks in `apps/api/wrangler.toml`.
Until then, receipt extract runs **inline** after upload (thin Worker → Gemini/mock).

## Gemini (free tier)

1. Create an API key at https://aistudio.google.com/apikey
2. `wrangler secret put GEMINI_API_KEY` (or set in `.dev.vars`)
3. Set `LLM_PROVIDER=gemini`
4. Provider returns `{ date, merchant, amount, currency, category, confidence }`

Mock provider is the default so local/dev works with zero keys.

## Alpha features (Days 1–2 foundation)

- [x] Auth sign-up / sign-in + protected routes
- [x] Firm auto-provision + client CRUD
- [x] Default category folders (hotel, travel, food, supplies) + custom
- [x] Polished shell: login, client list, workspace (folders / upload / review / P&L)
- [x] `providers/llm` Gemini + mock
- [x] Receipt upload skeleton: file → R2 → receipt row → job stub → LLM
- [x] Deployable Pages + Workers layout, migrations, secrets docs

## Days 3–10 (remaining)

- Review queue: edit extract fields, file into folders, confidence UX
- Bank CSV import + business/personal triage + category assignment
- Real monthly/yearly P&L + PDF/Excel export
- Cloudflare Queues consumer for async extract at scale
- Bulk upload progress, duplicate detection
- Custom categories UX polish, client archive
- Production cookie `secure` + multi-origin trustedOrigins
- Soft delete, audit trail, invite firm members

## Security notes

- `GEMINI_API_KEY` and `BETTER_AUTH_SECRET` live only on the Worker (`.dev.vars` / `wrangler secret`).
- Never expose secrets via `VITE_*` env vars.
- Thin Workers: images/PDFs are forwarded to Gemini; no heavy PDF CPU in-Worker.

## License

Private — all rights reserved.
