# Folio Agent Bridge Control Plane

This branch is the durable control channel between ChatGPT, the local Windows terminal, and OpenAI Codex CLI.

The production branch remains `main`. The bridge must never merge `agent-control` into `main`.

## Transport

ChatGPT writes task JSON files under `.agent-bridge/inbox/` on this branch. A local Windows bridge fetches `origin/agent-control`, validates each task, runs Codex non-interactively inside the registered project working copy, and writes redacted result JSON under `.agent-bridge/outbox/`.

The bridge uses normal Git instead of the local GitHub CLI, so the separate private-repository `gh` visibility problem does not control execution.

## Autonomous specialist team

The bridge is a coordinator and builder, not a single undifferentiated coding prompt. Before substantive work it selects relevant specialist agents from `.agent-bridge/runtime/specialists.json` and runs separate read-only Codex consultations. The current roster includes product strategy, tax/e-file compliance, security/privacy, visual design, UX/accessibility, AI automation, integrations/data, Windows desktop, audio/multimedia, and hostile QA/release review.

The lead Codex invocation also enables Codex multi-agent collaboration. When collaboration tools are available, the lead is explicitly instructed to delegate parallel research, design, security, tax, integration, implementation, and testing work to subagents, then integrate and verify the result. Specialist advice never substitutes for verification by the lead.

A mandatory independent QA agent reviews completed work. For non-production work, one focused repair pass is allowed when QA returns `NEEDS_FIX`, followed by another independent review. Production release tasks never receive an automatic repair/retry after production activity.

## Required safety model

- Never use `--dangerously-bypass-approvals-and-sandbox`.
- Read-only consultations use `codex exec --sandbox read-only`.
- Mutating `work` and authorized `release` tasks use `codex exec --approve-for-me`. Do not also pass `--sandbox`, because current Codex treats those modes as conflicting.
- Network access is enabled only when the task explicitly sets `network: true`.
- Reject a task if its `expected_sha` does not match the target project's current HEAD unless `expected_sha` is omitted.
- Reject production mutation unless `production_authorized` is explicitly true.
- Never execute a task outside a registered local project path.
- Serialize tasks per project. Never run two mutating tasks concurrently in one repo.
- Store Codex activity only in local logs, redact them before persistence, and publish only redacted summaries to Git.
- Redact PostgreSQL URLs, URI credentials, bearer tokens, obvious secret assignments, API keys, passwords, and long token-like values.
- A failed or rejected task blocks the remaining queue until that failure is deliberately corrected. Do not skip past a failed release or migration.
- Exit or block rather than guessing after a deterministic gate failure.

## Task file contract

Each inbox file is JSON with this shape:

```json
{
  "id": "unique-task-id",
  "project": "Tax-Build-Alpha",
  "repo": "rsolistx-ui/Tax-Build-Alpha",
  "expected_sha": "optional exact git SHA",
  "instruction": "Complete task description",
  "mode": "work",
  "network": false,
  "production_authorized": false,
  "commit_push": false,
  "max_minutes": 90
}
```

Valid `mode` values are `read`, `work`, and `release`. `release` additionally requires `production_authorized: true`.

## Result file contract

The bridge writes one outbox JSON file per task with at least:

```json
{
  "id": "same-task-id",
  "status": "completed|failed|rejected",
  "started_at": "ISO-8601",
  "finished_at": "ISO-8601",
  "project": "Tax-Build-Alpha",
  "start_sha": "...",
  "end_sha": "...",
  "exit_code": 0,
  "specialists": ["visual_design", "ux_accessibility"],
  "summary": "redacted final result",
  "log_path": "local path only",
  "production_mutation": false,
  "bridge_version": "..."
}
```

## Heartbeat and health

The bridge publishes `.agent-bridge/heartbeat/<machine>.json` on meaningful state transitions and periodically during long Codex runs. States include `starting`, `idle`, `running`, `blocked`, and `error`. The health watcher can therefore distinguish an idle worker from a dead worker or a task stalled without progress.

## Local installation

Install target:

`C:\Users\rdsol\AppData\Local\OpenAI-Agent-Bridge`

Scheduled Task:

`OpenAI Agent Bridge`

The task starts at user logon and restarts after process failure. It runs as the current user, not SYSTEM, so existing Git and Codex authentication remain available. The bridge uses a dedicated `agent-control` clone inside the install directory and never checks out that branch inside `C:\Tax Build Alpha`.

The supported bootstrap entry point is `.agent-bridge/runtime/InstallSafe.ps1`. It installs the corrected runtime, runs deterministic bridge self-tests, performs a harmless read-only Codex smoke test, registers the Scheduled Task, starts the worker, and waits for a heartbeat.

The installed `Manage.ps1` supports `start`, `stop`, `status`, `update`, `run-foreground`, and `uninstall`.

## Project registry

Initial project:

- Name: `Tax-Build-Alpha`
- Local path: `C:\Tax Build Alpha`
- GitHub repo: `rsolistx-ui/Tax-Build-Alpha`
- Work branch: `main`
- Control branch: `agent-control`

The design can be extended to additional repositories later without merging the control branch into product code.
