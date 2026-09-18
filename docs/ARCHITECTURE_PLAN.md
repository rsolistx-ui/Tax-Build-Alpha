# Folio Architecture Plan — "Insane Build" for Phyllis & Tax Professionals

## Executive Summary

Transform Folio from a strong solo-practitioner tool into the **active intelligence platform** that eliminates app-switching for Phyllis and her network of tax professionals. Every feature serves the vision: **Phyllis wakes up, sees everything at a glance, approves 3 agent tasks with one tap, done.**

---

## Quantitative Foundation: Phyllis's Survey + Implied Needs

| Survey Statement | Quantified Need | Implied Need | Implementation |
|------------------|-----------------|--------------|----------------|
| "10+ hrs/week on receipts" | ~520 hrs/yr | Multi-page, handwriting, phone-camera quality | ✅ Done (multi-page PDF, multi-image, handwriting prompts) |
| "Transaction-by-transaction bank review" | ~200 txns/mo | Auto-reconciliation after sync | ✅ Bank recon after sync |
| "Manually building P&Ls in Excel" | ~40 hrs/mo | Native double-entry + auto-journals | ✅ Accounting ledger + AR/AP journals |
| "Chasing missing docs by email" | ~15 hrs/mo | Exception→request→portal automation | ✅ Done |
| "App-switching = core complaint" | 5+ apps/day | **Single workspace** | All integrations in Folio |
| "Wave 10-file upload cap" | Blocking | **No batch cap** | ✅ Done |
| "Re-categorizing same merchant" | Repetitive | **Merchant memory** | ✅ Done |
| **Implied: Payroll-adjacent clients** | Likely | Payroll partner + 1099 automation | Phase 9 |
| **Implied: Messy source docs** | Box-of-receipts | Multi-page, glare, perspective OCR | ✅ Done |
| **Implied: Network of tax pros** | Referral signal | Multi-user, advisor marketplace | Phase 10 |

**Key Insight**: Phyllis is a **solo preparer at box-of-receipts scale** with payroll-adjacent clients. She needs **intake quality + evidence-chasing depth**, not Wave-parity bookkeeping. The "read between the lines" items (multi-page, handwriting, phone-camera) are force multipliers for her volume.

---

## Architecture Principles

1. **Single Workspace**: No app-switching. All integrations (Stripe, Google Calendar, QuickBooks, Xero, Plaid, DocuSign, Gmail) work **inside Folio**.
2. **Active Intelligence**: Agents work 24/7; Phyllis only approves. Dashboard shows "what needs me now."
3. **Human Authorization Guardrail**: Every autonomous capability declares `autonomy: approval_required` for client-facing/money/filing actions.
4. **Real-time by Default**: SSE for live updates; optimistic UI with background sync to Neon.
5. **Data Ownership**: Import from anywhere (Wave, QB, Xero, CSV), export to anywhere (MeF, PDF, CSV, API).
6. **Audit-First**: Every action logged to `audit_events`; SOC-2 ready from day one.
6. **Phone-First Intake**: PWA with camera → OCR → extraction → review flow.

---

## Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Runtime** | Cloudflare Workers (Hono) | Edge, zero cold start, built-in KV/R2/D1 |
| **Database** | Neon Postgres | ACID, branching, serverless, pgvector ready |
| **Blob Storage** | Cloudflare R2 | Receipts, PDFs, documents |
| **Auth** | Better Auth (D1) | Sessions, OAuth, MFA ready |
| **AI/ML** | Workers AI (Qwen) + Groq/Gemini fallback | Receipt extraction, categorization |
| **Frontend** | React 18 + Vite + Tailwind | PWA, SSR-ready, design system |
| **Real-time** | Server-Sent Events (SSE) | Simpler than WS, works on Workers |
| **Payments** | Stripe Connect | Invoicing, ACH, cards, webhooks |
| **Calendar** | Google Calendar API (OAuth) | Two-way sync, reminders |
| **E-sign** | DocuSign (JWT auth) | Engagement letters, 8879 |
| **Bank** | Plaid (encrypted) + Teller | Sync only, no webhook dependency |
| **Accounting** | QB Online (OAuth) | Two-way sync with conflict resolution |

---

## Phase Implementation Plan

### Phase 1: Payment Gateway + Recurring Invoices (Week 1-2)
**Goal**: Phyllis sends invoice → client pays in Folio → auto-reconciled

| Component | Details |
|-----------|---------|
| **Stripe Connect** | OAuth onboarding, webhook handling, refunds/disputes |
| **Invoice Payment** | "Pay Now" button on invoice PDF + portal, auto cash-receipt journal |
| **Recurring Invoices** | Schedule (weekly/monthly/quarterly), agent task for approval before send |
| **Payment Reminders** | Escalating: 7d, 3d, 1d, overdue → agent drafts email for approval |
| **Payment Links** | Standalone payment pages for ad-hoc collections |
| **Database** | `stripe_customers`, `stripe_payment_methods`, `invoice_schedules`, `payment_reminders` |

**Files**: `services/stripe.ts`, `routes/stripe.ts`, `routes/billing.ts` (extend), migration

---

### Phase 2: Google Calendar Integration (Week 2)
**Goal**: Deadlines ↔ Calendar two-way; reminders push to phone

| Component | Details |
|-----------|---------|
| **OAuth Flow** | `google_calendar_config` table, token refresh, revoke |
| **Two-way Sync** | Deadline calendar events → Google Calendar; manual GCal events → Folio (optional) |
| **Reminders** | 7d/3d/1d before deadline → agent task for approval → notification |
| **Conflict Resolution** | Last-write-wins + audit log |
| **Database** | `google_calendar_config`, `calendar_event_mappings` |

**Files**: `services/google-calendar.ts`, `routes/google-calendar.ts`, migration

---

### Phase 3: Wave Import Migration Tool (Week 2-3)
**Goal**: One-click migration from Wave CSV export

| Component | Details |
|-----------|---------|
| **CSV Parsers** | CoA, clients, invoices, transactions, receipts, bank connections |
| **Mapping UI** | Wave categories → Folio CoA, payment methods → Stripe |
| **Idempotent Import** | Re-run safe; preserves invoice numbers, payment history |
| **Validation Report** | Pre-import preview with row-level errors |
| **Rollback** | Single-click revert entire import |

**Files**: `services/wave-import.ts`, `routes/wave-import.ts`, web components

---

### Phase 4: PWA Foundation + Mobile Camera OCR (Week 3-4)
**Goal**: Phyllis scans receipt on phone → instant extraction → review in Folio

| Component | Details |
|-----------|---------|
| **Service Worker** | `workbox` via Vite plugin, offline receipt capture queue |
| **Manifest** | `manifest.json`, icons, `beforeinstallprompt` handling |
| **Camera Capture** | `getUserMedia` + `ImageCapture`, auto-focus, flash, grid overlay |
| **Perspective Correction** | OpenCV.js (WASM) for document detection + warp |
| **Glare Detection** | Simple heuristic → retake prompt |
| **Background Sync** | IndexedDB queue → sync to R2 + Neon when online |
| **Real-time Sync** | SSE connection for live agent task updates |

**Files**: `public/sw.js`, `src/hooks/useCamera.ts`, `src/components/ReceiptCamera.tsx`, `vite.config.ts` (PWA plugin)

---

### Phase 5: Estimates → Invoice Conversion (Week 4)
**Goal**: Create estimate → client approves → one-click to invoice

| Component | Details |
|-----------|---------|
| **Estimate Entity** | `estimates` table, line items, status (draft/sent/accepted/expired) |
| **Client Portal View** | Public link (token), accept/decline, e-sign via DocuSign |
| **Conversion** | One-click: estimate → invoice (preserves lines, auto-schedule) |
| **Versioning** | Estimate revisions tracked, audit trail |

**Files**: `services/estimates.ts`, `routes/estimates.ts`, migration, portal page

---

### Phase 6: Project/Tag Profitability (Week 4-5)
**Goal**: Tag transactions/invoices by project → project P&L

| Component | Details |
|-----------|---------|
| **Projects Table** | `projects` (client, name, color, budget, dates) |
| **Tagging** | `transaction_tags`, `invoice_tags`, `receipt_tags` (many-to-many) |
| **Auto-tagging Rules** | Merchant/category → project (merchant memory extended) |
| **Project P&L** | Revenue/expense by project, utilization %, budget vs actual |
| **Reports** | Project dashboard, CSV export |

**Files**: `services/projects.ts`, `routes/projects.ts`, migration

---

### Phase 7: Agentic 24/7 Automation Suite (Week 5-7)
**Goal**: Agents work while Phyllis sleeps; she only approves

| Agent | Trigger | Action | Autonomy |
|-------|---------|--------|----------|
| **Cash Flow Forecaster** | Daily 6am | Project 30/60/90 day cash from AR/AP + recurring | `approval_required` (show forecast) |
| **Tax Deadline Monitor** | Daily 6am | Create tasks for 1040-ES, 941, W-2, 1099, extensions | `approval_required` |
| **Auto-Reconciliation** | Post-bank-sync | Match txns to invoices/bills, flag exceptions | `autonomous` (match), `approval_required` (exception) |
| **Client Health Scorer** | Weekly Mon 6am | Score: overdue AR, missing docs, deadline proximity | `autonomous` (score), `approval_required` (outreach) |
| **Quarterly Tax Estimator** | Monthly 1st | Calculate 1040-ES from YTD P&L + safe harbor | `approval_required` |
| **1099 Preparer** | Nov 1 - Jan 31 | Identify contractors >$600, draft 1099-NEC | `approval_required` |
| **Year-End Closer** | Dec 1-31 | Checklist: reconcile all, post adjustments, lock period | `approval_required` |
| **Client Outreach Drafter** | Weekly | Draft missing-doc/overdue emails for approval | `approval_required` |
| **Receipt Chase Agent** | Receipt uploaded | Link to bank txn, suggest categorization | `autonomous` (suggest), `approval_required` (apply) |
| **Document Classifier** | Upload | Classify W-2/1099/statement → route to correct workflow | `autonomous` |

**Files**: `services/agent-scheduler.ts` (extend), `services/agent-cashflow.ts`, `services/agent-taxdeadlines.ts`, `services/agent-reconciliation.ts`, `services/agent-clienthealth.ts`, `services/agent-taxestimator.ts`, `services/agent-1099.ts`, `services/agent-yearend.ts`, `services/agent-outreach.ts`, routes for each

---

### Phase 8: Real-time Sync (SSE) (Week 7)
**Goal**: Live updates across web, PWA, Tauri desktop

| Component | Details |
|-----------|---------|
| **SSE Endpoint** | `/api/events/stream` — filters by firm, user, resource types |
| **Client Hook** | `useEventStream()` — auto-reconnect, heartbeat, typed events |
| **Event Types** | `agent_task_created`, `invoice_paid`, `deadline_approaching`, `receipt_extracted`, `bank_sync_completed` |
| **Optimistic UI** | Local state → background sync → server confirmation → revert on conflict |
| **Tauri Integration** | Same SSE connection in desktop app |

**Files**: `routes/events.ts`, `src/hooks/useEventStream.ts`, Tauri event bridge

---

### Phase 9: Payroll Partner Integration (Week 8)
**Goal**: Phyllis's payroll-adjacent clients handled without leaving Folio

| Partner | API | Scope |
|---------|-----|-------|
| **Gusto** | Embedded Payroll | Full payroll, tax filings, W-2/1099 |
| **Check** | Payroll API | Flexible, developer-first |
| **Wrapper** | `services/payroll.ts` | Unified interface, webhook handling |

**Files**: `services/payroll.ts`, `routes/payroll.ts`, migration

---

### Phase 10: QuickBooks/Xero Import + Multi-user (Week 8-9)
**Goal**: Phyllis's network onboarding

| Component | Details |
|-----------|---------|
| **QB Import** | OAuth → CoA, clients, invoices, txns, payments |
| **Xero Import** | OAuth → same scope |
| **Team Membership** | `firm_members` table, roles (owner/admin/staff/viewer) |
| **Workload Dashboard** | Capacity view, assignment, rebalancing |
| **Advisor Marketplace** | Profile, reviews, booking (for network) |

**Files**: `services/qb-import.ts`, `services/xero-import.ts`, `services/teams.ts`, routes

---

### Phase 11: Modern Dashboard UI Overhaul (Week 9-10)
**Goal**: "Insane build" — knowledgeable, polished, glanceable

| Component | Details |
|-----------|---------|
| **Design System** | Dark graphite base, rubrication red accent, bento grids, micro-motion (Framer Motion) |
| **Dashboard** | Single screen: AR aging, deadline calendar, agent queue, cash position, client health cards, bank sync status |
| **Glanceable Badges** | Red/amber/green tied to real state (overdue/due soon/ok) |
| **Micro-motion** | Staggered entrance, hover lift, loading skeletons (no fake spinners) |
| **Command Palette** | `Cmd+K` → jump anywhere, create anything |
| **Keyboard Shortcuts** | Power-user navigation |
| **Theme** | Dark default, system preference, high-contrast option |

**Files**: `src/design-system/`, `src/pages/Dashboard.tsx`, `src/components/DashboardWidgets/`, `tailwind.config.ts`

---

## Database Migrations Needed

| Migration | Tables |
|-----------|--------|
| 0027_sync_events | `sync_events` |
| 0033_billing_invoicing | `invoices`, `invoice_lines`, `payments`, `billing_rates` |
| 0034_stripe_integration | `stripe_customers`, `stripe_payment_methods`, `stripe_webhook_events`, `invoice_schedules`, `payment_reminders`, `stripe_connect_accounts` |
| 0035_google_calendar | `google_calendar_config`, `calendar_event_mappings`, `google_oauth_states` |
| 0036_wave_import | `wave_import_jobs`, `wave_import_rows`, `wave_field_mappings` |
| 0037_estimates | `estimates`, `estimate_lines`, `estimate_versions`, `estimate_acceptance_tokens` |
| 0038_projects | `projects`, `project_tags`, `transaction_tags`, `auto_tag_rules`, `project_budget_snapshots` |
| 0039_agent_automation (planned) | `agent_schedules`, `agent_executions`, `tax_deadlines`, `client_health_scores` |
| 0040_payroll (planned) | `payroll_config`, `payroll_employees`, `payroll_runs` |
| 0041_teams (planned) | `firm_roles`, `advisor_profiles` (`firm_members` already exists) |
| 0042_realtime (planned) | SSE uses `sync_events` (0027) — no extra tables required |

---

## API/OAuth Integration Matrix

| Service | Auth | Read | Write | Webhook | Status |
|---------|------|------|-------|---------|--------|
| **Stripe** | OAuth Connect | ✅ Customers, PMs, Invoices | ✅ Payments, Refunds | ✅ payment_intent, invoice, refund | Phase 1 |
| **Google Calendar** | OAuth 2.0 | ✅ Events, Calendars | ✅ Create/Update/Delete | ✅ Push notifications | Phase 2 |
| **DocuSign** | JWT Grant | ✅ Envelopes, Templates | ✅ Send, Void | ✅ Envelope events | ✅ Done |
| **Gmail** | OAuth 2.0 | ✅ Messages, Threads | ✅ Drafts, Send | ❌ (polling) | ✅ Done |
| **Plaid** | Link + OAuth | ✅ Accounts, Transactions | ❌ | ❌ (manual sync) | ✅ Done |
| **Teller** | OAuth | ✅ Accounts, Transactions | ❌ | ✅ Webhooks | ✅ Done |
| **QuickBooks** | OAuth 2.0 | ✅ Full | ✅ Full | ✅ CDC | ✅ Done |
| **Xero** | OAuth 2.0 | ✅ Full | ✅ Full | ✅ Webhooks | Phase 10 |
| **Gusto/Check** | OAuth 2.0 | ✅ Payroll data | ✅ Run payroll | ✅ Payroll events | Phase 9 |
| **Wave** | CSV only | ✅ CSV export | ❌ | ❌ | Phase 3 |

---

## Testing & Audit Strategy

| Checkpoint | Command | Criteria |
|------------|---------|----------|
| **Typecheck** | `npm run typecheck` | Zero errors |
| **Unit Tests** | `npm run test` | 100% pass, coverage >80% new code |
| **Build** | `npm run build` | Success, no warnings |
| **Live Route Probe** | `wrangler dev` + curl | 200/401/403 as expected |
| **Audit Script** | `node scripts/audit.mjs` | All routes mounted, no dead code, audit_events populated |

**Run after each phase completion before proceeding.**

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Stripe Connect onboarding friction | Embedded onboarding in settings, test mode default |
| Google Calendar token refresh | Proactive refresh 5min before expiry, fallback to re-auth |
| PWA service worker caching bugs | Versioned caches, `skipWaiting`, `clients.claim()` |
| Agent runaway (infinite loops) | Max executions per run, circuit breaker, dead letter queue |
| Multi-user data leakage | Row-level security in Neon, firm_id on every query |
| SOC-2 audit trail gaps | `audit_events` on every write, immutable, queryable |

---

## Success Metrics (Phyllis Beta)

| Metric | Target | Measurement |
|--------|--------|-------------|
| **App-switches/day** | < 2 (was 5+) | Self-reported + telemetry |
| **Receipt processing time** | < 30 sec (was 5+ min) | Timestamp: upload → review |
| **Invoice-to-payment** | < 3 days (was 7+) | Stripe webhook → paid_at |
| **Deadline misses** | 0 | Calendar + agent tasks |
| **Manual categorization** | < 5% | Merchant memory hit rate |
| **App-switching elimination** | 100% for bookkeeping/tax prep | Self-reported workflow map |

---

## Next Steps

1. **Create Phase 1 migration** (`0034_stripe_integration.sql`)
2. **Implement Stripe service + routes**
3. **Extend billing routes for payment + recurring**
4. **Run audit → proceed to Phase 2**

---

*This plan is living. Each phase completes with audit before next begins. Scope adjusted based on Phyllis beta feedback.*