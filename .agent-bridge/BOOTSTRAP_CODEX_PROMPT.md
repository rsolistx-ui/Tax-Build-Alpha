# Bridge bootstrap status

The prompt-based bootstrap is retired.

The bridge runtime now exists directly on `agent-control` and no longer depends on asking Codex to write its own bridge before work can start.

Use `.agent-bridge/runtime/InstallSafe.ps1` as the supported one-time installer. It installs the corrected PowerShell runtime, specialist-agent roster, deterministic runtime patch, management utility, Scheduled Task, Codex smoke test, and heartbeat verification.

The runtime uses a dedicated control clone, normal Git transport, read-only specialist consultations, Codex multi-agent delegation for the lead builder, independent QA review, secret redaction, task timeouts, production authorization gates, and queue blocking after deterministic failure.

Never run the old prompt through Codex as a bridge installer.
