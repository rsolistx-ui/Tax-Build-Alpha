param([switch]$SelfTest,[switch]$Once)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$BridgeVersion = '2.0.0'
$RepoFullName = 'rsolistx-ui/Tax-Build-Alpha'
$ControlBranch = 'agent-control'
$ProjectName = 'Tax-Build-Alpha'
$ProjectPath = 'C:\Tax Build Alpha'
$WorkBranch = 'main'
$InstallRoot = if ($env:OPENAI_AGENT_BRIDGE_HOME) { $env:OPENAI_AGENT_BRIDGE_HOME } else { Join-Path $env:LOCALAPPDATA 'OpenAI-Agent-Bridge' }
$ControlPath = Join-Path $InstallRoot 'control'
$LogsRoot = Join-Path $InstallRoot 'logs'
$MachineName = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { 'windows-worker' }
$AllowedFields = @('id','project','repo','expected_sha','instruction','mode','network','production_authorized','commit_push','max_minutes')
$script:ActiveTaskId = $null
$script:LastHeartbeatPublish = [datetime]::MinValue
$script:CodexPath = $null

function UtcIso { [datetime]::UtcNow.ToString('o') }

function Redact([AllowNull()][string]$Text) {
    if ($null -eq $Text) { return '' }
    $v = $Text
    $v = [regex]::Replace($v, '(?i)postgres(?:ql)?://[^\s"''<>]+', '[REDACTED_DATABASE_URL]')
    $v = [regex]::Replace($v, '(?i)https?://([^/\s:@]+):([^@\s]+)@', 'https://[REDACTED_CREDENTIAL]@')
    $v = [regex]::Replace($v, '(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+', 'Bearer [REDACTED_TOKEN]')
    $v = [regex]::Replace($v, '(?i)\b(password|secret|token|api[_-]?key|database_url|credential|authorization)\b\s*[:=]\s*["'']?[^\s,"''}]+', '$1=[REDACTED]')
    $v = [regex]::Replace($v, '\b[A-Za-z0-9_\-]{64,}\b', '[REDACTED_LONG_TOKEN]')
    return $v
}

function GitRun([string]$Repo,[string[]]$Arguments,[switch]$AllowFailure) {
    $out = @(& git -C $Repo @Arguments 2>&1)
    $code = $LASTEXITCODE
    if ($code -ne 0 -and -not $AllowFailure) { throw "git $($Arguments -join ' ') failed ($code): $(Redact (($out | Out-String).Trim()))" }
    [pscustomobject]@{ ExitCode=$code; Output=$out }
}

function SyncControl {
    if (-not (Test-Path (Join-Path $ControlPath '.git'))) { throw "Control clone missing at $ControlPath. Re-run Install2.ps1." }
    GitRun $ControlPath @('fetch','origin',$ControlBranch) | Out-Null
    $branch = ((GitRun $ControlPath @('branch','--show-current')).Output | Select-Object -First 1).Trim()
    if ($branch -ne $ControlBranch) { throw "Control clone is on $branch, expected $ControlBranch." }
    GitRun $ControlPath @('pull','--rebase','origin',$ControlBranch) | Out-Null
}

function PublishJson([string]$RelativePath,$Object,[string]$Message) {
    SyncControl
    $target = Join-Path $ControlPath ($RelativePath -replace '/', [IO.Path]::DirectorySeparatorChar)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Set-Content -LiteralPath $target -Value ($Object | ConvertTo-Json -Depth 12) -Encoding utf8
    GitRun $ControlPath @('add','--',$RelativePath) | Out-Null
    $diff = GitRun $ControlPath @('diff','--cached','--quiet','--exit-code') -AllowFailure
    if ($diff.ExitCode -eq 0) { return }
    GitRun $ControlPath @('commit','-m',$Message) | Out-Null
    $push = GitRun $ControlPath @('push','origin',$ControlBranch) -AllowFailure
    if ($push.ExitCode -ne 0) {
        GitRun $ControlPath @('pull','--rebase','origin',$ControlBranch) | Out-Null
        GitRun $ControlPath @('push','origin',$ControlBranch) | Out-Null
    }
}

function Heartbeat([string]$Status,[AllowNull()][string]$Reason,[switch]$Force) {
    if (-not $Force -and (([datetime]::UtcNow - $script:LastHeartbeatPublish).TotalMinutes -lt 8)) { return }
    $hb = [ordered]@{ bridge_version=$BridgeVersion; machine=$MachineName; last_poll_time=UtcIso; active_task_id=$script:ActiveTaskId; status=$Status; reason=Redact $Reason }
    try {
        PublishJson ".agent-bridge/heartbeat/$MachineName.json" $hb "Agent bridge heartbeat: $MachineName $Status"
        $script:LastHeartbeatPublish = [datetime]::UtcNow
    } catch { Write-Warning "Heartbeat publish failed: $(Redact $_.Exception.Message)" }
}

function ValidateTask($Task) {
    $names = @($Task.PSObject.Properties.Name)
    foreach ($n in $names) { if ($AllowedFields -notcontains $n) { throw "Unknown task field '$n'." } }
    foreach ($n in @('id','project','repo','instruction','mode','network','production_authorized','commit_push','max_minutes')) { if ($names -notcontains $n) { throw "Missing required task field '$n'." } }
    if ([string]$Task.id -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{2,100}$') { throw 'Invalid task id.' }
    if ($Task.project -ne $ProjectName) { throw "Unknown project '$($Task.project)'." }
    if ($Task.repo -ne $RepoFullName) { throw "Wrong repo '$($Task.repo)'." }
    if (@('read','work','release') -notcontains [string]$Task.mode) { throw "Invalid mode '$($Task.mode)'." }
    foreach ($n in @('network','production_authorized','commit_push')) { if ($Task.$n -isnot [bool]) { throw "$n must be boolean." } }
    $minutes = 0
    if (-not [int]::TryParse([string]$Task.max_minutes,[ref]$minutes) -or $minutes -lt 1 -or $minutes -gt 1440) { throw 'max_minutes must be 1..1440.' }
    if ($Task.mode -eq 'release' -and -not $Task.production_authorized) { throw 'Release task lacks production_authorized=true.' }
    if ($names -contains 'expected_sha' -and $Task.expected_sha -and [string]$Task.expected_sha -notmatch '^[0-9a-fA-F]{40}$') { throw 'expected_sha must be a 40-character Git SHA.' }
    if ([string]::IsNullOrWhiteSpace([string]$Task.instruction)) { throw 'Task instruction is empty.' }
    $true
}

function ProjectHead { (((GitRun $ProjectPath @('rev-parse','HEAD')).Output | Select-Object -First 1).Trim()) }

function CleanLines($Value) { @($Value | Where-Object { $null -ne $_ -and -not [string]::IsNullOrWhiteSpace([string]$_) }) }

function AssertProjectReady($Task) {
    if (-not (Test-Path (Join-Path $ProjectPath '.git'))) { throw "$ProjectPath is not a Git repo." }
    $origin = (((GitRun $ProjectPath @('remote','get-url','origin')).Output | Select-Object -First 1) -replace '\\','/').Trim()
    if ($origin -notmatch 'rsolistx-ui/Tax-Build-Alpha(?:\.git)?$') { throw "Unexpected project origin '$origin'." }
    $branch = ((GitRun $ProjectPath @('branch','--show-current')).Output | Select-Object -First 1).Trim()
    if ($branch -ne $WorkBranch) { throw "Project is on $branch, expected $WorkBranch." }
    if ((CleanLines (GitRun $ProjectPath @('status','--porcelain')).Output).Count -gt 0) { throw 'Project working tree is not clean.' }
    GitRun $ProjectPath @('fetch','origin',$WorkBranch) | Out-Null
    $local = ProjectHead
    $remote = ((GitRun $ProjectPath @('rev-parse',"origin/$WorkBranch")).Output | Select-Object -First 1).Trim()
    if ($local -ne $remote) { throw "Local HEAD $local does not equal origin/$WorkBranch $remote. No automatic reset is allowed." }
    if ($Task.PSObject.Properties.Name -contains 'expected_sha' -and $Task.expected_sha -and $local -ne [string]$Task.expected_sha) { throw "Expected SHA $($Task.expected_sha), found $local." }
    $local
}

function CodexPath {
    if (-not $script:CodexPath) { $script:CodexPath = (Get-Command codex -ErrorAction Stop).Source }
    $script:CodexPath
}

function CodexRun([string]$Prompt,[ValidateSet('read','work','release')][string]$Mode,[string]$RunDir,[string]$Name,[int]$MaxMinutes,[bool]$Network) {
    New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
    $last = Join-Path $RunDir "$Name.last.md"
    $stdoutFile = Join-Path $RunDir "$Name.stdout.jsonl"
    $stderrFile = Join-Path $RunDir "$Name.stderr.log"
    $a = [Collections.Generic.List[string]]::new(); $a.Add('exec')
    if ($Mode -eq 'read') { $a.Add('--sandbox'); $a.Add('read-only') }
    else {
        $a.Add('--approve-for-me')
        if ($Network) { $a.Add('-c'); $a.Add('sandbox_workspace_write.network_access=true') }
        $a.Add('-c'); $a.Add('features.multi_agent=true')
    }
    $a.Add('--json'); $a.Add('--output-last-message'); $a.Add($last); $a.Add('-C'); $a.Add($ProjectPath); $a.Add('-')
    $psi = [Diagnostics.ProcessStartInfo]::new(); $psi.FileName=CodexPath; $psi.WorkingDirectory=$ProjectPath; $psi.UseShellExecute=$false; $psi.RedirectStandardInput=$true; $psi.RedirectStandardOutput=$true; $psi.RedirectStandardError=$true; $psi.CreateNoWindow=$true
    foreach ($x in $a) { [void]$psi.ArgumentList.Add($x) }
    $p = [Diagnostics.Process]::new(); $p.StartInfo=$psi
    if (-not $p.Start()) { throw "Could not start Codex phase $Name." }
    $p.StandardInput.Write($Prompt); $p.StandardInput.Close()
    $outTask=$p.StandardOutput.ReadToEndAsync(); $errTask=$p.StandardError.ReadToEndAsync(); $started=[datetime]::UtcNow; $timeout=$false
    while (-not $p.WaitForExit(30000)) {
        Heartbeat 'running' "Codex phase $Name active."
        if (([datetime]::UtcNow-$started).TotalMinutes -ge $MaxMinutes) { $timeout=$true; & taskkill.exe /PID $p.Id /T /F *> $null; break }
    }
    if ($timeout) { $p.WaitForExit() }
    $stdout=$outTask.GetAwaiter().GetResult(); $stderr=$errTask.GetAwaiter().GetResult()
    Set-Content $stdoutFile (Redact $stdout) -Encoding utf8; Set-Content $stderrFile (Redact $stderr) -Encoding utf8
    if ($timeout) { throw "Codex phase $Name exceeded $MaxMinutes minutes and was terminated." }
    if (-not (Test-Path $last)) { throw "Codex phase $Name produced no final-message file. Exit=$($p.ExitCode)." }
    $final=Redact (Get-Content $last -Raw); Set-Content $last $final -Encoding utf8
    if ($p.ExitCode -ne 0) { $e=Redact $stderr; if ($e.Length -gt 2500) { $e=$e.Substring($e.Length-2500) }; throw "Codex phase $Name failed ($($p.ExitCode)): $e" }
    [pscustomobject]@{ExitCode=$p.ExitCode;FinalMessage=$final;LastMessagePath=$last}
}

function Roster {
    $p=Join-Path $ControlPath '.agent-bridge\runtime\specialists.json'
    if (-not (Test-Path $p)) { throw 'specialists.json missing.' }
    Get-Content $p -Raw | ConvertFrom-Json
}

function ChooseSpecialists([string]$Instruction) {
    $t=$Instruction.ToLowerInvariant(); $s=[Collections.Generic.List[string]]::new(); $s.Add('product_strategy')
    if ($t -match 'tax|efile|e-file|irs|return|filing|signature') {$s.Add('tax_compliance')}
    if ($t -match 'security|auth|tenant|secret|oauth|portal|production|deploy|migration') {$s.Add('security_privacy')}
    if ($t -match 'visual|design|dashboard|color|chart|polish|ui|first-launch|aesthetic') {$s.Add('visual_design');$s.Add('ux_accessibility')}
    if ($t -match 'ai|agent|worker|autonom|classif|extract|draft') {$s.Add('ai_automation')}
    if ($t -match 'gmail|calendar|microsoft|excel|quickbooks|wave|connector|integration|webhook') {$s.Add('integrations_data')}
    if ($t -match 'windows|tauri|desktop|installer|package') {$s.Add('desktop_windows')}
    if ($t -match 'audio|camera|image|receipt|multimedia|scan|capture') {$s.Add('audio_multimedia')}
    @($s | Select-Object -Unique | Select-Object -First 6)
}

function Consult($Task,[string[]]$Names,[string]$RunDir) {
    $r=Roster; $reports=[Collections.Generic.List[string]]::new()
    foreach($n in $Names) {
        $directive=[string]$r.$n
        $prompt="You are the $n autonomous specialist advising a lead builder. Read the repo as needed but do not modify, commit, deploy, migrate, or mutate anything. Give concrete build guidance, risks, acceptance criteria, and implementation ideas. Directive: $directive`n`nTASK:`n$($Task.instruction)"
        try { $x=CodexRun $prompt 'read' $RunDir "specialist-$n" 15 $false; $m=$x.FinalMessage; if($m.Length-gt9000){$m=$m.Substring(0,9000)}; $reports.Add("### $n`n$m") }
        catch { $reports.Add("### $n`nSpecialist unavailable: $(Redact $_.Exception.Message)") }
    }
    @($reports)
}

function QA($Task,[string]$RunDir,[string]$Phase) {
    $directive=[string](Roster).qa_release
    $prompt="You are the independent qa_release agent. Review the CURRENT repository after the lead attempted the task. Do not modify files or repeat production actions. Verify acceptance criteria, tests, security, product quality, and regressions. Directive: $directive`n`nORIGINAL TASK:`n$($Task.instruction)`n`nFirst line MUST be exactly PASS or NEEDS_FIX. If NEEDS_FIX, list concrete findings and use BLOCKER/MATERIAL only when justified."
    CodexRun $prompt 'read' $RunDir "qa-$Phase" 20 $false
}

function QaPass([string]$Message) {
    $first=(($Message -split '\r?\n')[0]).Trim()
    $first -eq 'PASS'
}

function RunTask($Task) {
    ValidateTask $Task | Out-Null
    $start=AssertProjectReady $Task; $started=UtcIso; $dir=Join-Path $LogsRoot ([string]$Task.id); New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $script:ActiveTaskId=[string]$Task.id; Heartbeat 'running' 'Task accepted. Specialist consultations starting.' -Force
    $names=ChooseSpecialists ([string]$Task.instruction); $reports=Consult $Task $names $dir; $consult=$reports -join "`n`n"
    $lead=@"
You are the lead autonomous builder for Folio. Carry the task all the way through without asking the user to relay messages between agents. The specialist agents below are advisors. Verify their claims, integrate the best ideas, and make final engineering decisions.

Your Codex runtime has multi-agent collaboration enabled. When parallel research, visual design, UX, security review, tax compliance analysis, integration work, testing, or implementation would improve speed or quality, spawn and confer with subagents. You are the coordinating builder and remain accountable for integrating and verifying their work. Specialists provide ideas and reviews; you do the grunt work or explicitly delegate implementation to subagents and verify it.

Never reveal secrets. Never bypass approval/sandbox safety. Respect every production, scope, testing, commit, and fail-stop rule in the task.

TASK:
$($Task.instruction)

SPECIALIST CONSULTATIONS:
$consult
"@
    $main=CodexRun $lead ([string]$Task.mode) $dir 'lead' ([int]$Task.max_minutes) ([bool]$Task.network)
    $qa=QA $Task $dir 'initial'
    if(-not (QaPass $qa.FinalMessage)) {
        if($Task.mode -eq 'release'){throw "Independent QA did not pass after release task. No automatic production repair allowed. $($qa.FinalMessage)"}
        $repair="Focused repair pass. Fix every concrete issue in this independent QA review without broadening scope. Add regression proof where appropriate, rerun required verification, and commit/push if the original task requires it.`n`nORIGINAL TASK:`n$($Task.instruction)`n`nQA:`n$($qa.FinalMessage)"
        $main=CodexRun $repair 'work' $dir 'repair' ([Math]::Min([int]$Task.max_minutes,240)) ([bool]$Task.network)
        $qa=QA $Task $dir 'final'
        if(-not (QaPass $qa.FinalMessage)){throw "Final independent QA still did not pass: $($qa.FinalMessage)"}
    }
    GitRun $ProjectPath @('fetch','origin',$WorkBranch)|Out-Null; $end=ProjectHead; $remote=((GitRun $ProjectPath @('rev-parse',"origin/$WorkBranch")).Output|Select-Object -First 1).Trim()
    if($Task.commit_push -and $end -ne $remote){throw "Task required commit/push but local HEAD $end differs from origin/$WorkBranch $remote."}
    if((CleanLines (GitRun $ProjectPath @('status','--porcelain')).Output).Count -gt 0){throw 'Task left working tree dirty.'}
    $summary=Redact "Specialists consulted: $($names -join ', ').`n`n$($main.FinalMessage)`n`nQA:`n$($qa.FinalMessage)"; if($summary.Length-gt16000){$summary=$summary.Substring(0,16000)}
    $mutated=$summary -match '(?i)production\s+(migration|deploy|data mutation)\s+performed\s*:\s*YES|production_mutation\s*[:=]\s*true'
    [ordered]@{id=[string]$Task.id;status='completed';started_at=$started;finished_at=UtcIso;project=$ProjectName;start_sha=$start;end_sha=$end;exit_code=0;specialists=@($names);summary=$summary;log_path=$dir;production_mutation=[bool]$mutated;bridge_version=$BridgeVersion}
}

function Blocker {
    $d=Join-Path $ControlPath '.agent-bridge\outbox'; if(-not(Test-Path $d)){return $null}
    foreach($f in Get-ChildItem $d -Filter '*.json' -File|Sort-Object Name){try{$r=Get-Content $f.FullName -Raw|ConvertFrom-Json;if($r.status -in @('failed','rejected')){return $r}}catch{}}
    $null
}
function NextTask {
    $i=Join-Path $ControlPath '.agent-bridge\inbox';$o=Join-Path $ControlPath '.agent-bridge\outbox';if(-not(Test-Path $i)){return $null}
    foreach($f in Get-ChildItem $i -Filter '*.json' -File|Sort-Object Name){if(-not(Test-Path (Join-Path $o $f.Name))){return(Get-Content $f.FullName -Raw|ConvertFrom-Json)}};$null
}
function Failure($Task,[string]$Status,[string]$Message,[AllowNull()][string]$Start,[AllowNull()][string]$Started){
    $end=$null;try{$end=ProjectHead}catch{}
    $id=if($Task -and ($Task.PSObject.Properties.Name -contains 'id')){[string]$Task.id}else{'unknown-task'}
    $r=[ordered]@{id=$id;status=$Status;started_at=if($Started){$Started}else{UtcIso};finished_at=UtcIso;project=$ProjectName;start_sha=$Start;end_sha=$end;exit_code=1;specialists=@();summary=Redact $Message;log_path=Join-Path $LogsRoot $id;production_mutation=$false;bridge_version=$BridgeVersion}
    if($id -ne 'unknown-task'){PublishJson ".agent-bridge/outbox/$id.json" $r "Agent bridge result: $id"}
}

function SelfTests {
    $valid=[pscustomobject]@{id='test-task';project=$ProjectName;repo=$RepoFullName;instruction='read';mode='read';network=$false;production_authorized=$false;commit_push=$false;max_minutes=5}
    ValidateTask $valid|Out-Null
    $bad=[pscustomobject]@{id='test-rel';project=$ProjectName;repo=$RepoFullName;instruction='release';mode='release';network=$false;production_authorized=$false;commit_push=$false;max_minutes=5}
    $caught=$false;try{ValidateTask $bad|Out-Null}catch{$caught=$true};if(-not$caught){throw 'Release authorization self-test failed.'}
    $unknown=[pscustomobject]@{id='test-unk';project=$ProjectName;repo=$RepoFullName;instruction='x';mode='read';network=$false;production_authorized=$false;commit_push=$false;max_minutes=5;surprise=1}
    $caught=$false;try{ValidateTask $unknown|Out-Null}catch{$caught=$true};if(-not$caught){throw 'Unknown field self-test failed.'}
    $safe=Redact 'DATABASE_URL=postgresql://u:p@example.invalid/db Bearer abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';if($safe -match 'u:p|abcdefghijklmnopqrstuvwxyz'){throw 'Redaction self-test failed.'}
    'BRIDGE_SELF_TEST_OK'
}

if($SelfTest){SelfTests;exit 0}
New-Item -ItemType Directory -Force -Path $LogsRoot|Out-Null;CodexPath|Out-Null;Heartbeat 'starting' 'Bridge v2 started.' -Force
while($true){
    try{
        SyncControl;$b=Blocker
        if($b){$script:ActiveTaskId=$null;Heartbeat 'blocked' "Queue blocked by $($b.id): $($b.summary)"}
        else{
            $t=NextTask
            if($null -eq $t){$script:ActiveTaskId=$null;Heartbeat 'idle' 'No pending tasks.'}
            else{
                $started=UtcIso;$start=$null
                try{ValidateTask $t|Out-Null;$start=AssertProjectReady $t;$result=RunTask $t;PublishJson ".agent-bridge/outbox/$($t.id).json" $result "Agent bridge result: $($t.id)";$script:ActiveTaskId=$null;Heartbeat 'idle' "Task $($t.id) completed." -Force}
                catch{$msg=Redact $_.Exception.Message;$status=if($msg -match 'Unknown task|Wrong repo|Invalid mode|production_authorized|Expected SHA|working tree|Unexpected project origin'){'rejected'}else{'failed'};Failure $t $status $msg $start $started;$script:ActiveTaskId=$null;Heartbeat 'blocked' "Task $($t.id) $status: $msg" -Force}
            }
        }
    }catch{$script:ActiveTaskId=$null;Heartbeat 'error' (Redact $_.Exception.Message) -Force}
    if($Once){break};Start-Sleep 60
}
