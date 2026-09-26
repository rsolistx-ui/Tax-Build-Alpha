# Truepost Commercial-Grade Release Plan

**Status:** Active. Milestone 0.1 containment released; hardened replacement remains planned.  
**Last updated:** 2026-09-26

## Product position

Truepost is not trying to replace every accounting tool or every spreadsheet. It is the tax firm's evidence-to-tax-ready operating system:

> Truepost turns client evidence into reconciled, review-ready, tax-ready work, so staff clear exceptions and preparers approve traceable results instead of chasing, entering, matching, and rechecking data.

The moat is not OCR. It is the connected, approval-gated workflow and evidence trail:

`client request → evidence → extraction → review → bank match → reconciliation → workpaper → tax-software handoff`

## Architecture target

```text
Client surface
  portal • upload • mobile • requests • signing
                 ↓
Evidence pipeline
  upload → scan → extract → classify → dedupe → match
                 ↓
Human approval layer
  exception queue • rules • assignments • approvals • audit
                 ↓
Books + tax workpapers + firm operations
                 ↓
Trust and operating plane
  auth • roles • audit • recovery • jobs • alerts • releases
```

## Verified current position

Already built in the current repository: staff roles and client assignment; client balance sheet and cash flow; tax-handoff inputs and workpapers; beta metrics; public status; Wave/QBO-export and prior-year CSV imports; Azure Document Intelligence extraction; native signing and e-file signature evidence.

Still not a completed capability: tax-return computation and IRS return transmission; 1099 recipient preparation/IRIS filing; configured and proven live bank feeds, card payments, Turnstile, Telegram, and QuickBooks live sync; payroll; SSO/SAML and SCIM.

## Release-blocking findings

| Priority | Finding | Required repair |
| --- | --- | --- |
| P0 | Fast-Pass can create a 30-day session without completing an authenticator challenge. | Disable it immediately; rebuild as a secure device-pairing flow. |
| P0 | Fast-Pass uses short `Math.random()` codes with no demonstrated throttling and non-atomic redemption. | Use cryptographically secure, hashed, short-lived tokens; rate limits; atomic redemption; post-pairing MFA. |
| P1 | Some routes issue runtime `CREATE TABLE IF NOT EXISTS`. | Put all schema changes in migrations; remove runtime DDL and DDL permissions from the application identity. |
| P1 | The normal Neon migration command can replay historical migrations and fail. | Repair the migration ledger/runner; verify schema before release. |
| P1 | CI has no staging release, deployment approval, schema gate, dependency scan, secret scan, or restore proof. | Establish an evidence-producing release train. |
| P1 | Important side effects can fail in broad silent catches. | Use a durable outbox, retries, visible failure queue, and alerts. |
| P2 | `npm audit --omit=dev` identifies two moderate transitive `uuid` findings via `exceljs`. | Upgrade safely or document a time-bounded risk acceptance. |

## Milestone 0 — secure the foundation

### 0.1 Disable and rebuild Fast-Pass

**Containment completed 2026-09-26:** removed the Fast-Pass UI and both session-minting endpoints from the production surface. Production verification on Worker version `49fbaa68-6268-4333-ac43-d4c40058a7cf` returned `404` for the retired claim endpoint.

**Replacement action:** build a secure device-pairing flow only after the requirements below are implemented.

Replacement design:

- Owner-only issuance enforced server-side.
- A cryptographically secure pairing secret, stored only as a hash.
- Ten-minute expiry; one use; atomic `UPDATE ... WHERE redeemed_at IS NULL ... RETURNING` redemption.
- Per-IP, per-account, and per-token rate limits.
- TOTP or passkey challenge after pairing and before a normal session is issued.
- Audit events for issue, failed claim, successful claim, revocation, and device revocation.
- Owner action to revoke all paired devices.

**Acceptance evidence:** no pairing path bypasses MFA; concurrent claims yield one session; rate-limit tests return 429; all pairing actions are auditable.

### 0.2 Deterministic schema management

**Completed 2026-09-26:** migration 0080 created the checksum ledger and moved the formerly runtime-created support and intercompany tables into the migration train. Production's 79 verified historical migrations were recorded as a one-time baseline; migration 0080 was applied through the new direct-connection runner. A normal rerun now reports no pending migration, and the production verifier checks 132 required schema objects.

- Remove runtime DDL from request handlers.
- Add a migration ledger with checksum, applied timestamp, and deploy SHA.
- Make the migration runner apply only unapplied migrations and fail on drift.
- Require schema verification in staging and production releases.
- Restrict the application database identity from schema mutation.

**Acceptance evidence:** empty staging migrates cleanly; a production request cannot create a table; release fails on schema drift.

### 0.3 Controlled release train

```text
pull request
  → typecheck, tests, dependency/secret checks
  → isolated migration rehearsal
  → staging deployment
  → browser/API/permission smoke tests
  → release approval
  → production migration verification
  → production deployment
  → semantic production smoke test
  → retained release evidence
```

Create distinct local, staging, and production Worker/database/storage environments. Add deployment manifests, rollback procedures, and a staging rollback drill.

## Milestone 1 — operate safely under failure

### 1.1 Durable outbox and jobs

Every critical user action commits its business record, audit event, and outbox event together. A worker processes the event idempotently; failures retry and become visible to operations.

Use this for reminders, support notifications, push events, receipt extraction retries, bank reconnect alerts, and signature follow-up.

**Acceptance evidence:** deliberately failed provider calls retry correctly, never double-send, and appear in an operations queue.

**In progress, durable email, signing, and receipt-recovery slices released 2026-09-26:** migrations 0081–0088 add a checksum-tracked outbox plus bounded receipt-extraction recovery. Support tickets, rule directives, document reminders, signature follow-ups, and transient receipt-reader failures now record delivery intent or recovery state with their originating business writes. The receipt recovery uses the existing job and immutable R2 source, rechecks §7216 consent before each provider call, retries no more than four times, and atomically fences final persistence with a claim-token finalization lease so a stale Worker cannot overwrite a newer outcome. Source evidence is intentionally retained even after terminal extraction failure. Signature reminders use a separately versioned encryption key; a row-locked stage operation, a final claim check, and an independent concurrency audit protect staff-issued links, retries, and stale Workers. Email uses the provider idempotency key. Telegram is a separate, durable supplemental alert with at-least-once delivery semantics. The owner dashboard surfaces dead-letter count. Remaining rollout: bank reconnect alerts and push delivery; add integration coverage against a disposable database and provider failure fixture. During an auth-key rotation, retain `OUTBOX_DELIVERY_LEGACY_AUTH_KEY` until legacy rows drain.

### 1.2 Recovery and continuity

- Define and test recovery-point and recovery-time objectives.
- Configure/document Neon recovery and R2 retention/versioning.
- Export critical audit and release evidence independently.
- Run a quarterly isolated restore drill.
- Reconcile restored document hashes, signatures, transactions, and audit events.

**Acceptance evidence:** a representative tenant restores into isolation within the stated objective and reconciles correctly.

### 1.3 Operational observability

Measure route latency/error rates, queue age/retries, provider results, email delivery, bank connection freshness, authentication anomalies, and release version. Assign alert owners and hold a weekly operations review.

## Milestone 2 — prove the workflow moat

### 2.1 Unified exception workbench

One cross-client queue for missing evidence, uncertain extraction, unmatched bank activity, suspected duplicates, category conflicts, approval requirements, 1099/W-9 gaps, tax-handoff gaps, signatures, and provider failures.

Every item explains why it exists, shows evidence and confidence, assigns an owner/due date, proposes a resolution, and keeps a full history.

### 2.2 Evidence graph and explanation engine

Every tax-handoff field must trace backward to its workpaper calculation, approved transaction/journal, bank match or extraction, original evidence, uploader/time/hash, rules used, edits, and approvals.

### 2.3 Firm learning from approved decisions

Propose scoped rules only from recurring approved corrections. Require authorized activation, keep every action reversible, and automatically pause rules whose quality degrades. Never allow a black-box agent to edit books autonomously.

### 2.4 Outcome instrumentation

Measure document-completion time, avoided follow-ups, upload-to-approved-categorization time, no-edit extraction rate, accepted auto-match rate, exception age, review time per client, tools displaced, support response time, and service reliability. Establish baseline data before making claims.

## Milestone 3 — create switching value

### 3.1 1099 preparation during TCC approval

Build W-9-backed recipient records, payee matching, tax-year threshold logic, attorney exceptions, W-9 follow-up, draft recipient PDFs, filing summaries, approval checklists, exports, corrections, and audit evidence. Keep IRIS transmission disabled until the TCC, required testing, and end-to-end acknowledgement workflow are proven.

### 3.2 Safe live bank feeds

Add Teller or Plaid only after durable jobs exist. Include connection health, freshness, duplicate protection, reconnection tasks, customer-safe notifications, import previews, and reconciliation exceptions.

### 3.3 Migration concierge

Turn importing into a service: preview, mapping explanation, duplicate/date detection, source-to-imported-total reconciliation, row-level errors, rollback before approval, and a migration completion certificate.

### 3.4 Exceptional client portal

One prioritized checklist; plain-language reasons; camera/mobile upload; receipt confirmation; visible status; contextual questions; no automatic tax advice.

## Milestone 4 — enterprise controls after workflow proof

Build SSO/SAML, SCIM, device/session administration, immutable audit export, configurable retention and legal hold, IP restrictions, vendor package, security questionnaire responses, accessibility evidence, tested incident response, tenant export/deletion tooling, and published support/service objectives.

## Milestone 5 — tax-season operating system

The finished journey is: guided onboarding and migration; dynamic checklist; evidence intake; extraction/matching/classification; exception-driven staff work; continuous reconciliation; tax workpapers and 1099 batches; preparer readiness review; tax-software handoff or later approved transmission; post-season outcome report.

## Success criteria

- Staff review time per client reduced by at least 30% from baseline.
- Document completion materially faster than the firm's prior process.
- More than 70% of incoming evidence reaches a correct suggested state without material correction.
- Every material output traces to evidence and approval history.
- No critical side effect can fail silently.
- Restore drills meet the stated recovery objective.
- Production reliability meets the agreed threshold, including retries.
- Pilot firms can cancel one or more real tools because Truepost replaces an actual workflow.
- Phyllis would be materially worse off returning to the prior process.

## Market principle

Do not sell generic AI bookkeeping. Sell a measured, evidence-backed tax-firm operating system: less chasing, less re-entry, fewer subscriptions, faster review, and defensible client work.
