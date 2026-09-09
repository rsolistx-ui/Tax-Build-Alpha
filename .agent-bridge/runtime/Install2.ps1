Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$TaskName='OpenAI Agent Bridge'
$ProjectPath='C:\Tax Build Alpha'
$ControlBranch='agent-control'
$InstallRoot=if($env:OPENAI_AGENT_BRIDGE_HOME){$env:OPENAI_AGENT_BRIDGE_HOME}else{Join-Path $env:LOCALAPPDATA 'OpenAI-Agent-Bridge'}
$ControlPath=Join-Path $InstallRoot 'control'
$MachineName=if($env:COMPUTERNAME){$env:COMPUTERNAME}else{'windows-worker'}
function Need([string]$n){$c=Get-Command $n -ErrorAction SilentlyContinue;if(-not$c){throw "Required command '$n' is missing."};$c}
$git=Need git;$pwsh=Need pwsh;$codex=Need codex
if(-not(Test-Path(Join-Path $ProjectPath '.git'))){throw "Folio repo missing at $ProjectPath."}
$origin=(@(& git -C $ProjectPath remote get-url origin 2>&1)|Select-Object -First 1).Trim();if($LASTEXITCODE-ne0-or(($origin-replace'\\','/')-notmatch'rsolistx-ui/Tax-Build-Alpha(?:\.git)?$')){throw 'Unexpected Folio origin.'}
New-Item -ItemType Directory -Force -Path $InstallRoot,(Join-Path $InstallRoot 'logs')|Out-Null
if(-not(Test-Path(Join-Path $ControlPath '.git'))){if(Test-Path $ControlPath){Remove-Item $ControlPath -Recurse -Force};& git clone --branch $ControlBranch --single-branch $origin $ControlPath|Out-Null;if($LASTEXITCODE-ne0){throw 'Control clone failed.'}}
else{& git -C $ControlPath fetch origin $ControlBranch|Out-Null;if($LASTEXITCODE-ne0){throw 'Control fetch failed.'};& git -C $ControlPath pull --rebase origin $ControlBranch|Out-Null;if($LASTEXITCODE-ne0){throw 'Control update failed.'}}
$r=Join-Path $ControlPath '.agent-bridge\runtime'
foreach($f in @('Bridge2.ps1','Manage2.ps1','specialists.json')){if(-not(Test-Path(Join-Path $r $f))){throw "Missing runtime file $f."}}
Copy-Item (Join-Path $r 'Bridge2.ps1') (Join-Path $InstallRoot 'Bridge.ps1') -Force
Copy-Item (Join-Path $r 'Manage2.ps1') (Join-Path $InstallRoot 'Manage.ps1') -Force
Copy-Item (Join-Path $r 'specialists.json') (Join-Path $InstallRoot 'specialists.json') -Force
$bridge=Join-Path $InstallRoot 'Bridge.ps1';$manage=Join-Path $InstallRoot 'Manage.ps1'
$self=@(& $pwsh.Source -NoProfile -ExecutionPolicy Bypass -File $bridge -SelfTest 2>&1);if($LASTEXITCODE-ne0-or($self-join"`n")-notmatch'BRIDGE_SELF_TEST_OK'){throw "Bridge v2 self-test failed: $($self-join' ')"}
$smokeDir=Join-Path $InstallRoot 'smoke';New-Item -ItemType Directory -Force -Path $smokeDir|Out-Null;$last=Join-Path $smokeDir 'last.txt';Remove-Item $last -Force -ErrorAction SilentlyContinue
$psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=$codex.Source;$psi.WorkingDirectory=$ProjectPath;$psi.UseShellExecute=$false;$psi.RedirectStandardInput=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.CreateNoWindow=$true
foreach($a in @('exec','--sandbox','read-only','--output-last-message',$last,'-C',$ProjectPath,'-')){[void]$psi.ArgumentList.Add($a)}
$p=[Diagnostics.Process]::new();$p.StartInfo=$psi;if(-not$p.Start()){throw 'Could not start Codex smoke.'};$p.StandardInput.Write('Do not run commands or modify files. Reply with exactly BRIDGE_SMOKE_OK.');$p.StandardInput.Close();$ot=$p.StandardOutput.ReadToEndAsync();$et=$p.StandardError.ReadToEndAsync();if(-not$p.WaitForExit(180000)){& taskkill.exe /PID $p.Id /T /F *> $null;throw 'Codex smoke timed out.'};$null=$ot.GetAwaiter().GetResult();$null=$et.GetAwaiter().GetResult();if($p.ExitCode-ne0-or-not(Test-Path $last)-or(Get-Content $last -Raw).Trim()-ne'BRIDGE_SMOKE_OK'){throw 'Codex smoke failed. Codex may need local authentication.'}
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue;Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
$user=[Security.Principal.WindowsIdentity]::GetCurrent().Name;$act=New-ScheduledTaskAction -Execute $pwsh.Source -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$bridge`"" -WorkingDirectory $InstallRoot;$trg=New-ScheduledTaskTrigger -AtLogOn -User $user;$pri=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited;$set=New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval(New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $act -Trigger $trg -Principal $pri -Settings $set -Description 'Autonomous Git/Codex multi-agent bridge for Folio.'|Out-Null;Start-ScheduledTask -TaskName $TaskName
$seen=$false;$status='';for($i=0;$i-lt12;$i++){Start-Sleep 10;& git -C $ControlPath fetch origin $ControlBranch 2>$null|Out-Null;$path=".agent-bridge/heartbeat/$MachineName.json";$raw=@(& git -C $ControlPath show "origin/$ControlBranch`:$path" 2>$null);if($LASTEXITCODE-eq0-and$raw.Count-gt0){try{$h=($raw-join"`n")|ConvertFrom-Json;$seen=$true;$status=[string]$h.status;if($status-in@('starting','idle','running','blocked','error')){break}}catch{}}}
$task=Get-ScheduledTask -TaskName $TaskName
'Bridge v2 install: COMPLETE';'Scheduled Task: '+$task.State;'Self-tests: PASS';'Codex smoke: PASS';if($seen){'Heartbeat: '+$status;'Autonomous specialist-agent coordination: ENABLED';'Queued Folio tasks: ACTIVE'}else{'Heartbeat: NOT VISIBLE';"Run: pwsh -NoProfile -File `"$manage`" status";exit 2}
