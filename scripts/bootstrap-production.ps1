[CmdletBinding()]
param(
  [string]$AuthDbName = "folio-db",
  [string]$R2BucketName = "folio-receipts"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$configPath = Join-Path $repoRoot "apps\api\wrangler.toml"

function Assert-ExitCode([string]$Step) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE."
  }
}

function Read-SecretText([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

function New-RandomSecret {
  $bytes = New-Object byte[] 48
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return ([Convert]::ToBase64String($bytes)).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Set-WorkerSecret([string]$Name, [string]$Value) {
  $Value | & npx wrangler secret put $Name --config $configPath
  Assert-ExitCode "Setting Worker secret $Name"
}

function Get-D1Database([string]$Name) {
  $json = (& npx wrangler d1 list --json 2>$null | Out-String)
  Assert-ExitCode "Listing D1 databases"
  $items = @($json | ConvertFrom-Json)
  return $items | Where-Object { $_.name -eq $Name } | Select-Object -First 1
}

function Patch-WorkerConfig([string]$DatabaseId, [string]$WorkerUrl = "") {
  $config = Get-Content -Raw $configPath
  $config = [regex]::Replace(
    $config,
    'database_id\s*=\s*"[^"]+"',
    "database_id = `"$DatabaseId`"",
    1
  )

  if ($WorkerUrl) {
    $config = [regex]::Replace(
      $config,
      'BETTER_AUTH_URL\s*=\s*"[^"]+"',
      "BETTER_AUTH_URL = `"$WorkerUrl`"",
      1
    )
    $config = [regex]::Replace(
      $config,
      'APP_ORIGIN\s*=\s*"[^"]+"',
      "APP_ORIGIN = `"$WorkerUrl`"",
      1
    )
  }

  Set-Content -Path $configPath -Value $config -NoNewline
}

function Deploy-Worker {
  $lines = @(& npx wrangler deploy --config $configPath 2>&1)
  $lines | ForEach-Object { Write-Host $_ }
  Assert-ExitCode "Worker deployment"
  $text = $lines -join "`n"
  $match = [regex]::Match($text, 'https://[A-Za-z0-9.-]+\.workers\.dev')
  if (-not $match.Success) {
    throw "Worker deployed, but its workers.dev URL could not be parsed from Wrangler output."
  }
  return $match.Value.TrimEnd("/")
}

Push-Location $repoRoot
try {
  Write-Host "Installing locked dependencies..."
  & npm ci
  Assert-ExitCode "npm ci"

  Write-Host "Checking Cloudflare authentication..."
  & npx wrangler whoami
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Cloudflare login is required. Opening the Wrangler login flow..."
    & npx wrangler login
    Assert-ExitCode "Cloudflare login"
    & npx wrangler whoami
    Assert-ExitCode "Cloudflare authentication check"
  }

  $databaseUrl = $env:DATABASE_URL
  if ([string]::IsNullOrWhiteSpace($databaseUrl)) {
    $databaseUrl = Read-SecretText "Paste the pooled Neon DATABASE_URL"
  }
  if ($databaseUrl -notmatch '^postgres(ql)?://') {
    throw "DATABASE_URL must be a PostgreSQL connection string."
  }

  Write-Host "Ensuring auth-only D1 database '$AuthDbName' exists..."
  $d1 = Get-D1Database $AuthDbName
  if (-not $d1) {
    & npx wrangler d1 create $AuthDbName
    Assert-ExitCode "Creating D1 database $AuthDbName"
    $d1 = Get-D1Database $AuthDbName
  }
  if (-not $d1) {
    throw "D1 database '$AuthDbName' was not found after creation."
  }
  $databaseId = if ($d1.uuid) { [string]$d1.uuid } elseif ($d1.id) { [string]$d1.id } else { "" }
  if (-not $databaseId) {
    throw "Could not determine the D1 database ID for '$AuthDbName'."
  }
  Patch-WorkerConfig -DatabaseId $databaseId

  Write-Host "Ensuring private R2 bucket '$R2BucketName' exists..."
  $r2List = (& npx wrangler r2 bucket list 2>&1 | Out-String)
  Assert-ExitCode "Listing R2 buckets"
  if ($r2List -notmatch [regex]::Escape($R2BucketName)) {
    & npx wrangler r2 bucket create $R2BucketName
    Assert-ExitCode "Creating R2 bucket $R2BucketName"
  }

  Write-Host "Applying Better Auth D1 migration..."
  & npm run auth:migrate:remote
  Assert-ExitCode "Remote Better Auth migration"

  Write-Host "Applying Neon business schema..."
  $previousDatabaseUrl = $env:DATABASE_URL
  $env:DATABASE_URL = $databaseUrl
  try {
    & npm run db:migrate:neon
    Assert-ExitCode "Neon migration"
  } finally {
    $env:DATABASE_URL = $previousDatabaseUrl
  }

  Write-Host "Building the React paid-alpha client..."
  Remove-Item Env:VITE_API_URL -ErrorAction SilentlyContinue
  & npm run build -w @folio/web
  Assert-ExitCode "Web build"

  Write-Host "Creating the initial Worker deployment so Cloudflare assigns the canonical origin..."
  $workerUrl = Deploy-Worker

  Write-Host "Configuring first-party production auth for $workerUrl..."
  Patch-WorkerConfig -DatabaseId $databaseId -WorkerUrl $workerUrl
  Set-WorkerSecret "BETTER_AUTH_SECRET" (New-RandomSecret)
  Set-WorkerSecret "DATABASE_URL" $databaseUrl

  if (-not [string]::IsNullOrWhiteSpace($env:GEMINI_API_KEY)) {
    Write-Host "Configuring optional Gemini fallback from GEMINI_API_KEY..."
    Set-WorkerSecret "GEMINI_API_KEY" $env:GEMINI_API_KEY
  }

  Write-Host "Deploying the final single-origin Worker plus SPA assets..."
  $workerUrl = Deploy-Worker

  Write-Host "Verifying production health..."
  $health = Invoke-RestMethod -Uri "$workerUrl/api/health" -Method Get
  if (-not $health.ok) {
    throw "Production health endpoint did not return ok=true."
  }
  if ($health.appDatabase -ne "neon-postgres" -or -not $health.workersAi) {
    throw "Production health check is missing Neon or Workers AI."
  }

  Write-Host ""
  Write-Host "Folio paid-alpha infrastructure is live." -ForegroundColor Green
  Write-Host "App:    $workerUrl"
  Write-Host "Health: $workerUrl/api/health"
  Write-Host "D1:     $AuthDbName ($databaseId)"
  Write-Host "R2:     $R2BucketName"
  Write-Host ""
  Write-Host "Next: run scripts\smoke-production.ps1 -BaseUrl '$workerUrl' to exercise the complete receipt-to-P&L path."
} finally {
  Pop-Location
}
