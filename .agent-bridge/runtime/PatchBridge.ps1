param([Parameter(Mandatory)][string]$Path)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$text = Get-Content -LiteralPath $Path -Raw

function Replace-Required {
    param([string]$Old,[string]$New,[int]$Minimum=1)
    $count = 0
    $cursor = 0
    while (($index = $script:text.IndexOf($Old,$cursor,[StringComparison]::Ordinal)) -ge 0) {
        $count++
        $cursor = $index + $Old.Length
    }
    if ($count -lt $Minimum) { throw "Bridge patch target not found: $($Old.Substring(0,[Math]::Min(80,$Old.Length)))" }
    $script:text = $script:text.Replace($Old,$New)
}

Replace-Required -Old '$BridgeVersion = ''1.0.0''' -New '$BridgeVersion = ''2.1.0'''

$oldDirty = '$dirty = @((Invoke-Git -Repo $ProjectPath -Arguments @(''status'',''--porcelain'')).Output)'
$newDirty = '$dirty = @((Invoke-Git -Repo $ProjectPath -Arguments @(''status'',''--porcelain'')).Output | Where-Object { $null -ne $_ -and -not [string]::IsNullOrWhiteSpace([string]$_) })'
Replace-Required -Old $oldDirty -New $newDirty -Minimum 2

$oldQa = '$needsFix = $qa.FinalMessage -match ''(?im)^NEEDS_FIX\s*$|\bBLOCKER\b|\bMATERIAL\b'''
$newQa = '$needsFix = (((($qa.FinalMessage -split ''\r?\n'')[0]).Trim()) -ne ''PASS'')'
Replace-Required -Old $oldQa -New $newQa

$oldFinalQa = 'if ($qa.FinalMessage -match ''(?im)^NEEDS_FIX\s*$|\bBLOCKER\b|\bMATERIAL\b'') {'
$newFinalQa = 'if ((((($qa.FinalMessage -split ''\r?\n'')[0]).Trim())) -ne ''PASS'') {'
Replace-Required -Old $oldFinalQa -New $newFinalQa

$oldReleaseTest = '$badRelease = $sample.PSObject.Copy(); $badRelease.mode=''release'''
$newReleaseTest = '$badRelease = [pscustomobject]@{ id=''test-rel''; project=$ProjectName; repo=$RepoFullName; instruction=''release''; mode=''release''; network=$false; production_authorized=$false; commit_push=$false; max_minutes=5 }'
Replace-Required -Old $oldReleaseTest -New $newReleaseTest

$oldUnknownTest = '$unknown = $sample.PSObject.Copy(); $unknown | Add-Member -NotePropertyName surprise -NotePropertyValue 1'
$newUnknownTest = '$unknown = [pscustomobject]@{ id=''test-unknown''; project=$ProjectName; repo=$RepoFullName; instruction=''x''; mode=''read''; network=$false; production_authorized=$false; commit_push=$false; max_minutes=5; surprise=1 }'
Replace-Required -Old $oldUnknownTest -New $newUnknownTest

$oldMulti = @'
        $args.Add('--approve-for-me')
        if ($Network) { $args.Add('-c'); $args.Add('sandbox_workspace_write.network_access=true') }
'@
$newMulti = @'
        $args.Add('--approve-for-me')
        $args.Add('-c'); $args.Add('features.multi_agent=true')
        if ($Network) { $args.Add('-c'); $args.Add('sandbox_workspace_write.network_access=true') }
'@
Replace-Required -Old $oldMulti -New $newMulti

Set-Content -LiteralPath $Path -Value $text -Encoding utf8
Write-Output 'BRIDGE_PATCH_OK'
