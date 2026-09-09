param(
    [Parameter(Mandatory,Position=0)]
    [ValidateSet('start','stop','status','uninstall','run-foreground','update')]
    [string]$Action
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TaskName = 'OpenAI Agent Bridge'
$InstallRoot = if ($env:OPENAI_AGENT_BRIDGE_HOME) { $env:OPENAI_AGENT_BRIDGE_HOME } else { Join-Path $env:LOCALAPPDATA 'OpenAI-Agent-Bridge' }
$ControlPath = Join-Path $InstallRoot 'control'
$BridgePath = Join-Path $InstallRoot 'Bridge.ps1'
$PatchPath = Join-Path $InstallRoot 'PatchBridge.ps1'
$MachineName = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { 'windows-worker' }

function Update-Runtime {
    if (-not (Test-Path (Join-Path $ControlPath '.git'))) { throw 'Control clone is missing.' }
    & git -C $ControlPath fetch origin agent-control | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Control fetch failed.' }
    & git -C $ControlPath pull --rebase origin agent-control | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Control update failed.' }
    $runtime = Join-Path $ControlPath '.agent-bridge\runtime'
    Copy-Item -LiteralPath (Join-Path $runtime 'Bridge.ps1') -Destination $BridgePath -Force
    Copy-Item -LiteralPath (Join-Path $runtime 'PatchBridge.ps1') -Destination $PatchPath -Force
    Copy-Item -LiteralPath (Join-Path $runtime 'specialists.json') -Destination (Join-Path $InstallRoot 'specialists.json') -Force
    Copy-Item -LiteralPath (Join-Path $runtime 'ManageSafe.ps1') -Destination (Join-Path $InstallRoot 'Manage.ps1') -Force
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $PatchPath -Path $BridgePath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Bridge patch failed during update.' }
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $BridgePath -SelfTest | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Bridge self-test failed during update.' }
}

switch ($Action) {
    'start' {
        Start-ScheduledTask -TaskName $TaskName
        Write-Output 'OpenAI Agent Bridge start requested.'
    }
    'stop' {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Write-Output 'OpenAI Agent Bridge stopped.'
    }
    'status' {
        $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if (-not $task) { Write-Output 'Scheduled Task: NOT INSTALLED'; exit 1 }
        $info = Get-ScheduledTaskInfo -TaskName $TaskName
        Write-Output "Scheduled Task: $($task.State)"
        Write-Output "Last Run: $($info.LastRunTime)"
        Write-Output "Last Result: $($info.LastTaskResult)"
        if (Test-Path (Join-Path $ControlPath '.git')) {
            & git -C $ControlPath fetch origin agent-control 2>$null | Out-Null
            $path = ".agent-bridge/heartbeat/$MachineName.json"
            $raw = @(& git -C $ControlPath show "origin/agent-control`:$path" 2>$null)
            if ($LASTEXITCODE -eq 0 -and $raw.Count -gt 0) {
                try {
                    $heartbeat = ($raw -join "`n") | ConvertFrom-Json
                    Write-Output "Heartbeat: $($heartbeat.status) at $($heartbeat.last_poll_time)"
                    if ($heartbeat.active_task_id) { Write-Output "Active Task: $($heartbeat.active_task_id)" }
                    if ($heartbeat.reason) { Write-Output "Reason: $($heartbeat.reason)" }
                } catch { Write-Output 'Heartbeat: PRESENT BUT UNREADABLE' }
            } else { Write-Output 'Heartbeat: NOT FOUND' }
        }
    }
    'update' {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Update-Runtime
        Start-ScheduledTask -TaskName $TaskName
        Write-Output 'OpenAI Agent Bridge updated and restarted.'
    }
    'run-foreground' {
        & pwsh -NoProfile -ExecutionPolicy Bypass -File $BridgePath
    }
    'uninstall' {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
        Write-Output "Scheduled Task removed. Logs remain at $InstallRoot."
    }
}
