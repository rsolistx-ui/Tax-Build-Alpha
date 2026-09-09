param(
    [switch]$SelfTest,
    [switch]$Once
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$BridgeVersion = '1.0.0'
$RepoFullName = 'rsolistx-ui/Tax-Build-Alpha'
$ControlBranch = 'agent-control'
$ProjectName = 'Tax-Build-Alpha'
$ProjectPath = 'C:\Tax Build Alpha'
$WorkBranch = 'main'
$InstallRoot = if ($env:OPENAI_AGENT_BRIDGE_HOME) { $env:OPENAI_AGENT_BRIDGE_HOME } else { Join-Path $env:LOCALAPPDATA 'OpenAI-Agent-Bridge' }
$ControlPath = Join-Path $InstallRoot 'control'
$LogsRoot = Join-Path $InstallRoot 'logs'
$MachineName = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { 'windows-worker' }
$AllowedTaskFields = @('id','project','repo','expected_sha','instruction','mode','network','production_authorized','commit_push','max_minutes')
$script:ActiveTaskId = $null
$script:LastHeartbeatPublish = [datetime]::MinValue
$script:CodexPath = $null

function Get-UtcIso {
    return [datetime]::UtcNow.ToString('o')
}

function Protect-Text {
    param([AllowNull()][string]$Text)
    if ($null -eq $Text) { return '' }
    $value = $Text
    $value = [regex]::Replace($value, '(?i)postgres(?:ql)?://[^\s"''<>]+', '[REDACTED_DATABASE_URL]')
    $value = [regex]::Replace($value, '(?i)https?://([^/\s:@]+):([^@\s]+)@', 'https://[REDACTED_CREDENTIAL]@')
    $value = [regex]::Replace($value, '(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+', 'Bearer [REDACTED_TOKEN]')
    $value = [regex]::Replace($value, '(?i)\b(password|secret|token|api[_-]?key|database_url|credential|authorization)\b\s*[:=]\s*["'']?[^\s,"''}]+', '$1=[REDACTED]')
    $value = [regex]::Replace($value, '\b[A-Za-z0-9_\-]{64,}\b', '[REDACTED_LONG_TOKEN]')
    return $value
}

function Invoke-Git {
    param(
        [Parameter(Mandatory)][string]$Repo,
        [Parameter(Mandatory)][string[]]$Arguments,
        [switch]$AllowFailure
    )
    $output = @(& git -C $Repo @Arguments 2>&1)
    $code = $LASTEXITCODE
    if ($code -ne 0 -and -not $AllowFailure) {
        $safe = Protect-Text (($output | Out-String).Trim())
        throw "git $($Arguments -join ' ') failed ($code): $safe"
    }
    return [pscustomobject]@{ ExitCode = $code; Output = $output }
}

function Sync-Control {
    if (-not (Test-Path (Join-Path $ControlPath '.git'))) {
        throw "Control clone is missing at $ControlPath. Re-run install.ps1."
    }
    Invoke-Git -Repo $ControlPath -Arguments @('fetch','origin',$ControlBranch) | Out-Null
    $branch = (Invoke-Git -Repo $ControlPath -Arguments @('branch','--show-current')).Output | Select-Object -First 1
    if ($branch -ne $ControlBranch) {
        throw "Control clone is on '$branch', expected '$ControlBranch'."
    }
    Invoke-Git -Repo $ControlPath -Arguments @('pull','--rebase','origin',$ControlBranch) | Out-Null
}

function Publish-ControlJson {
    param(
        [Parameter(Mandatory)][string]$RelativePath,
        [Parameter(Mandatory)]$Object,
        [Parameter(Mandatory)][string]$CommitMessage
    )
    Sync-Control
    $target = Join-Path $ControlPath ($RelativePath -replace '/', [IO.Path]::DirectorySeparatorChar)
    $parent = Split-Path -Parent $target
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $json = $Object | ConvertTo-Json -Depth 12
    Set-Content -LiteralPath $target -Value $json -Encoding utf8
    Invoke-Git -Repo $ControlPath -Arguments @('add','--',$RelativePath) | Out-Null
    $diff = Invoke-Git -Repo $ControlPath -Arguments @('diff','--cached','--quiet','--exit-code') -AllowFailure
    if ($diff.ExitCode -eq 0) { return }
    Invoke-Git -Repo $ControlPath -Arguments @('commit','-m',$CommitMessage) | Out-Null
    $push = Invoke-Git -Repo $ControlPath -Arguments @('push','origin',$ControlBranch) -AllowFailure
    if ($push.ExitCode -ne 0) {
        Invoke-Git -Repo $ControlPath -Arguments @('pull','--rebase','origin',$ControlBranch) | Out-Null
        Invoke-Git -Repo $ControlPath -Arguments @('push','origin',$ControlBranch) | Out-Null
    }
}

function Publish-Heartbeat {
    param(
        [Parameter(Mandatory)][string]$Status,
        [AllowNull()][string]$Reason,
        [switch]$Force
    )
    if (-not $Force -and (([datetime]::UtcNow - $script:LastHeartbeatPublish).TotalMinutes -lt 8)) { return }
    $heartbeat = [ordered]@{
        bridge_version = $BridgeVersion
        machine = $MachineName
        last_poll_time = Get-UtcIso
        active_task_id = $script:ActiveTaskId
        status = $Status
        reason = Protect-Text $Reason
    }
    try {
        Publish-ControlJson -RelativePath ".agent-bridge/heartbeat/$MachineName.json" -Object $heartbeat -CommitMessage "Agent bridge heartbeat: $MachineName $Status"
        $script:LastHeartbeatPublish = [datetime]::UtcNow
    } catch {
        $safe = Protect-Text $_.Exception.Message
        Write-Warning "Heartbeat publish failed: $safe"
    }
}

function Test-TaskObject {
    param([Parameter(Mandatory)]$Task)
    $names = @($Task.PSObject.Properties.Name)
    foreach ($name in $names) {
        if ($AllowedTaskFields -notcontains $name) { throw "Unknown task field '$name'." }
    }
    foreach ($required in @('id','project','repo','instruction','mode','network','production_authorized','commit_push','max_minutes')) {
        if ($names -notcontains $required) { throw "Missing required task field '$required'." }
    }
    if ([string]::IsNullOrWhiteSpace([string]$Task.id) -or $Task.id -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{2,100}$') { throw 'Invalid task id.' }
    if ($Task.project -ne $ProjectName) { throw "Unknown project '$($Task.project)'." }
    if ($Task.repo -ne $RepoFullName) { throw "Wrong repo '$($Task.repo)'." }
    if (@('read','work','release') -notcontains [string]$Task.mode) { throw "Invalid mode '$($Task.mode)'." }
    foreach ($field in @('network','production_authorized','commit_push')) {
        if ($Task.$field -isnot [bool]) { throw "Task field '$field' must be boolean." }
    }
    $minutes = 0
    if (-not [int]::TryParse([string]$Task.max_minutes, [ref]$minutes) -or $minutes -le 0 -or $minutes -gt 1440) { throw 'max_minutes must be between 1 and 1440.' }
    if ($Task.mode -eq 'release' -and -not $Task.production_authorized) { throw 'Release task lacks production_authorized=true.' }
    if ($names -contains 'expected_sha' -and $null -ne $Task.expected_sha -and [string]$Task.expected_sha -notmatch '^[0-9a-fA-F]{40}$') { throw 'expected_sha must be a 40-character Git SHA.' }
    if ([string]::IsNullOrWhiteSpace([string]$Task.instruction)) { throw 'Task instruction is empty.' }
    return $true
}

function Get-ProjectHead {
    return ((Invoke-Git -Repo $ProjectPath -Arguments @('rev-parse','HEAD')).Output | Select-Object -First 1).Trim()
}

function Assert-ProjectReady {
    param([Parameter(Mandatory)]$Task)
    if (-not (Test-Path (Join-Path $ProjectPath '.git'))) { throw "$ProjectPath is not the expected Git working copy." }
    $origin = (((Invoke-Git -Repo $ProjectPath -Arguments @('remote','get-url','origin')).Output | Select-Object -First 1) -replace '\\','/').Trim()
    if ($origin -notmatch 'rsolistx-ui/Tax-Build-Alpha(?:\.git)?$') { throw "Unexpected project origin '$origin'." }
    $branch = ((Invoke-Git -Repo $ProjectPath -Arguments @('branch','--show-current')).Output | Select-Object -First 1).Trim()
    if ($branch -ne $WorkBranch) { throw "Project is on '$branch', expected '$WorkBranch'." }
    $dirty = @((Invoke-Git -Repo $ProjectPath -Arguments @('status','--porcelain')).Output)
    if ($dirty.Count -gt 0) { throw 'Project working tree is not clean.' }
    Invoke-Git -Repo $ProjectPath -Arguments @('fetch','origin',$WorkBranch) | Out-Null
    $local = Get-ProjectHead
    $remote = ((Invoke-Git -Repo $ProjectPath -Arguments @('rev-parse',"origin/$WorkBranch")).Output | Select-Object -First 1).Trim()
    if ($local -ne $remote) { throw "Local HEAD $local does not equal origin/$WorkBranch $remote. Bridge will not reset it automatically." }
    if ($Task.PSObject.Properties.Name -contains 'expected_sha' -and $Task.expected_sha) {
        if ($local -ne [string]$Task.expected_sha) { throw "Expected SHA $($Task.expected_sha), found $local." }
    }
    return $local
}

function Get-CodexPath {
    if ($script:CodexPath) { return $script:CodexPath }
    $command = Get-Command codex -ErrorAction Stop
    $script:CodexPath = $command.Source
    return $script:CodexPath
}

function Invoke-CodexRun {
    param(
        [Parameter(Mandatory)][string]$Prompt,
        [Parameter(Mandatory)][ValidateSet('read','work','release')][string]$Mode,
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [Parameter(Mandatory)][string]$RunDirectory,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][int]$MaxMinutes,
        [bool]$Network = $false
    )
    New-Item -ItemType Directory -Force -Path $RunDirectory | Out-Null
    $lastPath = Join-Path $RunDirectory "$Name.last.md"
    $stdoutPath = Join-Path $RunDirectory "$Name.stdout.jsonl"
    $stderrPath = Join-Path $RunDirectory "$Name.stderr.log"
    $args = [System.Collections.Generic.List[string]]::new()
    $args.Add('exec')
    if ($Mode -eq 'read') {
        $args.Add('--sandbox'); $args.Add('read-only')
    } else {
        $args.Add('--approve-for-me')
        if ($Network) { $args.Add('-c'); $args.Add('sandbox_workspace_write.network_access=true') }
    }
    $args.Add('--json')
    $args.Add('--output-last-message'); $args.Add($lastPath)
    $args.Add('-C'); $args.Add($WorkingDirectory)
    $args.Add('-')

    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = Get-CodexPath
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    foreach ($arg in $args) { [void]$psi.ArgumentList.Add($arg) }

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $psi
    if (-not $process.Start()) { throw "Could not start Codex for $Name." }
    $process.StandardInput.Write($Prompt)
    $process.StandardInput.Close()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $started = [datetime]::UtcNow
    $timedOut = $false
    while (-not $process.WaitForExit(30000)) {
        Publish-Heartbeat -Status 'running' -Reason "Codex phase $Name is active."
        if (([datetime]::UtcNow - $started).TotalMinutes -ge $MaxMinutes) {
            $timedOut = $true
            & taskkill.exe /PID $process.Id /T /F *> $null
            break
        }
    }
    if ($timedOut) { $process.WaitForExit() }
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    Set-Content -LiteralPath $stdoutPath -Value (Protect-Text $stdout) -Encoding utf8
    Set-Content -LiteralPath $stderrPath -Value (Protect-Text $stderr) -Encoding utf8
    if ($timedOut) { throw "Codex phase '$Name' exceeded $MaxMinutes minutes and was terminated." }
    $exitCode = $process.ExitCode
    if (-not (Test-Path $lastPath)) {
        throw "Codex phase '$Name' did not create its final-message file. Exit code: $exitCode."
    }
    $final = Get-Content -LiteralPath $lastPath -Raw
    $safeFinal = Protect-Text $final
    Set-Content -LiteralPath $lastPath -Value $safeFinal -Encoding utf8
    if ($exitCode -ne 0) {
        $safeErr = Protect-Text $stderr
        if ($safeErr.Length -gt 2500) { $safeErr = $safeErr.Substring($safeErr.Length - 2500) }
        throw "Codex phase '$Name' failed with exit code $exitCode. $safeErr"
    }
    return [pscustomobject]@{
        ExitCode = $exitCode
        FinalMessage = $safeFinal
        StdoutPath = $stdoutPath
        StderrPath = $stderrPath
        LastMessagePath = $lastPath
    }
}

function Get-SpecialistRoster {
    $path = Join-Path $ControlPath '.agent-bridge\runtime\specialists.json'
    if (-not (Test-Path $path)) { throw 'specialists.json is missing from the control clone.' }
    return (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json)
}

function Get-FallbackSpecialists {
    param([string]$Instruction)
    $text = $Instruction.ToLowerInvariant()
    $selected = [System.Collections.Generic.List[string]]::new()
    $selected.Add('product_strategy')
    if ($text -match 'tax|efile|e-file|irs|return|filing|signature') { $selected.Add('tax_compliance') }
    if ($text -match 'security|auth|tenant|secret|oauth|portal|production|deploy|migration') { $selected.Add('security_privacy') }
    if ($text -match 'visual|design|dashboard|color|chart|polish|ui|first-launch') { $selected.Add('visual_design'); $selected.Add('ux_accessibility') }
    if ($text -match 'ai|agent|worker|autonom|classif|extract|draft') { $selected.Add('ai_automation') }
    if ($text -match 'gmail|calendar|microsoft|excel|quickbooks|wave|connector|integration|webhook') { $selected.Add('integrations_data') }
    if ($text -match 'windows|tauri|desktop|installer|package') { $selected.Add('desktop_windows') }
    if ($text -match 'audio|camera|image|receipt|multimedia|scan|capture') { $selected.Add('audio_multimedia') }
    return @($selected | Select-Object -Unique | Select-Object -First 6)
}

function Select-Specialists {
    param($Task, [string]$RunDirectory)
    $roster = Get-SpecialistRoster
    $names = @($roster.PSObject.Properties.Name)
    $rosterSummary = ($names | ForEach-Object { "- $_" }) -join "`n"
    $prompt = @"
You are the chief-of-staff agent for a production tax-software build. Select the specialist agents that should advise the lead builder before it executes the task. Choose 2 to 6 names from the roster. Use specialists only when their expertise can materially improve correctness or product quality. The lead builder remains responsible for implementation.

Roster:
$rosterSummary

Task:
$($Task.instruction)

Return ONLY valid JSON in exactly this shape:
{"specialists":["name1","name2"]}
"@
    try {
        $result = Invoke-CodexRun -Prompt $prompt -Mode 'read' -WorkingDirectory $ProjectPath -RunDirectory $RunDirectory -Name 'coordinator' -MaxMinutes 8 -Network $false
        $raw = $result.FinalMessage.Trim()
        if ($raw.StartsWith('```')) { $raw = $raw -replace '^```(?:json)?\s*','' -replace '\s*```$','' }
        $parsed = $raw | ConvertFrom-Json
        $chosen = @($parsed.specialists | Where-Object { $names -contains [string]$_ } | Select-Object -Unique | Select-Object -First 6)
        if ($chosen.Count -ge 1) { return $chosen }
    } catch {
        $safe = Protect-Text $_.Exception.Message
        Set-Content -LiteralPath (Join-Path $RunDirectory 'coordinator-fallback.log') -Value $safe -Encoding utf8
    }
    return Get-FallbackSpecialists -Instruction ([string]$Task.instruction)
}

function Invoke-SpecialistConsultations {
    param($Task, [string[]]$Specialists, [string]$RunDirectory)
    $roster = Get-SpecialistRoster
    $reports = [System.Collections.Generic.List[string]]::new()
    foreach ($name in $Specialists) {
        $directive = [string]$roster.$name
        $prompt = @"
You are the $name specialist advising a lead autonomous builder. Work independently and read the current repository as needed, but DO NOT modify files, commit, deploy, migrate, or mutate production. Give concrete implementation guidance, risks, acceptance criteria, and any mistakes the lead should avoid. Be concise enough that another agent can act on it.

Specialist directive:
$directive

Task:
$($Task.instruction)
"@
        try {
            $result = Invoke-CodexRun -Prompt $prompt -Mode 'read' -WorkingDirectory $ProjectPath -RunDirectory $RunDirectory -Name "specialist-$name" -MaxMinutes 12 -Network $false
            $report = $result.FinalMessage
            if ($report.Length -gt 9000) { $report = $report.Substring(0,9000) }
            $reports.Add("### $name`n$report")
        } catch {
            $reports.Add("### $name`nSpecialist unavailable: $(Protect-Text $_.Exception.Message)")
        }
    }
    return @($reports)
}

function Invoke-QualityReview {
    param($Task, [string]$RunDirectory, [string]$Phase)
    $roster = Get-SpecialistRoster
    $directive = [string]$roster.qa_release
    $prompt = @"
You are the independent qa_release specialist reviewing the repository AFTER the lead builder attempted this task. Do not modify anything. Inspect the current repo and verify the task's actual acceptance criteria, tests, security boundaries, and product quality. If this was a release task, do not repeat production actions.

Directive:
$directive

Original task:
$($Task.instruction)

First line MUST be exactly PASS or NEEDS_FIX. After that, list only concrete evidence and actionable findings. Use the words BLOCKER or MATERIAL only for findings that genuinely deserve those severities.
"@
    return Invoke-CodexRun -Prompt $prompt -Mode 'read' -WorkingDirectory $ProjectPath -RunDirectory $RunDirectory -Name "qa-$Phase" -MaxMinutes 18 -Network $false
}

function Invoke-Task {
    param([Parameter(Mandatory)]$Task)
    Test-TaskObject -Task $Task | Out-Null
    $startSha = Assert-ProjectReady -Task $Task
    $startedAt = Get-UtcIso
    $taskDir = Join-Path $LogsRoot ([string]$Task.id)
    New-Item -ItemType Directory -Force -Path $taskDir | Out-Null
    $script:ActiveTaskId = [string]$Task.id
    Publish-Heartbeat -Status 'running' -Reason 'Task accepted and specialist coordination started.' -Force

    $specialists = Select-Specialists -Task $Task -RunDirectory $taskDir
    $consultations = Invoke-SpecialistConsultations -Task $Task -Specialists $specialists -RunDirectory $taskDir
    $consultText = ($consultations -join "`n`n")

    $leadPrompt = @"
You are the lead autonomous builder for Folio. Carry the task through to completion without asking the user to relay messages between agents. Specialist agents have already reviewed the task. Treat their reports as advisory, verify their claims against the repository and current sources, and make the final engineering decisions yourself.

If your Codex environment exposes collaboration/subagent tools, delegate parallelizable research, implementation, design, security, testing, or review work to them when that improves speed or quality. You remain accountable for integrating and verifying their work. Do not stop merely because a specialist suggested an idea. Build it or make a documented, evidence-based decision not to.

Never reveal credentials or secrets. Never use dangerously-bypass approvals. Respect every production, security, scope, commit, test, and fail-stop constraint in the task exactly.

TASK:
$($Task.instruction)

SPECIALIST CONSULTATIONS:
$consultText
"@

    $main = Invoke-CodexRun -Prompt $leadPrompt -Mode ([string]$Task.mode) -WorkingDirectory $ProjectPath -RunDirectory $taskDir -Name 'lead' -MaxMinutes ([int]$Task.max_minutes) -Network ([bool]$Task.network)

    $qa = Invoke-QualityReview -Task $Task -RunDirectory $taskDir -Phase 'initial'
    $needsFix = $qa.FinalMessage -match '(?im)^NEEDS_FIX\s*$|\bBLOCKER\b|\bMATERIAL\b'
    if ($needsFix) {
        if ($Task.mode -eq 'release') {
            throw "Post-release QA found an unresolved issue. Automatic production repair is intentionally disabled. Review: $($qa.FinalMessage)"
        }
        $repairPrompt = @"
You are the lead builder in a focused repair pass. The initial implementation completed, but independent QA found issues below. Fix every deterministic BLOCKER or MATERIAL defect and every concrete acceptance-criteria failure. Do not broaden scope. Add fail-before/pass-after regression proof where appropriate, rerun the task's required verification, commit/push if required, and finish with a concise verified report.

ORIGINAL TASK:
$($Task.instruction)

QA REVIEW:
$($qa.FinalMessage)
"@
        $repair = Invoke-CodexRun -Prompt $repairPrompt -Mode 'work' -WorkingDirectory $ProjectPath -RunDirectory $taskDir -Name 'repair' -MaxMinutes ([Math]::Min([int]$Task.max_minutes,240)) -Network ([bool]$Task.network)
        $qa = Invoke-QualityReview -Task $Task -RunDirectory $taskDir -Phase 'final'
        if ($qa.FinalMessage -match '(?im)^NEEDS_FIX\s*$|\bBLOCKER\b|\bMATERIAL\b') {
            throw "Final QA still reports unresolved findings: $($qa.FinalMessage)"
        }
        $main = $repair
    }

    Invoke-Git -Repo $ProjectPath -Arguments @('fetch','origin',$WorkBranch) | Out-Null
    $endSha = Get-ProjectHead
    $remote = ((Invoke-Git -Repo $ProjectPath -Arguments @('rev-parse',"origin/$WorkBranch")).Output | Select-Object -First 1).Trim()
    if ($Task.commit_push -and $endSha -ne $remote) { throw "Task required commit/push but local HEAD $endSha does not match origin/$WorkBranch $remote." }
    $dirty = @((Invoke-Git -Repo $ProjectPath -Arguments @('status','--porcelain')).Output)
    if ($dirty.Count -gt 0) { throw 'Task left the project working tree dirty.' }

    $summary = "Specialists consulted: $($specialists -join ', ').`n`n$($main.FinalMessage)`n`nQA:`n$($qa.FinalMessage)"
    $summary = Protect-Text $summary
    if ($summary.Length -gt 16000) { $summary = $summary.Substring(0,16000) }
    $productionMutation = $summary -match '(?i)production\s+(migration|deploy|data mutation)\s+performed\s*:\s*YES|production_mutation\s*[:=]\s*true'
    return [ordered]@{
        id = [string]$Task.id
        status = 'completed'
        started_at = $startedAt
        finished_at = Get-UtcIso
        project = $ProjectName
        start_sha = $startSha
        end_sha = $endSha
        exit_code = 0
        specialists = @($specialists)
        summary = $summary
        log_path = $taskDir
        production_mutation = [bool]$productionMutation
        bridge_version = $BridgeVersion
    }
}

function Get-QueueBlocker {
    $outbox = Join-Path $ControlPath '.agent-bridge\outbox'
    if (-not (Test-Path $outbox)) { return $null }
    foreach ($file in Get-ChildItem -LiteralPath $outbox -Filter '*.json' -File | Sort-Object Name) {
        try {
            $result = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
            if ($result.status -in @('failed','rejected')) { return $result }
        } catch { }
    }
    return $null
}

function Get-NextPendingTask {
    $inbox = Join-Path $ControlPath '.agent-bridge\inbox'
    $outbox = Join-Path $ControlPath '.agent-bridge\outbox'
    if (-not (Test-Path $inbox)) { return $null }
    foreach ($file in Get-ChildItem -LiteralPath $inbox -Filter '*.json' -File | Sort-Object Name) {
        $resultPath = Join-Path $outbox $file.Name
        if (-not (Test-Path $resultPath)) {
            return (Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json)
        }
    }
    return $null
}

function Publish-FailureResult {
    param($Task, [string]$Status, [string]$Message, [AllowNull()][string]$StartSha, [AllowNull()][string]$StartedAt)
    $endSha = $null
    try { $endSha = Get-ProjectHead } catch { }
    $result = [ordered]@{
        id = if ($Task -and $Task.id) { [string]$Task.id } else { 'unknown-task' }
        status = $Status
        started_at = if ($StartedAt) { $StartedAt } else { Get-UtcIso }
        finished_at = Get-UtcIso
        project = $ProjectName
        start_sha = $StartSha
        end_sha = $endSha
        exit_code = 1
        specialists = @()
        summary = Protect-Text $Message
        log_path = if ($Task -and $Task.id) { Join-Path $LogsRoot ([string]$Task.id) } else { $LogsRoot }
        production_mutation = $false
        bridge_version = $BridgeVersion
    }
    if ($Task -and $Task.id) {
        Publish-ControlJson -RelativePath ".agent-bridge/outbox/$($Task.id).json" -Object $result -CommitMessage "Agent bridge result: $($Task.id)"
    }
}

function Invoke-SelfTests {
    $sample = [pscustomobject]@{
        id='test-task'; project=$ProjectName; repo=$RepoFullName; instruction='Read only test'; mode='read'; network=$false; production_authorized=$false; commit_push=$false; max_minutes=5
    }
    if (-not (Test-TaskObject $sample)) { throw 'Valid task test failed.' }
    $badRelease = $sample.PSObject.Copy(); $badRelease.mode='release'
    $failed = $false
    try { Test-TaskObject $badRelease | Out-Null } catch { $failed = $true }
    if (-not $failed) { throw 'Release authorization self-test failed.' }
    $redacted = Protect-Text 'DATABASE_URL=postgresql://user:pass@example.invalid/db Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'
    if ($redacted -match 'user:pass|abcdefghijklmnopqrstuvwxyz') { throw 'Redaction self-test failed.' }
    $unknown = $sample.PSObject.Copy(); $unknown | Add-Member -NotePropertyName surprise -NotePropertyValue 1
    $failed = $false
    try { Test-TaskObject $unknown | Out-Null } catch { $failed = $true }
    if (-not $failed) { throw 'Unknown-field validation self-test failed.' }
    Write-Output 'BRIDGE_SELF_TEST_OK'
}

if ($SelfTest) {
    Invoke-SelfTests
    exit 0
}

New-Item -ItemType Directory -Force -Path $LogsRoot | Out-Null
Get-CodexPath | Out-Null
Publish-Heartbeat -Status 'starting' -Reason 'Bridge process started.' -Force

while ($true) {
    try {
        Sync-Control
        $blocker = Get-QueueBlocker
        if ($blocker) {
            $script:ActiveTaskId = $null
            Publish-Heartbeat -Status 'blocked' -Reason "Queue blocked by failed task $($blocker.id): $($blocker.summary)"
        } else {
            $task = Get-NextPendingTask
            if ($null -eq $task) {
                $script:ActiveTaskId = $null
                Publish-Heartbeat -Status 'idle' -Reason 'No pending tasks.'
            } else {
                $startedAt = Get-UtcIso
                $startSha = $null
                try {
                    Test-TaskObject -Task $task | Out-Null
                    $startSha = Assert-ProjectReady -Task $task
                    $result = Invoke-Task -Task $task
                    Publish-ControlJson -RelativePath ".agent-bridge/outbox/$($task.id).json" -Object $result -CommitMessage "Agent bridge result: $($task.id)"
                    $script:ActiveTaskId = $null
                    Publish-Heartbeat -Status 'idle' -Reason "Task $($task.id) completed." -Force
                } catch {
                    $message = Protect-Text $_.Exception.Message
                    $status = if ($message -match 'Unknown task|Wrong repo|Invalid mode|lacks production_authorized|Expected SHA|working tree|Unexpected project origin') { 'rejected' } else { 'failed' }
                    Publish-FailureResult -Task $task -Status $status -Message $message -StartSha $startSha -StartedAt $startedAt
                    $script:ActiveTaskId = $null
                    Publish-Heartbeat -Status 'blocked' -Reason "Task $($task.id) $status: $message" -Force
                }
            }
        }
    } catch {
        $script:ActiveTaskId = $null
        Publish-Heartbeat -Status 'error' -Reason (Protect-Text $_.Exception.Message) -Force
    }
    if ($Once) { break }
    Start-Sleep -Seconds 60
}
