param(
    [Parameter(Mandatory, Position=0)]
    [ValidateSet('start','stop','status','uninstall','run-foreground','update')]
    [string]$Action
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$TaskName = 'OpenAI Agent Bridge'
$InstallRoot = if ($env:OPENAI_AGENT_BRIDGE_HOME) { $env:OPENAI_AGENT_BRIDGE_HOME } else { Join-Path $env:LOCALAPPDATA 'OpenAI-Agent-Bridge' }
$ControlPath = Join-Path $InstallRoot 'control'
$BridgePath = Join-Path $InstallRoot 'Bridge.ps1'
$MachineName = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { 'windows-worker' }

function Sync-Runtime {
    if (-not (Test-Path (Join-Path $ControlPath '.git'))) { throw "Control clone missing at $ControlPath." }
    & git -C $ControlPath fetch origin agent-control | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not fetch agent-control.' }
    & git -C $ControlPath pull --rebase origin agent-control | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not update agent-control.' }
    $runtime = Join-Path $ControlPath '.agent-bridge\runtime'
    Copy-Item (Join-Path $runtime 'Bridge.ps1') $BridgePath -Force
    Copy-Item (Join-Path $runtime 'Manage.ps1') (Join-Path $InstallRoot 'Manage.ps1') -Force
    Copy-Item (Join-Path $runtime 'specialists.json') (Join-Path $InstallRoot 'specialists.json') -Force
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
            $heartbeatPath = ".agent-bridge/heartbeat/$MachineName.json"
            $heartbeat = @(& git -C $ControlPath show "origin/agent-control:$heartbeatPath" 2>$null)
            if ($LASTEXITCODE -eq 0 -and $heartbeat.Count -gt 0) {
                try {
                    $hb = ($heartbeat -join "`n") | ConvertFrom-Json
                    Write-Output "Heartbeat: $($hb.status) at $($hb.last_poll_time)"
                    if ($hb.active_task_id) { Write-Output "Active Task: $($hb.active_task_id)" }
                    if ($hb.reason) { Write-Output "Reason: $($hb.reason)" }
                } catch { Write-Output 'Heartbeat: PRESENT BUT UNREADABLE' }
            } else { Write-Output 'Heartbeat: NOT FOUND' }
        }
    }
    'update' {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Sync-Runtime
        & pwsh -NoProfile -File $BridgePath -SelfTest
        if ($LASTEXITCODE -ne 0) { throw 'Bridge self-test failed after update.' }
        Start-ScheduledTask -TaskName $TaskName
        Write-Output 'OpenAI Agent Bridge updated and restarted.'
    }
    'run-foreground' {
        & pwsh -NoProfile -ExecutionPolicy Bypass -File $BridgePath
    }
    'uninstall' {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
        Write-Output "Scheduled Task removed. Local bridge files remain at $InstallRoot so logs are not destroyed automatically."
    }
}
