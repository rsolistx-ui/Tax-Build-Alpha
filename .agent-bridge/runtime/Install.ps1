Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TaskName = 'OpenAI Agent Bridge'
$RepoFullName = 'rsolistx-ui/Tax-Build-Alpha'
$ProjectPath = 'C:\Tax Build Alpha'
$ControlBranch = 'agent-control'
$InstallRoot = if ($env:OPENAI_AGENT_BRIDGE_HOME) { $env:OPENAI_AGENT_BRIDGE_HOME } else { Join-Path $env:LOCALAPPDATA 'OpenAI-Agent-Bridge' }
$ControlPath = Join-Path $InstallRoot 'control'
$LogsRoot = Join-Path $InstallRoot 'logs'
$MachineName = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { 'windows-worker' }

function Require-Command {
    param([string]$Name)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) { throw "Required command '$Name' is not installed or not on PATH." }
    return $cmd
}

$git = Require-Command 'git'
$pwsh = Require-Command 'pwsh'
$codex = Require-Command 'codex'

if (-not (Test-Path (Join-Path $ProjectPath '.git'))) { throw "Expected Folio working copy not found at $ProjectPath." }
$origin = @(& git -C $ProjectPath remote get-url origin 2>&1)
if ($LASTEXITCODE -ne 0) { throw 'Could not read the Folio origin remote.' }
$originUrl = ($origin | Select-Object -First 1).Trim()
if (($originUrl -replace '\\','/') -notmatch 'rsolistx-ui/Tax-Build-Alpha(?:\.git)?$') { throw "Unexpected Folio origin. Expected $RepoFullName." }

New-Item -ItemType Directory -Force -Path $InstallRoot,$LogsRoot | Out-Null

if (-not (Test-Path (Join-Path $ControlPath '.git'))) {
    if (Test-Path $ControlPath) { Remove-Item -LiteralPath $ControlPath -Recurse -Force }
    & git clone --branch $ControlBranch --single-branch $originUrl $ControlPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the dedicated agent-control clone.' }
} else {
    & git -C $ControlPath fetch origin $ControlBranch | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not fetch agent-control.' }
    $branch = @(& git -C $ControlPath branch --show-current)
    if (($branch | Select-Object -First 1).Trim() -ne $ControlBranch) { throw 'Dedicated control clone is on the wrong branch.' }
    & git -C $ControlPath pull --rebase origin $ControlBranch | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not update the dedicated control clone.' }
}

$runtime = Join-Path $ControlPath '.agent-bridge\runtime'
foreach ($file in @('Bridge.ps1','Manage.ps1','specialists.json')) {
    $source = Join-Path $runtime $file
    if (-not (Test-Path $source)) { throw "Bridge runtime file missing: $file" }
    Copy-Item -LiteralPath $source -Destination (Join-Path $InstallRoot $file) -Force
}

$bridgePath = Join-Path $InstallRoot 'Bridge.ps1'
$managePath = Join-Path $InstallRoot 'Manage.ps1'

$selfTest = @(& $pwsh.Source -NoProfile -ExecutionPolicy Bypass -File $bridgePath -SelfTest 2>&1)
if ($LASTEXITCODE -ne 0 -or ($selfTest -join "`n") -notmatch 'BRIDGE_SELF_TEST_OK') { throw 'Bridge self-tests failed.' }

$smokeDir = Join-Path $InstallRoot 'smoke'
New-Item -ItemType Directory -Force -Path $smokeDir | Out-Null
$smokeLast = Join-Path $smokeDir 'codex.last.txt'
$smokeStdout = Join-Path $smokeDir 'codex.stdout.txt'
$smokeStderr = Join-Path $smokeDir 'codex.stderr.txt'
Remove-Item $smokeLast,$smokeStdout,$smokeStderr -Force -ErrorAction SilentlyContinue
$smokePrompt = 'This is a harmless bridge installation smoke test. Do not modify any file and do not run commands. Reply with exactly BRIDGE_SMOKE_OK.'
$psi = [Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $codex.Source
$psi.WorkingDirectory = $ProjectPath
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
foreach ($arg in @('exec','--sandbox','read-only','--output-last-message',$smokeLast,'-C',$ProjectPath,'-')) { [void]$psi.ArgumentList.Add($arg) }
$p = [Diagnostics.Process]::new(); $p.StartInfo = $psi
if (-not $p.Start()) { throw 'Could not start Codex smoke test.' }
$p.StandardInput.Write($smokePrompt); $p.StandardInput.Close()
$outTask = $p.StandardOutput.ReadToEndAsync(); $errTask = $p.StandardError.ReadToEndAsync()
if (-not $p.WaitForExit(180000)) { & taskkill.exe /PID $p.Id /T /F *> $null; throw 'Codex smoke test timed out.' }
$smokeOut = $outTask.GetAwaiter().GetResult(); $smokeErr = $errTask.GetAwaiter().GetResult()
Set-Content -LiteralPath $smokeStdout -Value '[smoke output intentionally suppressed]' -Encoding utf8
Set-Content -LiteralPath $smokeStderr -Value '[smoke diagnostics intentionally suppressed]' -Encoding utf8
if ($p.ExitCode -ne 0 -or -not (Test-Path $smokeLast)) { throw 'Codex smoke test failed. Check Codex authentication locally.' }
$smokeResult = (Get-Content -LiteralPath $smokeLast -Raw).Trim()
Set-Content -LiteralPath $smokeLast -Value $smokeResult -Encoding utf8
if ($smokeResult -ne 'BRIDGE_SMOKE_OK') { throw 'Codex smoke test returned an unexpected response.' }

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$actionArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$bridgePath`""
$action = New-ScheduledTaskAction -Execute $pwsh.Source -Argument $actionArgs -WorkingDirectory $InstallRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Autonomous Git bridge between ChatGPT control tasks and local OpenAI Codex.' | Out-Null
Start-ScheduledTask -TaskName $TaskName

$heartbeatSeen = $false
$heartbeatStatus = $null
for ($i = 0; $i -lt 12; $i++) {
    Start-Sleep -Seconds 10
    & git -C $ControlPath fetch origin $ControlBranch 2>$null | Out-Null
    $heartbeatPath = ".agent-bridge/heartbeat/$MachineName.json"
    $hbRaw = @(& git -C $ControlPath show "origin/$ControlBranch`:$heartbeatPath" 2>$null)
    if ($LASTEXITCODE -eq 0 -and $hbRaw.Count -gt 0) {
        try {
            $hb = ($hbRaw -join "`n") | ConvertFrom-Json
            $heartbeatSeen = $true
            $heartbeatStatus = [string]$hb.status
            if ($heartbeatStatus -in @('starting','idle','running','blocked','error')) { break }
        } catch { }
    }
}

$scheduled = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Output "Bridge install: COMPLETE"
Write-Output "Scheduled Task: $($scheduled.State)"
Write-Output "Codex smoke: PASS"
Write-Output "Self-tests: PASS"
if ($heartbeatSeen) {
    Write-Output "Heartbeat: $heartbeatStatus"
} else {
    Write-Output 'Heartbeat: NOT YET VISIBLE'
    Write-Output "Run: pwsh -NoProfile -File `"$managePath`" status"
    exit 2
}
Write-Output 'Queued Folio tasks will now be processed serially without chat-to-terminal relaying.'
