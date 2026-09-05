[CmdletBinding()]
param(
  [string]$NeonOrgId = $env:NEON_ORG_ID
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$bootstrapScript = Join-Path $repoRoot "scripts\bootstrap-production.ps1"

function Invoke-NativeCapture {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command
  )

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $lines = @(& $Command 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }

  return [PSCustomObject]@{
    ExitCode = $exitCode
    Lines = $lines
    Text = ($lines -join "`n")
  }
}

function Write-NativeOutput($Result) {
  $Result.Lines | ForEach-Object { Write-Host $_ }
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
    Write-Host "Wrangler OAuth will be used for Cloudflare production provisioning."
    Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
  }

  Write-Host "Checking Cloudflare OAuth authentication..."
  $whoami = Invoke-NativeCapture { npx wrangler whoami }
  if ($whoami.ExitCode -ne 0) {
    Write-Host "Cloudflare OAuth login is required. Opening the browser authorization flow..." -ForegroundColor Yellow
    $login = Invoke-NativeCapture { npx wrangler login }
    Write-NativeOutput $login
    if ($login.ExitCode -ne 0) {
      throw "Cloudflare OAuth login failed with exit code $($login.ExitCode)."
    }
  }

  Write-Host "Verifying Cloudflare D1 access..."
  $d1 = Invoke-NativeCapture { npx wrangler d1 list --json }
  if ($d1.ExitCode -ne 0) {
    Write-Host "D1 preflight failed:" -ForegroundColor Red
    Write-NativeOutput $d1
    throw "Cloudflare D1 access is unavailable. The Wrangler OAuth grant must include D1 access."
  }

  Write-Host "Verifying Cloudflare R2 access..."
  $r2 = Invoke-NativeCapture { npx wrangler r2 bucket list }
  if ($r2.ExitCode -ne 0) {
    Write-Host "R2 preflight failed:" -ForegroundColor Red
    Write-NativeOutput $r2
    Write-Host ""
    Write-Host "Cloudflare requires an R2 subscription before Wrangler can list or create R2 buckets." -ForegroundColor Yellow
    Write-Host "In the Cloudflare dashboard open Storage & databases > R2 > Overview and complete the R2 subscription checkout." -ForegroundColor Yellow
    Write-Host "R2 includes a monthly free tier, but Cloudflare still requires the subscription to be activated." -ForegroundColor Yellow
    throw "Cloudflare R2 is not available to this account yet. Enable the R2 subscription, then rerun this same setup script."
  }

  Write-Host "Cloudflare production prerequisites verified." -ForegroundColor Green
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
