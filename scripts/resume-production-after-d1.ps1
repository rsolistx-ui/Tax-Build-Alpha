[CmdletBinding()]
param(
  [string]$NeonProjectId = "broad-star-47495745",
  [string]$D1DatabaseName = "folio-db",
  [string]$D1DatabaseId = "e6893c3a-8ea4-4242-96b2-8b18adc543af",
  [string]$R2BucketName = "folio-receipts"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$configPath = Join-Path $repoRoot "apps\api\wrangler.toml"
$smokeScriptPath = Join-Path $repoRoot "scripts\smoke-production.ps1"
$uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

function Assert-ExitCode([string]$Step) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE."
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

function Patch-OneConfigValue([string]$Pattern, [string]$Replacement) {
  $config = Get-Content -Raw $configPath
  $regex = New-Object System.Text.RegularExpressions.Regex($Pattern)
  if (-not $regex.IsMatch($config)) {
    throw "Could not find expected configuration entry matching '$Pattern'."
  }
  $updated = $regex.Replace($config, $Replacement, 1)
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($configPath, $updated, $utf8)
}

function Deploy-Worker {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $lines = @(& npx wrangler deploy --config $configPath 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }

  $lines | ForEach-Object { Write-Host $_ }
  if ($exitCode -ne 0) {
    throw "Worker deployment failed with exit code $exitCode."
  }

  $text = $lines -join "`n"
  $match = [regex]::Match($text, 'https://[A-Za-z0-9.-]+\.workers\.dev')
  if (-not $match.Success) {
    throw "Worker deployed, but its workers.dev URL could not be parsed from Wrangler output."
  }
  return $match.Value.TrimEnd("/")
}

Push-Location $repoRoot
$previousDatabaseUrl = $env:DATABASE_URL
try {
  if ($D1DatabaseId -notmatch $uuidPattern) {
    throw "D1DatabaseId must be exactly one UUID. Received '$D1DatabaseId'."
  }

  Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue

  Write-Host "Verifying the existing Cloudflare D1 database..."
  $d1Json = (& npx wrangler d1 info $D1DatabaseName --json 2>$null | Out-String)
  Assert-ExitCode "Reading D1 database info"
  $d1 = $d1Json | ConvertFrom-Json
  $remoteD1Id = if ($d1.uuid) { [string]$d1.uuid } elseif ($d1.database_id) { [string]$d1.database_id } else { "" }
  if ($remoteD1Id -notmatch $uuidPattern) {
    throw "Cloudflare did not return one valid UUID for D1 database '$D1DatabaseName'."
  }
  if ($remoteD1Id -ne $D1DatabaseId) {
    throw "D1 UUID mismatch. Expected '$D1DatabaseId' but Cloudflare returned '$remoteD1Id'."
  }

  Write-Host "Pinning wrangler.toml to D1 database $remoteD1Id..."
  Patch-OneConfigValue 'database_id\s*=\s*"[^"]+"' "database_id = `"$remoteD1Id`""

  Write-Host "Verifying the existing R2 bucket..."
  $r2List = (& npx wrangler r2 bucket list 2>&1 | Out-String)
  Assert-ExitCode "Listing R2 buckets"
  if ($r2List -notmatch [regex]::Escape($R2BucketName)) {
    throw "R2 bucket '$R2BucketName' is missing. Do not continue until it exists."
  }

  Write-Host "Retrieving the pooled Neon connection string..."
  $neonOutput = @(& npx --yes neon@latest connection-string --project-id $NeonProjectId --pooled 2>$null)
  Assert-ExitCode "Getting pooled Neon connection string"
  $neonText = ($neonOutput -join "`n").Trim()
  $connectionMatch = [regex]::Match($neonText, 'postgres(?:ql)?://[^\s]+')
  if (-not $connectionMatch.Success) {
    throw "Neon did not return a PostgreSQL connection string for project '$NeonProjectId'."
  }
  $databaseUrl = $connectionMatch.Value.Trim()

  Write-Host "Applying the Neon business schema..."
  $env:DATABASE_URL = $databaseUrl
  & npm run db:migrate:neon
  Assert-ExitCode "Neon migration"

  Write-Host "Building the React paid-alpha client..."
  Remove-Item Env:VITE_API_URL -ErrorAction SilentlyContinue
  & npm run build -w @folio/web
  Assert-ExitCode "Web build"

  Write-Host "Creating the initial Worker deployment..."
  $workerUrl = Deploy-Worker

  Write-Host "Configuring first-party production auth for $workerUrl..."
  Patch-OneConfigValue 'BETTER_AUTH_URL\s*=\s*"[^"]+"' "BETTER_AUTH_URL = `"$workerUrl`""
  Patch-OneConfigValue 'APP_ORIGIN\s*=\s*"[^"]+"' "APP_ORIGIN = `"$workerUrl`""

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
  Write-Host "Neon:   $NeonProjectId"
  Write-Host "D1:     $D1DatabaseName ($remoteD1Id)"
  Write-Host "R2:     $R2BucketName"

  if (-not (Test-Path $smokeScriptPath)) {
    throw "Smoke test script is missing at $smokeScriptPath."
  }

  Write-Host ""
  Write-Host "Running the complete receipt-to-P&L production smoke test..."
  & $smokeScriptPath -BaseUrl $workerUrl
  if ($LASTEXITCODE -ne 0) {
    throw "Production smoke test failed with exit code $LASTEXITCODE."
  }

  Write-Host ""
  Write-Host "DEPLOYMENT AND END-TO-END VERIFICATION COMPLETE" -ForegroundColor Green
} finally {
  $env:DATABASE_URL = $previousDatabaseUrl
  Pop-Location
}
