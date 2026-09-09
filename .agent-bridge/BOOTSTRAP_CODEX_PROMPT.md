Build and install the autonomous Windows bridge described in `.agent-bridge/README.md`, then start it and leave it running. This is a one-time bootstrap. The user does not want to relay instructions between ChatGPT and Codex anymore.

Repository working copy: `C:\Tax Build Alpha`
Repository: `rsolistx-ui/Tax-Build-Alpha`
Production branch: `main`
Control branch: `agent-control`
Install target: `C:\Users\rdsol\AppData\Local\OpenAI-Agent-Bridge`
Scheduled Task name: `OpenAI Agent Bridge`

Use the current repository and Git as the durable message bus. Do not depend on the local `gh` CLI because that CLI account has previously lacked visibility to this private repository even though normal git fetch/push works.

Implementation requirements:

1. Create bridge source under `.agent-bridge/runtime/` on the `agent-control` branch only. Never merge the control branch into `main`.
2. Implement the runtime for Windows PowerShell 7. Keep dependencies to Windows, PowerShell, Git, and Codex CLI only.
3. Use a dedicated control clone under the install directory. Never checkout `agent-control` inside `C:\Tax Build Alpha` and never disturb the user's main working tree.
4. Poll `origin/agent-control` for `.agent-bridge/inbox/*.json`. A task is pending when no same-ID result exists in `.agent-bridge/outbox/`.
5. Validate task JSON strictly. Reject unknown project names, wrong repo names, invalid modes, malformed booleans, nonpositive timeouts, and release tasks without `production_authorized=true`.
6. Initial project registry:
   - project `Tax-Build-Alpha`
   - local path `C:\Tax Build Alpha`
   - repo `rsolistx-ui/Tax-Build-Alpha`
   - work branch `main`
   - control branch `agent-control`
7. Serialize execution per project. Never run two tasks in the same project simultaneously.
8. Before every task, fetch the project's work branch and verify the local path is a Git repo for the expected repository. If `expected_sha` is supplied, require local HEAD to equal it. Do not silently checkout/reset the user's branch to fix a mismatch. Reject and report instead.
9. Invoke Codex non-interactively. Use current supported headless primitives, not deprecated `--full-auto` and never `--dangerously-bypass-approvals-and-sandbox`.
10. For `read` tasks, use a read-only sandbox if no writes are requested.
11. For `work` and `release` tasks, use `codex exec --approve-for-me` so permission requests are routed through automatic review. Do not also pass `--sandbox`, because current Codex treats those as conflicting modes. If task JSON has `network=true`, enable workspace-write network access with the supported config override.
12. Use `--json` and `--output-last-message`. Create the output directory before launching Codex because Codex does not reliably create missing parent directories for the last-message file.
13. Capture Codex stdout/stderr to LOCAL log files only. Never commit raw JSONL logs to GitHub.
14. Enforce `max_minutes`. Terminate an over-time Codex process tree and report failure.
15. Retry only clearly transient process failures such as HTTP 429/rate-limit or temporary network failure, with bounded exponential backoff. Never retry a deterministic test, migration, authorization, or deployment failure as if it were transient.
16. Redact results before writing outbox JSON. At minimum redact PostgreSQL URLs, URI credentials, bearer tokens, API keys, obvious secret assignments, long token-like strings, Neon passwords, Cloudflare tokens, and values whose keys contain PASSWORD, SECRET, TOKEN, API_KEY, DATABASE_URL, AUTH, or CREDENTIAL. Prefer over-redaction to leakage.
17. Result JSON must include id, status, timestamps, project, start_sha, end_sha, exit_code, summary, local log_path, production_mutation, and bridge_version. Never include secret values.
18. To publish results, update the dedicated control clone, pull/rebase `agent-control`, write the outbox file, commit with message `Agent bridge result: <task-id>`, and push. Handle a concurrent control-branch update by fetching/rebasing and retrying safely. Never force push.
19. Maintain `.agent-bridge/heartbeat/<machine>.json` with bridge version, last poll time, active task id if any, and status. Update it at a reasonable interval without creating a commit every few seconds. Commit heartbeat only on meaningful state transitions or no more than once every 10 minutes.
20. Maintain local state and logs under the install directory. Do not use the project repo for volatile state.
21. Provide local commands/scripts for `install`, `start`, `stop`, `status`, `uninstall`, and `run-foreground`.
22. Install a Windows Scheduled Task named `OpenAI Agent Bridge` that starts at user logon and restarts on failure. Run as the current user, not SYSTEM, so existing Git/Codex authentication remains available. Do not store passwords in the Scheduled Task.
23. Before installing, verify `git`, `pwsh`, and `codex` are available and record versions. Run a harmless `codex exec` smoke that returns a fixed string and does not modify the repo.
24. Add a dependency-free self-test suite for JSON validation, expected-SHA rejection, release-authorization rejection, redaction, task deduplication, and result serialization. Run it before installation.
25. Commit and push ONLY bridge/control-plane changes to `agent-control`. Do not modify `main` during bridge bootstrap.
26. After installation, start the bridge and confirm its heartbeat reaches `idle` or `running`.
27. The task `.agent-bridge/inbox/0001-folio-finish-release.json` is already queued. Once the bridge is healthy, it must pick that task up automatically. Do not require another user paste or confirmation.
28. Do not display or repeat any production credential during bootstrap or task execution.
29. If a credential was previously exposed in a terminal transcript, treat it as compromised and do not reuse it. The queued release task contains the production safety requirements.
30. If bootstrap itself encounters a genuinely human-only blocker such as an interactive account login that cannot be completed with cached authentication, write a rejected/failed result and a concise heartbeat reason. Do not repeatedly prompt the user.

Verification before declaring bridge bootstrap complete:

- `main` remains exactly unchanged from its starting SHA.
- `agent-control` contains the runtime source and bootstrap documentation.
- self-tests pass.
- Scheduled Task exists and is enabled.
- bridge process is running under the current user.
- control clone fetch/push works without `gh`.
- heartbeat is published.
- queued task `0001-folio-finish-release` is detected and begins automatically.

Final bootstrap response should be concise. Report only bridge install status, Scheduled Task status, control branch status, heartbeat status, queued task status, and any blocker. Do not print raw command logs or secrets.
