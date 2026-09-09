param([Parameter(Mandatory,Position=0)][ValidateSet('start','stop','status','uninstall','run-foreground','update')][string]$Action)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$TaskName='OpenAI Agent Bridge'
$InstallRoot=if($env:OPENAI_AGENT_BRIDGE_HOME){$env:OPENAI_AGENT_BRIDGE_HOME}else{Join-Path $env:LOCALAPPDATA 'OpenAI-Agent-Bridge'}
$ControlPath=Join-Path $InstallRoot 'control'
$BridgePath=Join-Path $InstallRoot 'Bridge.ps1'
$MachineName=if($env:COMPUTERNAME){$env:COMPUTERNAME}else{'windows-worker'}
function UpdateRuntime {
    if(-not(Test-Path(Join-Path $ControlPath '.git'))){throw 'Control clone missing.'}
    & git -C $ControlPath fetch origin agent-control|Out-Null;if($LASTEXITCODE-ne0){throw 'Control fetch failed.'}
    & git -C $ControlPath pull --rebase origin agent-control|Out-Null;if($LASTEXITCODE-ne0){throw 'Control update failed.'}
    $r=Join-Path $ControlPath '.agent-bridge\runtime'
    Copy-Item (Join-Path $r 'Bridge2.ps1') $BridgePath -Force
    Copy-Item (Join-Path $r 'Manage2.ps1') (Join-Path $InstallRoot 'Manage.ps1') -Force
    Copy-Item (Join-Path $r 'specialists.json') (Join-Path $InstallRoot 'specialists.json') -Force
}
switch($Action){
'start'{Start-ScheduledTask -TaskName $TaskName; 'OpenAI Agent Bridge start requested.'}
'stop'{Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue; 'OpenAI Agent Bridge stopped.'}
'status'{
    $task=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue;if(-not$task){'Scheduled Task: NOT INSTALLED';exit 1}
    $info=Get-ScheduledTaskInfo -TaskName $TaskName;'Scheduled Task: '+$task.State;'Last Run: '+$info.LastRunTime;'Last Result: '+$info.LastTaskResult
    if(Test-Path(Join-Path $ControlPath '.git')){& git -C $ControlPath fetch origin agent-control 2>$null|Out-Null;$path=".agent-bridge/heartbeat/$MachineName.json";$raw=@(& git -C $ControlPath show "origin/agent-control`:$path" 2>$null);if($LASTEXITCODE-eq0-and$raw.Count-gt0){try{$h=($raw-join"`n")|ConvertFrom-Json;'Heartbeat: '+$h.status+' at '+$h.last_poll_time;if($h.active_task_id){'Active Task: '+$h.active_task_id};if($h.reason){'Reason: '+$h.reason}}catch{'Heartbeat: PRESENT BUT UNREADABLE'}}else{'Heartbeat: NOT FOUND'}}
}
'update'{Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue;UpdateRuntime;& pwsh -NoProfile -File $BridgePath -SelfTest;if($LASTEXITCODE-ne0){throw 'Bridge self-test failed.'};Start-ScheduledTask -TaskName $TaskName;'OpenAI Agent Bridge updated and restarted.'}
'run-foreground'{& pwsh -NoProfile -ExecutionPolicy Bypass -File $BridgePath}
'uninstall'{Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue;Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue;"Scheduled Task removed. Logs retained at $InstallRoot."}
}
