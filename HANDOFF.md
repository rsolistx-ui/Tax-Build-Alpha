# Session Handoff — Truepost (Tax Build Alpha)

**Written:** 2026-09-22 (updated same day after the e-file signing build, see §4). This replaces the previous handoff, which was stale (it predated the last ~180 files of changes). Everything below is verified against the actual codebase and a live production smoke test, not assumed.

## Status: core loop verified live. M6 (native e-sign) and M7 (Tax Workbench) done. Staff seats, roles and the Schedule C handoff to the preparer's tax software shipped 2026-09-24. Truepost does not compute or e-file returns (decision 2026-09-24: hand off to MyTAXPrepOffice instead; no 1040/MeF build for the 2027 season).

## 0. Session of 2026-09-24, afternoon (latest; read this first)

Everything is committed and pushed to `main` (last commit `9cf6785`) and deployed (Worker `e5fd1662`). Neon migrations 0070 and 0071 are applied and `node scripts/verify-neon-schema.mjs` passes. Tests: 627 api, 84 web, 42 script. Market and gap analysis written up as a Claude doc: https://claude.ai/artifact/1vnuSfcSnxUBciTvw2ZrLR

**Shipped (commits 74d6aad, a4ca80d, 3f535d8, 129f63d, bf5856c, 158cc3e, 9cf6785):**
- **Phase 0 correctness.**
  - Fake e-file endpoints removed. `submit`/`ack`/`reject`/`resolve-rejection` used to mark returns "transmitted" with a made-up MeF id.
  - 1099-NEC/MISC threshold by payment year (`services/form-1099-threshold.ts`): $600 through 2025, $2,000 after (OBBBA). Attorney gross proceeds (1099-MISC box 10) stay at $600.
  - The smoke test now fails the run if any request needed a 502/503/504 retry.
  - W-9 "request" copy is honest: it records only and emails nothing.
- **Schedule C handoff** (migration 0070 `category_tax_lines`).
  - `services/tax-handoff.ts` and `routes/tax-handoff.ts`: `GET /api/clients/:id/tax-handoff/:year`, `.../xlsx`, `PUT .../lines`.
  - Categories get a suggested line from their name; the preparer can override it (audited). Unassigned amounts are flagged, never dumped into 27b.
  - The UI is the client workspace **Tax Bridge & 1099** tab (`components/tax-handoff-panel.tsx`), linked from the workbench. Phyllis files with MyTAXPrepOffice; the handoff gives line totals to key in.
- **Staff seats, no cap** (migration 0071).
  - Owners invite from the **Team** page (`/team`, `routes/firm-staff.ts`). Invites reuse `beta_invitations` with `firm_id`/`firm_role`, and redemption joins the owner's firm.
  - Staff access follows the firm owner's entitlement (`loadAccessEntitlement` in `services/firm.ts`). One firm per user (unique index).
  - Emails that already have an account can't be invited yet.
- **Roles** owner / preparer / bookkeeper / read_only, all in `services/firm-roles.ts`.
  - `firmRoleAllows` runs inside `requireActiveBeta`, which also sets `c.get("firmRole")`.
  - Writes: money, staff and client deletion are owner-only; tax judgment and signatures are preparer and up.
  - Reads: billing is owner-only; e-file records, the signature vault and consent text are preparer and up.
  - A guard test (`firm-roles.test.ts`) scans every `/api/clients` write route and fails if one is unclassified. Classify new routes there.
- **Signed records hidden from bookkeeper and read_only.** A signed record is an engagement letter or any document a `signature_requests` row points at; see `signedRecordDocumentSql`. Filtered in:
  - the document list, source, signed-url, version history, review queue, and both review PATCHes
  - the clean-exit manifest and ZIP
  - agent-task lists (both) and engagement-draft approval
  - download tokens, which are now scoped: `lib/signed-url.ts` `"unsigned"` tokens are re-checked at redemption.
- **Security fixes found on the way.**
  - Removed `POST /documents/:docId/versions`. It accepted any storage key, so a user could fetch another firm's file through signed-url.
  - Version history is now scoped to the client.
  - The clean-exit ZIP had 500'd for every client (sorted by a nonexistent `client_documents.created_at`).

**Verification status:**
- The full `scripts/smoke-production.ps1` last passed on Worker 63719ca6. Later runs stopped at Workers AI receipt extraction because the free daily allowance (10,000 neurons, resets 00:00 UTC) ran out. That is before any changed code.
- **First thing next session: run the full smoke test.** It now also covers staff and roles, signed-document hiding and the ZIP.
- Role changes after that were verified with a 24-assertion live script (owner and bookkeeper sessions, self-cleaning). It was not committed; its checks mirror the smoke staff step.
- Seven auditor passes ran. All RED/AMBER findings are fixed, except the one below that was left by design.

**Commands (PowerShell, from the repo root):**
```
# Deploy (builds web and deploys the Worker)
npm run deploy:api

# Apply ONE Neon migration (never replay all; 0012 is not idempotent), then verify
$env:DATABASE_URL = ((Get-Content "apps\api\.dev.vars" | Where-Object { $_ -like 'DATABASE_URL=*' }) -replace '^DATABASE_URL=','').Trim('"')
node scripts/neon-migrate.mjs migrations/neon/<file>.sql
node scripts/verify-neon-schema.mjs

# Full production smoke test (about 5 minutes, self-cleaning, uses Workers AI allowance)
$env:SMOKE_CLEANUP_TOKEN = ((Get-Content "$env:OneDrive\Desktop\Truepost-SMOKE_CLEANUP_TOKEN.txt") | Where-Object { $_ -match '^[0-9a-f]{64}$' } | Select-Object -First 1)
.\scripts\smoke-production.ps1 -BaseUrl https://folio-api.rsolistx.workers.dev
```
- A GateGuard hook asks for facts before the first Bash of a session and the first Write/Edit of each file. Answer it and retry.
- Owner credentials for live checks are in `Truepost-Owner-Credentials.txt` on the desktop. Read them programmatically; never echo them.

**Left as designed / open:**
- The 1099 radar shows W-9 request status to bookkeepers. That's bookkeeping, and those requests have no document. It's a one-line change if the owner wants it hidden.
- Next build is **client assignment**: staff see only the clients the owner assigns, with a per-person "sees all" switch. About 3 to 4 hours.
- Pre-existing, not yet fixed:
  - `POST /:clientId/signature-requests` does not check that `documentId` belongs to that client.
  - The S-Corp calculator uses the 2024 Social Security wage base ($168,600).
  - A duplicate, shadowed `GET /1099-radar` still lives in `routes/tax-radar-advisory.ts` with $600.
  - The Team link is in the desktop header only.
- The owner wants estimates in **hours**, not weeks.

**Owner to-dos (unchanged unless noted):**
- Email-code enrollment. Walkthrough given: sign in, **Confirm your email**, **Email me a code**, enter the 6 digits.
- Fingerprint test, password change.
- **Workers Paid and Resend Pro.** The owner says both are coming soon. Resend free is 100 emails a day, and sign-in codes depend on it.
- Keys: Azure DI, Textract, Turnstile, admin email, Telegram.
- Attorney review, WISP.

## 0a. Session of 2026-09-24, morning

All committed, pushed, deployed, and verified with a passing production smoke test (last: Worker version `71ee7f2c`). Independently audited twice (auditor agent); see "Audit follow-up" below.

**M7 Tax Workbench** (`/workbench`, header nav + command palette):
- Firm-wide prep status per tax year (`GET /api/workbench/:taxYear`), per-client detail (`GET /api/clients/:id/workbench/:taxYear`): readiness blockers, tax diagnostics, bookkeeping gaps, checklist, workpaper/M-1/mappings, each deep-linked to the fixing tab.
- "Set up standard mappings" (form suggested from entity type; new Schedule C template), prior-year income/expenses/net vs this year, one-click copy of last year's document checklist (`POST /tax-readiness/:taxYear/checklist/prefill-prior-year`).
- One readiness gate: `PUT /tax-readiness/:taxYear` (`checkReadinessTransitionAllowed`) now also blocks ready_for_preparation / preparation_started / complete on any tax diagnostic error (e.g. NO_MAPPINGS). The old PATCH workbench route and `services/tax-workbench.ts` are gone.

**Bugs fixed (all were live in production):** workbench and return-engine gate read nonexistent `client_profiles.readiness_state`; `tax_form_mappings` firm-wide UNIQUE blocked a second client (migration `0069`); seed-defaults exceeded the 50-subrequest cap; organizer prefill queried nonexistent receipts columns; createReturn audit insert was invalid SQL swallowed by `.catch`; palette "support" and "phone upload" items were dead controls.

**Platform facts learned (important):**
- **Hono sub-app `use("*")` applies to the whole mount prefix.** With 25 sub-apps at `/api/clients`, every client request ran the session check 25x and the beta check 19x. Now gated once in `index.ts` (`app.use("/api/clients/*", requireSession, requireActiveBeta)`); `client-prefix-middleware.test.ts` forbids per-file `use("*")` on those sub-apps. Do not add middleware inside those route files.
- **Workers free plan: 50 subrequests per request; every `db.query` is one.** Never loop queries per row; use one multi-row INSERT. Also a per-request CPU cap: `exceededCpu` 503s were seen on ordinary routes (smoke test retries 502/503/504, which hides them). Owner intends to buy Workers Paid ($5/mo).
- **Workers Logs is on** (`[observability]` in `apps/api/wrangler.toml`); search a 500's `requestId` in dashboard > Workers & Pages > folio-api > Logs. The wrangler OAuth token cannot query logs via API. `wrangler tail --status error` shows only uncaught exceptions/CPU limits, not handled 500s.

**Audit follow-up (second audit of 21367e3..985689a):**
- Fixed: the workbench GET re-ran the whole readiness gate (~13 extra queries, ~47 of 50 subrequests). The decision is now the pure `readinessBlockers()` in `routes/workspace.ts`, used by both `checkReadinessTransitionAllowed` and the workbench with already-loaded facts. Keep this endpoint's query budget in mind before adding fields.
- Fixed: added Schedule C line 27a (Form 7205 energy efficient buildings deduction). The auditor's claim that 27b is "Reserved" is the pre-2023 form; the IRS 2025 instructions confirm 27b is "Other expenses (from line 48)".
- Fixed: `client-prefix-middleware.test.ts` now also asserts the `/api/clients/*` gate is registered before any client route.
- Not changed, verified false: b53cd17 did not add a beta requirement to workpaper/e-file/planning/consent/doc-versioning routes; `clients.ts` (mounted first) already applied its `use("*", requireActiveBeta)` to the whole prefix before the change.
- Left as is (pre-existing): `directUploadSmsRoutes` is mounted at both `/api/clients` and `/api`; the real Twilio webhook is `/api/sms/inbound`. Its `/:clientId/...` routes carry their own per-route auth because of the `/api` mount, so do not strip those.
- Pre-existing em dashes remain in some `tax-extended-panels.tsx` panel titles.

**Next (no keys needed):** M8 return engine is the remaining milestone and should not be started casually. Open owner items are unchanged: email-code enrollment, fingerprint test, password change, Azure/Turnstile/admin-email keys, attorney review, Workers Paid.

A full production pipeline test passed end-to-end this session (exit 0): receipt upload → R2 → Workers AI extraction → per-client rule categorization → validation → review → filing → P&L → bank CSV import → matching → exceptions → client portal → professional review → close, plus cross-tenant isolation, tax-year readiness, and engagement automation. This was not a code-read — it was a real synthetic tenant created, exercised, and cleaned up against `https://folio-api.rsolistx.workers.dev`.

---

## 1. What shipped this session (all committed, pushed, deployed to production)

- **Time tracking tied to invoicing** — start/stop timer or manual entry, billing rates (hourly/fixed/retainer), convert unbilled time into a real Stripe-ready invoice. Migration `0056`, full UI in the Billing tab.
- **Client pipeline view** — prospect → engaged → active → inactive kanban, replacing a hardcoded "Active" badge that was previously fake. Migration `0057`.
- **Recurring workflow templates** — build a checklist once ("every March, prepare the 1040"), subscribe a client, and it auto-generates work items on schedule via the existing Cloudflare Cron trigger (already running, zero added cost). Migration `0058`. Full UI in the Engagements tab.
- **Spending-by-category pie chart** — `recharts` was a declared dependency that was never actually imported anywhere; built a real donut chart on the P&L tab fed by live category totals, colors validated for light/dark and colorblind accessibility.
- **New TP logo** embedded everywhere — favicon, all PWA icon sizes, Tauri desktop icons, app shell.
- **PWA push notifications fixed** — `vite-plugin-pwa`'s `generateSW` mode silently overwrites the hand-written `sw.js` at every build, so push/notificationclick had zero listener in production. Fixed via `workbox.importScripts`. Also fixed two dead home-screen shortcut URLs and a missing icon reference.
- **Design pass** — fixed 3 real dark-mode CSS bugs (toast banners and a count badge used hardcoded hex with no dark override) and one off-brand purple "AI slop" accent, found via the Impeccable detector, not eyeballed.
- **Four real production database bugs found and fixed** by the live pipeline test (see §2 — this is the most important finding of the session).
- **Twilio SMS webhook security** (from prior session, verified still correct): real Twilio signature verification, not a stub.
- **Stripe Connect OAuth flow** (from prior session, verified working): Phyllis authorizes her own existing Stripe account via Stripe's hosted consent screen — Truepost never touches her banking details or holds platform keys on her behalf.

## 2. Production bugs found via live testing (all fixed, verified, migrated)

These were **invisible to code review** — they only surfaced by actually running a receipt through the live pipeline and reading the true database-level error (the API only ever returned a generic message to the client).

| Bug | Root cause | Impact before fix |
|---|---|---|
| Migration 0034 never applied | Typo: `$$ LANGUAGE plpgsql.` instead of `;` | `stripe_connect_accounts`/`stripe_customers` didn't exist |
| Migration 0040 never applied | Referenced table `documents`, real table is `client_documents` | 1099/duplicate-detection columns didn't exist |
| **`document_classifications` table never created by any migration** | Pure omission | **Every single receipt upload in production was failing**, regardless of whether AI extraction succeeded |
| `receipts.notes` column missing | Pure omission | Export/close-packet flow threw 500 on every call |

**Lesson for next session:** `scripts/verify-neon-schema.mjs` had blind spots — it only checks objects someone remembered to add a check for. All four gaps above now have checks added. Still worth periodically diffing every migration file's `CREATE TABLE`/`ADD COLUMN` against what the verifier actually asserts, since the verifier is manually maintained and can still drift.

## 3. Owner-action items — nothing else can proceed on these without you

| Item | Status | What's needed |
|---|---|---|
| Stripe secret/publishable keys + Connect Client ID | **Not set** | dashboard.stripe.com → Developers → API keys; Settings → Connect settings for Client ID (`ca_...`) |
| Plaid Client ID + Sandbox secret | **Not set** | dashboard.plaid.com → Team Settings → Keys |
| Twilio Account SID + Auth Token | **Not set** | twilio.com/try-twilio (free trial). Webhook URL once set: `https://folio-api.rsolistx.workers.dev/api/sms/inbound` (already has real signature verification wired) |
| Naming | **Resolved** — "Truepost" confirmed as the shipping name | — |
| Pricing model | **Recommendation given, not yet decided by owner** — flat monthly subscription, no per-seat/per-client scaling, annual option at a discount. Rationale in prior conversation turn. | Owner picks the actual price point |

## 4. Native e-signature — the real next milestone (not third-party DocuSign)

**Correction from earlier in this session:** the "M6: wire DocuSign" item in the old roadmap referred to `apps/api/src/services/docusign.ts`, a wrapper around the actual third-party DocuSign API. That is **not** what the product wants — the goal is an in-house system that supersedes DocuSign, not a dependency on it. Do not wire the third-party `docusign.ts` service; the correct next milestone is closing the gap on the **native** e-sign system (`native-esign.ts`).

### What's real today (`docs/NATIVE_ESIGN_STATUS.md`, verified accurate)
Signs ordinary business documents (engagement letters) with real evidence: SHA-256 digest, signer name/email, timestamp, IP address, user agent, stored in R2 with an audit event. This is genuinely solid and already better UX than DocuSign for its scope.

### What's explicitly blocked, by design
IRS Form 8878/8879 remote signing. The API rejects those forms today. This is the correct, honest current state — do not market current native e-sign as IRS/UETA/ESIGN compliant.

### DocuSign competitive research (done this session)

**Pricing (2026):** Personal $10-15/mo (5 envelopes/mo cap); Standard $25-45/user/mo (~100 envelopes/yr); Business Pro $40-65/user/mo; newer "Intelligent Agreement Management" tiers run $40-95/user/mo. No free tier. Add-ons stack on top: SMS delivery $0.40+/send, ID verification $2.50+/attempt. DocuSign has **no dedicated IRS 8878/8879 product** — tax pros manually layer DocuSign's generic Identity Verification/KBA add-on onto standard envelopes, and that add-on typically requires Enterprise tier plus a separate contract.

**What real IRS compliance requires** (IRS Publication 1345 — [pdf](https://www.irs.gov/pub/irs-pdf/p1345.pdf)):
- Third-party KBA (knowledge-based authentication: multiple-choice questions from credit-history data, not just an ID photo) at **every remote electronic** signing event. **Correction:** the multi-year-relationship exception applies to *in-person* signing only (p.16), not remote. A pen-signed form returned by fax/email/website is not a remote e-signature and needs no identity check at all (p.17).
- Must record: digital image of the signed form, signature date/time, taxpayer IP address, login ID, signing method, name/address/DOB.
- Compliance standard: NIST SP 800-63 Identity Assurance Level 2 (IAL2).
- Retention: 3 years minimum (matches what the native system already targets).
- **Confirmed from the Pub 1345 PDF (Rev. 12-2025):** 3 failed KBA attempts, then a handwritten signature is required. The PDF does not set a question count; that is vendor-defined.

**KBA vendor reality:** LexisNexis and Experian are the two vendors DocuSign itself sources KBA from — genuine credit-history-quiz KBA, not document/selfie checks. IDology also offers it. (Persona and Jumio are document+biometric verification, not the same thing — don't substitute them.) No public self-serve pricing exists for any of these; typical small-practice spend through DocuSign's own markup lands around $5,000-$10,000/year for a few hundred verifications, direct-vendor pricing likely lower but requires a sales call.

### Gap-to-parity list

**Buildable in-house, zero marginal cost:**
- PIN + form-specific authorization data capture
- Sealed/immutable retention with 3-year policy enforcement
- Audit export/verifier tooling
- ERO/e-file operating-control workflow (block 8878/8879 signing until KBA passes)

**Cannot be zero-cost, no way around it:**
- The KBA identity-verification step itself. This is the one piece of real IRS compliance that requires paying a credit-bureau-grade vendor (LexisNexis or Experian) per signing event — budget for this specifically before enabling remote 8878/8879 signing. Everything else above is free; this one line item is not, and that's true for DocuSign too — they're paying the same vendors under the hood and marking it up.

### UPDATE 2026-09-22: built (uncommitted until owner approves)

Zero-cost 8879/8878 signing is built, tested, and documented. Read `docs/NATIVE_ESIGN_STATUS.md` (current state) and `docs/ESIGN_DOCUSIGN_GAP_ANALYSIS.md` (scorecard and next zero-cost gaps).
- Live: pen-sign link with photo upload plus staff review, in-office e-sign with ID capture, returning-client shortcut, evidence packet, integrity verify, transmission gate on `submitReturn`.
- Built but off: remote KBA e-sign. Vendor adapters in `apps/api/src/services/kba-providers.ts` (`implemented: false`).
- **Migration `0061_efile_signature_authorizations.sql` must be applied to production Neon (`npm run db:migrate:neon`) and verified (`npm run db:verify:neon`) before deploying the API**, or the new E-sign panel will 500.

### Original recommended sequence (steps 1-2 done)
1. Read the actual Pub 1345 PDF section on KBA question count/thresholds before writing signing logic.
2. Build the zero-cost pieces first (PIN capture, immutable retention, audit export, ERO gating) — real progress, no vendor dependency, no cost.
3. Get a direct quote from LexisNexis or Experian for KBA-as-a-service before committing to a vendor or a price point to charge for 8879 signing as a feature.
4. Only then wire the KBA step in and lift the 8878/8879 block.

## 5. Also still open (lower priority than native e-sign)

- **M7 — Tax Workbench**: real workbench page separate from the raw workpaper tab, extraction reuse from receipts/bank, review queue, prep-status dashboard. Not started.
- **M8 — Return engine**: federal/state calculations, MeF/IRIS submission, ack/reject handling, state apportionment. Not started. Correctly deferred — this is the biggest, most regulatorily complex piece and should come last.
- **PWA audit was bounded, not exhaustive** — covered push notifications, dead shortcuts, and the `/api/*` no-cache security guarantee. Not yet covered: full Lighthouse PWA score, iOS install-prompt quirks, deep offline-capability testing, maskable-icon safe-zone verification.
- **QuickBooks OAuth** — service exists, unconfigured, not prioritized (no key request from owner yet).
- **HyperFormula** — intentionally kept in evaluation mode until there's revenue to justify the commercial license (owner's explicit call, zero-cost bootstrap phase).

## 6. Verification status as of this handoff

- `npm run typecheck` — 0 errors (web + api)
- `npm run test` — 475+ API tests, 81 web tests, 42 script tests, all passing, 0 failures
- `npm run build` — clean, both workspaces
- Live production smoke test (`scripts/smoke-production.ps1`) — **full pass, exit 0**, self-cleaning, zero residue confirmed independently
- `scripts/verify-neon-schema.mjs` — all checks pass, including the 4 new ones added this session for the bugs found
- Production health: `https://folio-api.rsolistx.workers.dev/api/health` reachable, Workers AI enabled
- Git: `origin/main` matches local `HEAD`, working tree clean

## 7. Files worth knowing for next session

- `apps/api/src/services/native-esign.ts` — the in-house signer to extend (not `docusign.ts`, which wraps the third-party service and should stay unwired)
- `docs/NATIVE_ESIGN_STATUS.md` — the honest current-state doc, keep it honest as this evolves
- `scripts/smoke-production.ps1` — the real end-to-end test; run it after any schema or pipeline change, not just typecheck/build
- `scripts/verify-neon-schema.mjs` — add a check here for every new migration's tables/columns, immediately, not later
- `SMOKE_CLEANUP_TOKEN` — saved at `C:\Users\rdsol\OneDrive\Desktop\Truepost-SMOKE_CLEANUP_TOKEN.txt` and set as the live Cloudflare secret

## 8. Session of 2026-09-22/23: compliance pass (uncommitted until owner approves)

Read `docs/LEGAL_COMPLIANCE_REVIEW.md` and `docs/competitive-intelligence/2026-09-22_PHYLLIS_DEEP_DIVE_AND_GAP_ANALYSIS.md`.

**Deploy in this exact order** (the app shows a two-step sign-in enrollment screen that fails if the auth table is missing):
1. `npm run db:migrate:remote -w @folio/api` (D1: `migrations/0003_two_factor.sql`)
2. `npm run db:migrate:neon` then `npm run db:verify:neon` (Neon: 0061 e-file signing, 0062 tax_returns 'voided', 0063 taxpayer consents)
3. Deploy API and web.
4. Owner enrolls two-step sign-in; update `scripts/smoke-production.ps1` to handle it; then set Worker var `REQUIRE_MFA=true`.

**Behavior change on deploy:** automatic receipt reading stops for every client until that client signs the IRC § 7216 disclosure consent (Client consent card, Upload or E-sign tab). Receipts still upload and wait for manual entry. Send consent links first.

Open items: attorney review of consent wording; operating entity legal name for the consent; US-only reading provider (removes the foreign-disclosure/SSN risk); app-wide accent is green on older screens while the logo is blue.

### Added 2026-09-23
- Migration `0064_mileage_trips.sql` (Neon). Run with the others in step 2.
- **US-only reading:** create a free Azure AI Document Intelligence resource (pricing tier F0) in a US region, then set Worker secrets `AZURE_DI_ENDPOINT`, `AZURE_DI_KEY`, and vars `AZURE_DI_REGION` (e.g. `eastus`) and `US_ONLY_READING=true`. Consent is then not required and the consent emails stop on their own. F0 limits: 500 pages/month, first 2 pages of each PDF, 4 MB files.
- **Consent emails:** set `RESEND_API_KEY` (free tier) and `SENDER_EMAIL` to have links emailed each morning; without it, clients are asked in the portal.
- **R2 US jurisdiction** (Cloudflare, Aug 2026) guarantees stored files stay in the US. Needs a new bucket created with `jurisdiction = "us"` and a one-time copy of existing objects; not done yet.
