[CmdletBinding()]
param(
  [string]$NeonOrgId = $env:NEON_ORG_ID
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$bootstrapScript = Join-Path $repoRoot "scripts\bootstrap-production.ps1"

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command,
    [Parameter(Mandatory = $true)]
    [string]$Step,
    [switch]$Quiet,
    [switch]$AllowFailure
  )

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    if ($Quiet) {
      & $Command 2>&1 | Out-Null
    } else {
      & $Command 2>&1 | ForEach-Object { Write-Host $_ }
    }
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }

  if (-not $AllowFailure -and $exitCode -ne 0) {
    throw "$Step failed with exit code $exitCode."
  }

  return $exitCode
}

Push-Location $repoRoot
try {
  if (-not (Test-Path $bootstrapScript)) {
    throw "Production bootstrap script is missing at $bootstrapScript."
  }

  # Local interactive production setup should use Wrangler OAuth. A shell-level
  # CLOUDFLARE_API_TOKEN takes precedence over OAuth and can be valid for whoami
  # while still lacking D1/R2/Workers write scopes. Ignore it only in this child
  # process so the user's persistent environment is not modified.
  if (-not [string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)) {
    Write-Host "Ignoring CLOUDFLARE_API_TOKEN for this interactive production setup." -ForegroundColor Yellow
    Write-Host "Wrangler OAuth will be used so D1, R2, and Worker deployment scopes can be authorized explicitly."
    Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
  }

  Write-Host "Checking Cloudflare OAuth authentication..."
  $whoamiExit = Invoke-NativeChecked -Command { npx wrangler whoami } -Step "Cloudflare OAuth check" -AllowFailure

  if ($whoamiExit -ne 0) {
    Write-Host "Cloudflare OAuth login is required. Opening the browser authorization flow..." -ForegroundColor Yellow
    Invoke-NativeChecked -Command { npx wrangler login } -Step "Cloudflare OAuth login" | Out-Null
  }

  Write-Host "Verifying Cloudflare D1 access..."
  $d1Exit = Invoke-NativeChecked -Command { npx wrangler d1 list --json } -Step "Cloudflare D1 preflight" -Quiet -AllowFailure
  if ($d1Exit -ne 0) {
    Write-Host "The current Wrangler OAuth grant does not include D1 access. Reauthorizing Wrangler..." -ForegroundColor Yellow
    Invoke-NativeChecked -Command { npx wrangler login } -Step "Cloudflare OAuth reauthorization" | Out-Null
    $d1Exit = Invoke-NativeChecked -Command { npx wrangler d1 list --json } -Step "Cloudflare D1 preflight" -Quiet -AllowFailure
    if ($d1Exit -ne 0) {
      throw "Cloudflare D1 access is still unavailable after OAuth authorization. Re-run Wrangler login and grant the D1 permission when Cloudflare shows the permission screen."
    }
  }

  Write-Host "Verifying Cloudflare R2 access..."
  $r2Exit = Invoke-NativeChecked -Command { npx wrangler r2 bucket list } -Step "Cloudflare R2 preflight" -Quiet -AllowFailure
  if ($r2Exit -ne 0) {
    throw "Cloudflare R2 access is unavailable. Re-run Wrangler login and grant the R2 permission when Cloudflare shows the permission screen."
  }

  Write-Host "Cloudflare production permissions verified." -ForegroundColor Green
  Write-Host "Starting the Tax Build Alpha production bootstrap..."

  if ([string]::IsNullOrWhiteSpace($NeonOrgId)) {
    & $bootstrapScript
  } else {
    & $bootstrapScript -NeonOrgId $NeonOrgId
  }

  if ($LASTEXITCODE -ne 0) {
    throw "Production bootstrap failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}
