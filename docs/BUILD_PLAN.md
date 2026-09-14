# Build Plan — Folio Tax and Practice OS

Autonomous execution. After every milestone, run `auditor` agent + deep-audit skill before claiming done. Entry points and data round-trip must be exercised, not read.

## Current position

Milestone 5 (Tax Engine) is mid-flight. Roadmap has 8 milestones. Progress through 5:

- Done: M1 Unified Practice OS, M2 Accounting Foundation, M3 QBO Provider, M4 Bank Connectivity, partial M5 Tax Engine (adjustments, M-1, mappings, HyperFormula, workpaper tabs + formula bar).
- Now: M5 close-out per audit (this commit). Next: remainder of M5 + M6-M8 autonomous.

## How far along

~55% to 95% workspace vision. Client work already provably stays in Folio for one client (receipts, bank, P&L, requests, portal). Gap to 95% is tax workbench + regulated return engine.

## Milestone sequence (do not reorder — dependencies are real)

| Milestone | Scope | Gate |
|---|---|---|
| M5 close-out | Tax workpaper persistence (Neon tax_workpapers + API), reversal atomicity, template/placeholder/CORS/validation fixes, organizer/diagnostics, M-1 finalize wiring. | This commit. |
| M5.5 | Carryforwards UI, state mods, M-3 panels, prior-year compare, extensions/8879, workpaper localStorage → Neon migration. | Audit: workpaper survives reload, M-3 calc correct, carryforward utilization posts. |
| M6 | Document and Signature system (versioning, DocuSign evidence, 8879 e-sign flow). | Audit: sign request → evidence → audit_events. |
| M7 | Tax Workbench (organizer prefill, source extraction reuse, diagnostics blocking finalize, review queue). | Audit: organizer → workpaper → diagnostics → ready_for_preparation (never auto-finalize). |
| M8 | Regulated Return Engine — separate track, gated on M7 source quality. | Audit: ATS, MeF, ack/reject loop. Do not start casually. |

## Deferred by design (do not build now)

Payroll, invoicing/AR, queue consumer bulk async, item-level ML, QBO format hardcoding without real input sheet. These are explicitly out of the paid alpha.

## Operating rules

1. Every milestone ends with auditor agent (Sonnet) + deep-audit checklist — entry points, boot clean, every control exercised, round-trip, error paths, cost gates, status honesty, tests.
2. Builder never certifies its own work.
3. Push + deploy each milestone; Cloudflare is the origin, not localhost.
4. Pushed commit + Version ID is the done evidence. No prose claims.
