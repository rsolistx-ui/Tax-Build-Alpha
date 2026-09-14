# Build Plan — Folio Tax and Practice OS

Autonomous execution. After every milestone, run `auditor` agent + deep-audit skill before claiming done. Builder never certifies its own work.

## Current position — how far along

~55% to 95% workspace vision. Client work already stays in Folio for one client (receipts, bank, P&L, requests, portal). Milestones 1-4 done. M5 Tax Engine mid-flight: this commit closed audit FAILs (mappings schema, CORS, reversal atomicity, JSONB, validation). Roadmap has 8 milestones; this plan carries through all of them without asking.

## Phyllis gaps vs general tax-professional gaps

Phyllis (Wave/Excel/MyTAXPrepOffice, hotel/travel/food/supplies folders, 10+ hrs bulk-scan pain) drove initial requirements. But the gap analysis identified needs shared across any tax preparer using Folio — those are first-class in this plan, not afterthoughts. Every row below maps to a failure mode seen in competitor research (Wave 10-file cap, MyTAXPrepOffice calc errors, QBO pending-transaction invisibility, TaxDome linear pipelines).

| Gap category | Phyllis-specific | General tax pro | Where it lands |
|---|---|---|---|
| Bulk intake + auto-organization into folders | Hotel/travel/food/supplies by merchant/category | Any firm with box-of-receipts intake | Done (tray) + M5.5 migration localStorage→Neon |
| Bank CSV → normalized, deduped, suggested match | Transaction-by-transaction Excel review | Any cash-basis firm, any bank | Done + M4 provider |
| Business vs personal disposition | Manual per-transaction decision | Every preparer, audit trail required | Done (disposition + audit_events) |
| Chart of accounts → tax form line mapping | Excel P&L → 1040 lines | 1040/1120/1120S/1065/state_CA/NY for any client | M5 close-out (mapping CRUD + seed) |
| Tax adjustment journals (perm/temp/reclass/carryforward/state_mod) | Not yet doing tax inside Folio | All entity types, all years | M5 (done) + M5.5 (UI) |
| M-1 reconciliation + finalize | — | 1120/1065 filers | M5 (service) + M5.5 (panel) |
| M-3 (assets ≥$10M corps) | — | Large corps | M5.5 (Part I/II/III + generated per_return) |
| Carryforward tracking + utilization | — | NOL/capital loss/credit firms | M5 (tables) + M5.5 (utilization UI + expiry) |
| State modifications + apportionment | — | Multi-state filers | M5 (tables) + M5.5 (state tab) |
| Tax workpaper (HyperFormula, 23k component) | — | Every return type | M5 (engine) + M5.5 (Neon persistence, done) |
| Diagnostics blocking finalize | — | MyTAXPrepOffice 65% migration / calc errors | M5.5 (drafts/mappings/M-1 checks) |
| Organizer + prefill | W-2/1099/K-1 chasing | Any individual/business organizer | M5.5 (organizer) + M7 (prefill from prior year + extraction) |
| Extensions + 8879 e-sign | — | Every April/October preparer | M5.5 (extensions) + M6 (DocuSign/8879 flow) |
| Prior-year comparison | — | All preparers | M5.5 |
| Workpaper traceability (drilldown to receipt/bank evidence) | P&L must tie to source | Audit defense for any preparer | M5.5 |
| Tax readiness (never auto-finalize) | "Is file ready?" | Every engagement type | M7 (diagnostics → ready_for_preparation, professional approval only) |

## Milestone sequence (do not reorder)

| Milestone | Scope | Audit gate |
|---|---|---|
| **M5 close-out** | Workpaper Neon persistence, reversal atomicity, template/placeholder/CORS/validation fixes, organizer/diagnostics, M-1 finalize. | This commit (typecheck+build+363 tests pass). |
| **M5.5** | Carryforward/state-mod/M-3 panels, prior-year compare, extensions/8879 stub, workpaper traceability, organizer prefill from prior return, diagnostics blocking finalize. | Workpaper survives reload, M-3 per_return calc, carryforward expiry, organizer→workpaper→diagnostics. |
| **M6** | Document + Signature (versioning, field placement, DocuSign evidence, 8879 KBA where required). | Sign request → evidence → audit_events, no secret in VITE_*. |
| **M7** | Tax Workbench (organizer taxonomy, source extraction reuse, prior-year compare, diagnostics review queue, preparation status). | Diagnostics must block ready_for_preparation; never silently auto-finalize (Section 10). |
| **M8** | Regulated Return Engine — separate track, gated on M7 source quality. Federal/state calcs, schemas, MeF, ack/reject, ATS. | ATS + MeF + rejection resolution. Do not start casually. |

## Mobile + desktop surface

- **PWA** (`apps/web/public/manifest.webmanifest` + `sw.js`): installable on iOS and Android (`display: standalone`, `display_override`, `share_target`, `shortcuts`), beforeinstallprompt banner + iOS Share → Add to Home Screen hint, never caches `/api/*` or financial data — shipped `aaaa98e`, polished this commit.
- **Tauri Windows beta** (`src-tauri/`): single-origin webview at `https://folio-api.rsolistx.workers.dev`, origin-locked navigation — shipped `aaaa98e` + polished `fb06e91`.
- **Mobile capture** (`apps/web/src/lib/image-utils.ts` + `client-workspace` capture inputs, `heic2any`): camera/library/file with HEIC conversion — shipped `a602e39`.
- **Not built:** native iOS/Android Capacitor wrapper, offline queue, push notifications, biometric auth — none in current docs/build plan.

## Deferred by design (not in paid alpha)

Payroll, invoicing/AR, queue consumer bulk async, item-level ML beyond correction memory, QBO import-format hardcoding without a real input sheet. See FOLIO_PRODUCT_ROADMAP.md.

## Operating rules

1. Every milestone: auditor agent + deep-audit checklist — entry points (real URL/shortcut), boot clean, every control exercised, round-trip after restart, error paths, cost gates, status honesty, tests. Paste `typecheck`/`test` summary.
2. Push + deploy each milestone; Cloudflare is the origin. Pushed commit + Version ID is the done evidence.
3. No percentage or hours-saved claim until PHYLIS_BETA_ACCEPTANCE_SCRIPT.md is run with Phyllis — see PHYLIS_ACCEPTANCE_MATRIX.md legend.
