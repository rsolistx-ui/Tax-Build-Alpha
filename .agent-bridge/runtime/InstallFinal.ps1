Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TaskName = 'OpenAI Agent Bridge'
$ProjectPath = 'C:\Tax Build Alpha'
$ControlBranch = 'agent-control'
$InstallRoot = if ($env:OPENAI_AGENT_BRIDGE_HOME) { $env:OPENAI_AGENT_BRIDGE_HOME } else { Join-Path $env:LOCALAPPDATA 'OpenAI-Agent-Bridge' }
$ControlPath = Join-Path $InstallRoot 'control'
$LogsRoot = Join-Path $InstallRoot 'logs'
$MachineName = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { 'windows-worker' }

function Require-Command {
    param([Parameter(Mandatory)][string]$Name)
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) { throw "Required command '$Name' is not available." }
    return $command
}

$git = Require-Command -Name 'git'
$pwsh = Require-Command -Name 'pwsh'
$codex = Require-Command -Name 'codex'

$codexHelp = (@(& $codex.Source exec --help 2>&1) -join "`n")
foreach ($requiredFlag in @('--approve-for-me','--sandbox','--json','--output-last-message')) {
    if ($codexHelp -notmatch [regex]::Escape($requiredFlag)) {
        throw "Installed Codex CLI does not expose required flag $requiredFlag. Update Codex before installing the bridge."
    }
}

if (-not (Test-Path (Join-Path $ProjectPath '.git'))) {
    throw "Folio working copy was not found at $ProjectPath."
}

$originOutput = @(& git -C $ProjectPath remote get-url origin 2>&1)
if ($LASTEXITCODE -ne 0) { throw 'Could not read the Folio origin remote.' }
$originUrl = ($originOutput | Select-Object -First 1).Trim()
if (($originUrl -replace '\\','/') -notmatch 'rsolistx-ui/Tax-Build-Alpha(?:\.git)?$') {
    throw 'The Folio working copy points at an unexpected Git remote.'
}

New-Item -ItemType Directory -Force -Path $InstallRoot,$LogsRoot | Out-Null

if (-not (Test-Path (Join-Path $ControlPath '.git'))) {
    if (Test-Path $ControlPath) { Remove-Item -LiteralPath $ControlPath -Recurse -Force }
    & git clone --branch $ControlBranch --single-branch $originUrl $ControlPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not clone the dedicated agent-control branch.' }
} else {
    & git -C $ControlPath fetch origin $ControlBranch | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not fetch agent-control.' }
    $controlCurrent = (@(& git -C $ControlPath branch --show-current) | Select-Object -First 1).Trim()
    if ($controlCurrent -ne $ControlBranch) { throw "Dedicated control clone is on '$controlCurrent'." }
    & git -C $ControlPath pull --rebase origin $ControlBranch | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not update agent-control.' }
}

$gitName = (@(& git -C $ProjectPath config user.name 2>$null) | Select-Object -First 1)
$gitEmail = (@(& git -C $ProjectPath config user.email 2>$null) | Select-Object -First 1)
if ([string]::IsNullOrWhiteSpace([string]$gitName)) { $gitName = 'OpenAI Agent Bridge' }
if ([string]::IsNullOrWhiteSpace([string]$gitEmail)) { $gitEmail = 'agent-bridge@localhost' }
& git -C $ControlPath config user.name ([string]$gitName)
& git -C $ControlPath config user.email ([string]$gitEmail)

$runtime = Join-Path $ControlPath '.agent-bridge\runtime'
foreach ($required in @('Bridge.ps1','PatchBridge.ps1','ManageSafe.ps1','specialists.json')) {
    if (-not (Test-Path (Join-Path $runtime $required))) { throw "Missing runtime file '$required'." }
}

$bridgePath = Join-Path $InstallRoot 'Bridge.ps1'
$patchPath = Join-Path $InstallRoot 'PatchBridge.ps1'
$managePath = Join-Path $InstallRoot 'Manage.ps1'
Copy-Item -LiteralPath (Join-Path $runtime 'Bridge.ps1') -Destination $bridgePath -Force
Copy-Item -LiteralPath (Join-Path $runtime 'PatchBridge.ps1') -Destination $patchPath -Force
Copy-Item -LiteralPath (Join-Path $runtime 'ManageSafe.ps1') -Destination $managePath -Force
Copy-Item -LiteralPath (Join-Path $runtime 'specialists.json') -Destination (Join-Path $InstallRoot 'specialists.json') -Force

$patchOutput = @(& $pwsh.Source -NoProfile -ExecutionPolicy Bypass -File $patchPath -Path $bridgePath 2>&1)
if ($LASTEXITCODE -ne 0 -or ($patchOutput -join "`n") -notmatch 'BRIDGE_PATCH_OK') {
    throw "Bridge patch failed: $($patchOutput -join ' ')"
}

$selfTest = @(& $pwsh.Source -NoProfile -ExecutionPolicy Bypass -File $bridgePath -SelfTest 2>&1)
if ($LASTEXITCODE -ne 0 -or ($selfTest -join "`n") -notmatch 'BRIDGE_SELF_TEST_OK') {
    throw "Bridge self-tests failed: $($selfTest -join ' ')"
}

$smokeDir = Join-Path $InstallRoot 'smoke'
New-Item -ItemType Directory -Force -Path $smokeDir | Out-Null
$smokeLast = Join-Path $smokeDir 'codex.last.txt'
Remove-Item -LiteralPath $smokeLast -Force -ErrorAction SilentlyContinue

$psi = [Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $codex.Source
$psi.WorkingDirectory = $ProjectPath
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
foreach ($argument in @('exec','-c','features.multi_agent=true','--sandbox','read-only','--output-last-message',$smokeLast,'-C',$ProjectPath,'-')) {
    [void]$psi.ArgumentList.Add($argument)
}
$process = [Diagnostics.Process]::new()
$process.StartInfo = $psi
if (-not $process.Start()) { throw 'Could not start the Codex smoke test.' }
$process.StandardInput.Write('Do not run commands or modify files. Reply with exactly BRIDGE_SMOKE_OK.')
$process.StandardInput.Close()
$stdoutTask = $process.StandardOutput.ReadToEndAsync()
$stderrTask = $process.StandardError.ReadToEndAsync()
if (-not $process.WaitForExit(180000)) {
    & taskkill.exe /PID $process.Id /T /F *> $null
    throw 'Codex smoke test timed out.'
}
$null = $stdoutTask.GetAwaiter().GetResult()
$null = $stderrTask.GetAwaiter().GetResult()
if ($process.ExitCode -ne 0 -or -not (Test-Path $smokeLast)) {
    throw 'Codex multi-agent smoke test failed. Local Codex authentication or version may require attention.'
}
if ((Get-Content -LiteralPath $smokeLast -Raw).Trim() -ne 'BRIDGE_SMOKE_OK') {
    throw 'Codex smoke test returned an unexpected response.'
}

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $pwsh.Source -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$bridgePath`"" -WorkingDirectory $InstallRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Autonomous Git/Codex multi-agent bridge for Folio.' | Out-Null
Start-ScheduledTask -TaskName $TaskName

$heartbeatSeen = $false
$heartbeatStatus = $null
$activeTask = $null
for ($attempt = 0; $attempt -lt 12; $attempt++) {
    Start-Sleep -Seconds 10
    & git -C $ControlPath fetch origin $ControlBranch 2>$null | Out-Null
    $heartbeatPath = ".agent-bridge/heartbeat/$MachineName.json"
    $raw = @(& git -C $ControlPath show "origin/$ControlBranch`:$heartbeatPath" 2>$null)
    if ($LASTEXITCODE -eq 0 -and $raw.Count -gt 0) {
        try {
            $heartbeat = ($raw -join "`n") | ConvertFrom-Json
            $heartbeatSeen = $true
            $heartbeatStatus = [string]$heartbeat.status
            $activeTask = $heartbeat.active_task_id
            if ($heartbeatStatus -in @('starting','idle','running','blocked','error')) { break }
        } catch { }
    }
}

$scheduledTask = Get-ScheduledTask -TaskName $TaskName
Write-Output 'Bridge install: COMPLETE'
Write-Output "Scheduled Task: $($scheduledTask.State)"
Write-Output 'Runtime patch: PASS'
Write-Output 'Self-tests: PASS'
Write-Output 'Codex multi-agent smoke: PASS'
Write-Output 'Specialist-agent roster: ENABLED'
if ($heartbeatSeen) {
    Write-Output "Heartbeat: $heartbeatStatus"
    if ($activeTask) { Write-Output "Active Task: $activeTask" }
    Write-Output 'Queued Folio work: ACTIVE'
} else {
    Write-Output 'Heartbeat: NOT VISIBLE'
    Write-Output "Status command: pwsh -NoProfile -File `"$managePath`" status"
    exit 2
}
