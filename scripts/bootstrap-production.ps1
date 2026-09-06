[CmdletBinding()]
param(
  [string]$AuthDbName = "folio-db",
  [string]$R2BucketName = "folio-receipts",
  [string]$NeonProjectName = "folio-alpha",
  [string]$NeonOrgId = $env:NEON_ORG_ID,
  [switch]$SkipSmokeTest
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$configPath = Join-Path $repoRoot "apps\api\wrangler.toml"
$smokeScriptPath = Join-Path $repoRoot "scripts\smoke-production.ps1"

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

function Get-D1Database([string]$Name) {
  $json = (& npx wrangler d1 list --json 2>$null | Out-String)
  Assert-ExitCode "Listing D1 databases"
  $items = @($json | ConvertFrom-Json)
  return $items | Where-Object { $_.name -eq $Name } | Select-Object -First 1
}

function Invoke-Neon([string[]]$Arguments, [switch]$Quiet) {
  if ($Quiet) {
    $output = @(& npx --yes neon@latest @Arguments 2>$null)
  } else {
    $output = @(& npx --yes neon@latest @Arguments 2>&1)
    $output | ForEach-Object { Write-Host $_ }
  }
  return $output
}

function Convert-NeonCollection([object]$Parsed, [string[]]$PropertyNames) {
  if ($null -eq $Parsed) {
    return @()
  }
  if ($Parsed -is [System.Array]) {
    return @($Parsed)
  }
  foreach ($propertyName in $PropertyNames) {
    if ($Parsed.PSObject.Properties.Name -contains $propertyName) {
      return @($Parsed.$propertyName)
    }
  }
  return @($Parsed)
}

function Get-NeonOrganizations {
  $output = Invoke-Neon @("orgs", "list", "--output", "json") -Quiet
  if ($LASTEXITCODE -ne 0) {
    return $null
  }

  $text = $output -join "`n"
  if ([string]::IsNullOrWhiteSpace($text)) {
    return @()
  }

  try {
    $parsed = $text | ConvertFrom-Json
  } catch {
    throw "Neon returned non-JSON organization output. Run 'npx --yes neon@latest orgs list --output json' to inspect it."
  }

  return Convert-NeonCollection $parsed @("organizations", "orgs")
}

function Resolve-NeonOrgId([string]$PreferredOrgId) {
  if (-not [string]::IsNullOrWhiteSpace($PreferredOrgId)) {
    Write-Host "Using Neon organization '$PreferredOrgId' from NEON_ORG_ID / parameter."
    return $PreferredOrgId
  }

  Write-Host "Resolving Neon organization..."
  $organizations = Get-NeonOrganizations
  if ($null -eq $organizations) {
    Write-Host "Neon login is required. Opening the Neon OAuth flow..."
    Invoke-Neon @("auth") | Out-Null
    Assert-ExitCode "Neon authentication"
    $organizations = Get-NeonOrganizations
  }

  if ($null -eq $organizations -or @($organizations).Count -eq 0) {
    throw "No Neon organizations are available to this account."
  }

  $organizations = @($organizations)
  if ($organizations.Count -eq 1) {
    $organization = $organizations[0]
  } else {
    Write-Host "Multiple Neon organizations are available:" -ForegroundColor Yellow
    for ($i = 0; $i -lt $organizations.Count; $i++) {
      $orgName = if ($organizations[$i].name) { [string]$organizations[$i].name } else { "Unnamed organization" }
      $orgId = if ($organizations[$i].id) { [string]$organizations[$i].id } elseif ($organizations[$i].org_id) { [string]$organizations[$i].org_id } else { "unknown" }
      Write-Host "[$($i + 1)] $orgName ($orgId)"
    }

    $selection = Read-Host "Select the Neon organization number to use for Folio"
    $selectionNumber = 0
    if (-not [int]::TryParse($selection, [ref]$selectionNumber) -or $selectionNumber -lt 1 -or $selectionNumber -gt $organizations.Count) {
      throw "Invalid Neon organization selection."
    }
    $organization = $organizations[$selectionNumber - 1]
  }

  $resolvedOrgId = if ($organization.id) { [string]$organization.id } elseif ($organization.org_id) { [string]$organization.org_id } else { "" }
  if ([string]::IsNullOrWhiteSpace($resolvedOrgId)) {
    throw "Could not determine the Neon organization ID."
  }

  $resolvedOrgName = if ($organization.name) { [string]$organization.name } else { "Neon organization" }
  Write-Host "Using Neon organization '$resolvedOrgName' ($resolvedOrgId)."
  return $resolvedOrgId
}

function Get-NeonProjects([string]$OrgId) {
  $output = Invoke-Neon @("projects", "list", "--org-id", $OrgId, "--output", "json") -Quiet
  if ($LASTEXITCODE -ne 0) {
    return $null
  }

  $text = $output -join "`n"
  if ([string]::IsNullOrWhiteSpace($text)) {
    return @()
  }

  try {
    $parsed = $text | ConvertFrom-Json
  } catch {
    throw "Neon returned non-JSON project output. Run 'npx --yes neon@latest projects list --org-id <ORG_ID> --output json' to inspect it."
  }

  return Convert-NeonCollection $parsed @("projects")
}

function Get-NeonDatabaseUrl([string]$ProjectId) {
  $output = Invoke-Neon @("connection-string", "--project-id", $ProjectId, "--pooled") -Quiet
  Assert-ExitCode "Getting pooled Neon connection string"
  $text = ($output -join "`n").Trim()
  $match = [regex]::Match($text, 'postgres(?:ql)?://[^\s]+')
  if (-not $match.Success) {
    throw "Neon did not return a PostgreSQL connection string for project '$ProjectId'."
  }
  return $match.Value.Trim()
}

function Ensure-NeonDatabase([string]$ProjectName, [string]$PreferredOrgId) {
  Write-Host "Checking Neon authentication and project access..."
  $orgId = Resolve-NeonOrgId $PreferredOrgId
  $projects = Get-NeonProjects $orgId

  if ($null -eq $projects) {
    Write-Host "Neon authentication may have expired. Opening the Neon OAuth flow..."
    Invoke-Neon @("auth") | Out-Null
    Assert-ExitCode "Neon authentication"
    $projects = Get-NeonProjects $orgId
    if ($null -eq $projects) {
      throw "Neon authentication succeeded but projects could not be listed for organization '$orgId'."
    }
  }

  $project = @($projects) | Where-Object { $_.name -eq $ProjectName } | Select-Object -First 1
  if (-not $project) {
    Write-Host "Creating Neon project '$ProjectName'..."
    Invoke-Neon @("projects", "create", "--org-id", $orgId, "--name", $ProjectName, "--output", "json") | Out-Null
    Assert-ExitCode "Creating Neon project $ProjectName"

    $projects = Get-NeonProjects $orgId
    $project = @($projects) | Where-Object { $_.name -eq $ProjectName } | Select-Object -First 1
  }

  if (-not $project) {
    throw "Neon project '$ProjectName' could not be found after creation."
  }

  $projectId = if ($project.id) { [string]$project.id } elseif ($project.project_id) { [string]$project.project_id } else { "" }
  if (-not $projectId) {
    throw "Could not determine the Neon project ID for '$ProjectName'."
  }

  Write-Host "Using Neon project '$ProjectName' ($projectId)."
  return Get-NeonDatabaseUrl $projectId
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
    $databaseUrl = Ensure-NeonDatabase $NeonProjectName $NeonOrgId
  } else {
    Write-Host "Using DATABASE_URL already present in this PowerShell session."
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

    Write-Host "Verifying the production Neon schema actually reflects every applied migration..."
    & npm run db:verify:neon
    Assert-ExitCode "Neon schema verification"
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
  Write-Host "Neon:   $NeonProjectName"
  Write-Host "D1:     $AuthDbName ($databaseId)"
  Write-Host "R2:     $R2BucketName"

  if (-not $SkipSmokeTest) {
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
  } else {
    Write-Host ""
    Write-Host "Smoke test skipped by request. Run scripts\smoke-production.ps1 -BaseUrl '$workerUrl' before treating the alpha as verified." -ForegroundColor Yellow
  }
} finally {
  Pop-Location
}
