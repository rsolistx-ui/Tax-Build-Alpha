# Folio Agent Bridge Control Plane

This branch is a durable control channel between ChatGPT, the local Windows terminal, and OpenAI Codex CLI.

The production branch remains `main`. The bridge must never merge `agent-control` into `main`.

## Transport

ChatGPT writes task JSON files under `.agent-bridge/inbox/` on this branch. The local bridge fetches `origin/agent-control`, validates each task, runs Codex non-interactively inside the registered project path, and writes result JSON files under `.agent-bridge/outbox/` on this branch.

The bridge uses Git, not the local GitHub CLI, so the existing private-repository `gh` visibility problem is irrelevant.

## Required safety model

- Never use `--dangerously-bypass-approvals-and-sandbox`.
- Use Codex `exec` in non-interactive JSON mode with `--approve-for-me` and `--sandbox workspace-write`.
- Enable network access only for tasks whose task file explicitly sets `network: true`.
- Reject a task if its `expected_sha` does not match the target project's current HEAD unless `expected_sha` is omitted.
- Reject production mutation unless `production_authorized` is explicitly true.
- Never print or persist secrets in task results or bridge logs.
- Never execute a task outside a registered local project path.
- Serialize tasks per project. Never run two mutating tasks concurrently in one repo.
- Preserve full local logs outside Git, but redact common secret patterns before copying summaries to the outbox.
- Exit nonzero and report failure rather than guessing after a gate failure.

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

Valid `mode` values are `read`, `work`, and `release`.

`release` additionally requires `production_authorized: true`.

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
  "summary": "Codex final response, redacted",
  "log_path": "local path only",
  "production_mutation": false
}
```

## Local installation target

The bridge should install under:

`C:\Users\rdsol\AppData\Local\OpenAI-Agent-Bridge`

and register a Windows Scheduled Task named:

`OpenAI Agent Bridge`

The scheduled task should start at logon and restart on failure. A manual foreground runner must also remain available for debugging.

## Project registry

Initial project:

- Name: `Tax-Build-Alpha`
- Local path: `C:\Tax Build Alpha`
- GitHub repo: `rsolistx-ui/Tax-Build-Alpha`
- Work branch: `main`
- Control branch: `agent-control`

The bridge architecture should be generic enough to register more repositories later without code changes.
