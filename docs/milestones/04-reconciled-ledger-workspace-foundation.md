# Milestone 4: Reconciled Ledger + Workspace Foundation

## Goal
Turn Folio from receipt/bank tools into the beginning of a single professional bookkeeping workspace that can replace the core Excel/Wave workflow.

## Product rule
Software prepares. Evidence verifies. The professional decides.

## Scope

### 1. Canonical ledger
Create one authoritative transaction ledger for book activity.

Requirements:
- A bank transaction represents the cash movement when present.
- A matched receipt is supporting evidence, not a second expense.
- Receipt-only activity may create ledger activity when no bank row exists.
- Prevent double counting when a bank transaction and receipt are reconciled.
- Every ledger row must trace to its source bank transaction, receipt, or both.
- Keep all bookkeeping data in Neon.

Supported transaction classes:
- expense
- income
- transfer
- owner_contribution
- owner_draw
- needs_review

### 2. Professional classification workflow
Add explicit user-confirmed classification for bank transactions.

Requirements:
- business vs personal treatment must be explicit
- personal transactions must not enter business P&L
- transfers must not enter income or expense
- owner contributions and draws must not enter operating income or expense
- no silent AI posting
- category changes must be auditable
- existing client-scoped correction memory may be reused only as a suggestion mechanism

### 3. Period model
Add monthly period handling.

Requirements:
- period key format YYYY-MM
- open and closed states
- period summary counts
- close blockers derived deterministically
- cannot close while any of the following exist in that period:
  - unresolved bank exceptions
  - pending linked receipts
  - uncategorized business ledger rows
  - receipt review items in the period
  - needs_review transaction classes
- closing records actor and timestamp
- closed period is read-only for accounting mutations
- reopening requires explicit action and audit event

### 4. P&L source change
Rebuild P&L from the canonical ledger rather than directly from filed receipt totals.

Requirements:
- matched receipt + bank transaction count once
- personal, transfer, owner contribution, and owner draw excluded from operating P&L
- income and expense rows included according to confirmed classification
- category drilldown still traces to exact evidence
- preserve source receipt links
- preserve existing paid-alpha P&L API compatibility when practical

### 5. Permanent workspace shell
Start replacing the temporary card/tab UX with the permanent professional application shell.

Global navigation target:
- Home
- Clients
- Inbox
- Receipts
- Banking
- Transactions
- Books
- Reports
- Tax
- Documents
- Settings

For this milestone, implement the shell and wire only the existing/real capabilities. Do not create fake functionality for future sections.

Client workspace requirements:
- persistent client identity/header
- period selector
- status/workload summary
- durable client-level navigation
- Transactions view using a dense table
- search
- filters
- batch selection foundation
- row detail panel or split pane
- source/evidence links
- clear read-only state for closed periods

### 6. Transaction table
The Transactions view must support:
- date
- description
- amount
- class
- category
- reconciliation/evidence status
- source type
- period
- search by description/merchant
- filter by class/category/status/period
- batch selection UI foundation
- direct source drilldown

### 7. API surface
Add or extend client-scoped endpoints for:
- ledger transaction list
- transaction classification update
- transaction category update
- period summary
- period close
- period reopen
- ledger-backed P&L

Use existing auth and firm/client ownership boundaries.

### 8. Database migration
Add a new Neon migration after 0003.

Prefer a small normalized schema. Do not create duplicate bookkeeping domains if existing bank/receipt tables can be referenced cleanly.

Expected concepts:
- ledger_entries or equivalent canonical ledger table
- accounting class
- business/personal treatment if separate from class
- category reference
- source bank transaction reference
- source receipt reference
- period key
- period close state table
- created/reviewed/closed actor and timestamp fields where needed

All important accounting mutations must be auditable.

### 9. Smoke test
Extend production smoke to prove at minimum:
1. receipt extraction and filing still works
2. bank CSV import still works
3. bank match still works
4. reconciled bank + receipt produces one ledger expense, not two
5. personal classification excludes row from P&L
6. transfer classification excludes row from P&L
7. open period reports blockers when unresolved work exists
8. clean period can close
9. accounting mutation against closed period is rejected
10. explicit reopen succeeds and creates audit history
11. ledger-backed P&L still reconciles to the expected business expense total

### 10. Documentation
Update README to describe:
- canonical ledger
- classification rules
- period close behavior
- ledger-backed P&L
- workspace shell
- current deferred scope

## Deferred
Do not add:
- Plaid or live bank feeds
- payroll
- invoicing
- e-file
- tax form calculation engine
- PDF/Excel export
- bulk receipt redesign beyond what is needed to support the new shell
- speculative AI accounting decisions

## Implementation constraints
- React + Vite + TypeScript frontend
- Hono Worker API
- Neon business data
- D1 auth only
- R2 source evidence
- same-origin Worker delivery
- preserve current working receipt and bank workflows
- no secrets in repo
- no silent fallback to mock production data
- no direct commits to main

## Acceptance gate
Before PR merge:
- npm ci
- npm run typecheck
- npm run build
- PowerShell scripts parse successfully
- diff reviewed for scope
- CI green

After merge:
- apply Neon migration
- deploy Worker + SPA
- run full production smoke
- do not mark milestone complete until production smoke passes
