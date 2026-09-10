[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$BaseUrl,
  [string]$ReceiptPath = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$BaseUrl = $BaseUrl.TrimEnd("/")

# Fail fast, before any production mutation happens: a run without a cleanup
# token can create real synthetic firms/clients/documents/receipts with no
# way to remove them afterward via the internal cleanup endpoint. Refuse to
# start rather than warn about this only after the fact.
#
# Resolution order: an existing process env var wins; otherwise attempt to
# load a Windows DPAPI (CurrentUser)-protected local credential so repeated
# runs on this machine don't require re-rotating the secret every time.
. (Join-Path $PSScriptRoot "get-smoke-cleanup-token.ps1")
Import-SmokeCleanupToken | Out-Null
if (-not $env:SMOKE_CLEANUP_TOKEN) {
  Write-Error "SMOKE_CLEANUP_TOKEN is not set. Refusing to start: this script cannot run without a way to clean up the synthetic production data it creates."
  exit 1
}

function Invoke-CurlJson([string[]]$CurlArgs, [int]$Attempt = 0) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = @(& curl.exe --silent --show-error --write-out "`n__FOLIO_HTTP_STATUS__:%{http_code}" @CurlArgs 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }

  $text = $output -join "`n"
  $marker = "__FOLIO_HTTP_STATUS__:"
  $markerIndex = $text.LastIndexOf($marker)
  if ($markerIndex -lt 0) {
    throw "curl failed before an HTTP status could be read. Exit code: $exitCode. Output: $text"
  }

  $body = $text.Substring(0, $markerIndex).Trim()
  $statusText = $text.Substring($markerIndex + $marker.Length).Trim()
  $statusCode = 0
  if (-not [int]::TryParse($statusText, [ref]$statusCode)) {
    throw "Could not parse HTTP status '$statusText'. Response: $body"
  }

  # A Cloudflare edge 502/503/504 is infrastructure-transient, not a passed
  # application assertion. Retry a bounded number of times so the release
  # proof is resilient without masking a persistent product failure.
  if (($statusCode -eq 502 -or $statusCode -eq 503 -or $statusCode -eq 504) -and $Attempt -lt 3) {
    $delaySeconds = [Math]::Pow(2, $Attempt + 1)
    Write-Host "Transient HTTP $statusCode; retrying in $delaySeconds second(s) ($($Attempt + 1)/3)..." -ForegroundColor Yellow
    Start-Sleep -Seconds $delaySeconds
    return Invoke-CurlJson $CurlArgs ($Attempt + 1)
  }

  if ($exitCode -ne 0 -or $statusCode -ge 400) {
    $responseText = if ([string]::IsNullOrWhiteSpace($body)) { "<empty response body>" } else { $body }
    throw "HTTP $statusCode from curl (exit $exitCode). Response: $responseText"
  }

  if ([string]::IsNullOrWhiteSpace($body)) {
    return $null
  }

  try {
    return $body | ConvertFrom-Json
  } catch {
    throw "Expected JSON but received HTTP $statusCode response: $($body.Substring(0, [Math]::Min(800, $body.Length)))"
  }
}

function New-JsonPayloadFile([string]$Json) {
  $path = Join-Path $env:TEMP "folio-smoke-json-$([guid]::NewGuid().ToString('N')).json"
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $Json, $utf8)
  return $path
}

function Get-HttpStatusOnly([string]$Url, [string]$CookieJar) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $status = (& curl.exe --silent --output NUL --write-out "%{http_code}" -c $CookieJar -b $CookieJar $Url)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($exitCode -ne 0) {
    throw "curl failed while checking status for $Url"
  }
  return $status
}

function Remove-TempFile([string]$Path) {
  if (-not [string]::IsNullOrWhiteSpace($Path)) {
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  }
}

function New-SampleReceiptPng([string]$Path) {
  Add-Type -AssemblyName System.Drawing
  $bitmap = New-Object System.Drawing.Bitmap 900, 1200
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $font = New-Object System.Drawing.Font("Consolas", 24)
  try {
    $graphics.Clear([System.Drawing.Color]::White)
    $lines = @(
      "FOLIO TEST SUPPLY",
      "100 MARKET STREET",
      "SAN ANTONIO TX 78205",
      "",
      "DATE 09/05/2026",
      "",
      "2  Office Paper        12.50     25.00",
      "1  Printer Ink        35.00     35.00",
      "",
      "SUBTOTAL                       60.00",
      "TAX                             4.95",
      "TOTAL                          64.95",
      "",
      "PAID VISA 4242",
      "THANK YOU"
    )
    $y = 70
    foreach ($line in $lines) {
      $graphics.DrawString($line, $font, [System.Drawing.Brushes]::Black, 55, $y)
      $y += 58
    }
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $font.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$cookieJar = Join-Path $env:TEMP "folio-smoke-cookies-$([guid]::NewGuid().ToString('N')).txt"
$generatedReceipt = $false
$firmId = $null
$ownerUserId = $null
$firmCId = $null
$clientPayloadPath = ""
$approvePayloadPath = ""
$bankDecisionPayloadPath = ""
$bankMappingPayloadPath = ""
$noReceiptDecisionPayloadPath = ""
$bankCsvPath = ""
$bankExceptionCsvPath = ""

try {
  if (-not $ReceiptPath) {
    $ReceiptPath = Join-Path $env:TEMP "folio-smoke-receipt-$([guid]::NewGuid().ToString('N')).png"
    New-SampleReceiptPng $ReceiptPath
    $generatedReceipt = $true
  }
  $ReceiptPath = (Resolve-Path $ReceiptPath).Path

  Write-Host "Checking production health..."
  $health = Invoke-CurlJson @("$BaseUrl/api/health")
  if (-not $health.ok -or $health.appDatabase -ne "neon-postgres" -or -not $health.workersAi) {
    throw "Health check is not production-ready: $($health | ConvertTo-Json -Compress)"
  }

  $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $runId = [guid]::NewGuid().ToString('N')
  $email = "folio-smoke-$runId@example.com"
  $password = "Smoke!$([guid]::NewGuid().ToString('N').Substring(0, 18))"

  Write-Host "Verifying public arbitrary account creation cannot obtain usable application access..."
  $publicSignupBody = @{ name = "Attacker"; email = "folio-smoke-attacker-$runId@example.com"; password = $password } | ConvertTo-Json -Compress
  $publicSignupPayloadPath = New-JsonPayloadFile $publicSignupBody
  $publicSignupStatus = ""
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $publicSignupStatus = (& curl.exe --silent --output NUL --write-out "%{http_code}" -H "Content-Type: application/json" -H "Origin: $BaseUrl" --data-binary "@$publicSignupPayloadPath" "$BaseUrl/api/auth/sign-up/email")
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  Remove-TempFile $publicSignupPayloadPath
  if ($publicSignupStatus -ne "403") {
    throw "Public registration must be closed (expected HTTP 403 from direct sign-up), got $publicSignupStatus."
  }

  Write-Host "Seeding a controlled smoke invitation via direct infrastructure access..."
  $seedResultRaw = & node (Join-Path $PSScriptRoot "smoke-admin.mjs") seed-invite $email 30
  if ($LASTEXITCODE -ne 0) { throw "Failed to seed the smoke invitation: $seedResultRaw" }
  $seedResult = ($seedResultRaw | Select-Object -Last 1) | ConvertFrom-Json
  $inviteToken = $seedResult.token
  if (-not $inviteToken) { throw "Smoke invitation seeding did not return a token." }

  Write-Host "Activating the invited smoke account (invitation redemption)..."
  $redeemBody = @{ token = $inviteToken; email = $email; password = $password; name = "Folio Smoke Test" } | ConvertTo-Json -Compress
  $redeemPayloadPath = New-JsonPayloadFile $redeemBody
  $null = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "-H", "Origin: $BaseUrl",
    "--data-binary", "@$redeemPayloadPath",
    "$BaseUrl/api/beta/redeem"
  )
  Remove-TempFile $redeemPayloadPath

  Write-Host "Verifying the Better Auth production session..."
  $me = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/me")
  if (-not $me.user.id) {
    throw "Better Auth did not establish a usable production session."
  }
  $firmId = [string]$me.firm.id
  $ownerUserId = [string]$me.user.id

  Write-Host "Verifying the beta access status endpoint reports an active entitlement..."
  $betaStatus = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/beta/status")
  if (-not $betaStatus.allowed) {
    throw "A freshly redeemed invitation must produce an active, allowed beta entitlement."
  }

  $clientBody = @{
    name = "Paid Alpha Smoke Client $stamp"
    legal_name = "Folio Smoke Test LLC"
    notes = "Automated end-to-end production verification."
  } | ConvertTo-Json -Compress
  $clientPayloadPath = New-JsonPayloadFile $clientBody

  Write-Host "Creating the smoke-test client..."
  $clientResponse = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "--data-binary", "@$clientPayloadPath",
    "$BaseUrl/api/clients"
  )
  $clientId = [string]$clientResponse.client.id
  if (-not $clientId) {
    throw "Client creation did not return an id."
  }

  Write-Host "Uploading receipt evidence and waiting for Workers AI extraction..."
  $upload = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-F", "file=@$ReceiptPath",
    "$BaseUrl/api/clients/$clientId/receipts"
  )
  $receiptId = [string]$upload.receipt.id
  if (-not $receiptId) {
    throw "Receipt upload did not return an extracted receipt."
  }

  $review = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/review")
  $receipt = @($review.receipts) | Where-Object { $_.id -eq $receiptId } | Select-Object -First 1
  if (-not $receipt) {
    throw "Extracted receipt did not appear in the review queue."
  }

  Write-Host "Provider: $($receipt.provider)"
  Write-Host "Model:    $($receipt.model)"
  Write-Host "Merchant: $($receipt.extracted_merchant)"
  Write-Host "Total:    $($receipt.extracted_total)"
  Write-Host "Lines:    $(@($receipt.lineItems).Count)"
  Write-Host "Validation: $($receipt.validation_status)"

  if ($receipt.validation_status -eq "fail") {
    Write-Host ""
    Write-Host "The pipeline reached professional review, but deterministic validation failed." -ForegroundColor Yellow
    @($receipt.validation_json.checks) | ForEach-Object {
      Write-Host "[$($_.status)] $($_.label): $($_.message)"
    }
    throw "Smoke test stopped before filing. Review the source evidence instead of overriding automatically."
  }

  Write-Host "Verifying the event-driven AI supervisor's completed and approval-gated work..."
  $receiptAgentTasks = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/agent-tasks")
  $intakeTask = @($receiptAgentTasks.tasks) | Where-Object { $_.source_id -eq $receiptId -and $_.agent_name -eq "intake_specialist" } | Select-Object -First 1
  $categoryTask = @($receiptAgentTasks.tasks) | Where-Object { $_.source_id -eq $receiptId -and $_.agent_name -eq "practice_coordinator" } | Select-Object -First 1
  if (-not $intakeTask -or $intakeTask.status -ne "completed" -or $intakeTask.autonomy -ne "autonomous") {
    throw "Receipt upload did not create the completed autonomous intake task."
  }
  if (-not $categoryTask -or $categoryTask.status -ne "awaiting_approval" -or $categoryTask.autonomy -ne "approval_required") {
    throw "Receipt categorization was not held for professional approval."
  }
  $agentApprovalBody = @{ action = "approve"; note = "Smoke test: professional reviewed recommendation" } | ConvertTo-Json -Compress
  $agentApprovalPayloadPath = New-JsonPayloadFile $agentApprovalBody
  $approvedAgentTask = Invoke-CurlJson @(
    "-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json",
    "-X", "PATCH", "--data-binary", "@$agentApprovalPayloadPath",
    "$BaseUrl/api/clients/$clientId/agent-tasks/$($categoryTask.id)"
  )
  Remove-TempFile $agentApprovalPayloadPath
  if ($approvedAgentTask.task.status -ne "approved") {
    throw "Professional approval of the agent recommendation was not persisted."
  }

  Write-Host "Filing the validated receipt..."
  $approveBody = @{ confirmOverride = $false } | ConvertTo-Json -Compress
  $approvePayloadPath = New-JsonPayloadFile $approveBody
  $filed = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "--data-binary", "@$approvePayloadPath",
    "$BaseUrl/api/clients/$clientId/receipts/$receiptId/approve"
  )
  if ($filed.receipt.status -ne "filed") {
    throw "Receipt approval did not move the receipt to filed status."
  }

  Write-Host "Verifying P&L reconciliation and source drill-down..."
  $pnl = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/pnl")
  $approvedTotal = [double]$filed.receipt.extracted_total
  $pnlExpenses = [double]$pnl.expenses
  if ([Math]::Abs($approvedTotal - $pnlExpenses) -gt 0.02) {
    throw "P&L does not reconcile. Receipt total is $approvedTotal but P&L expenses are $pnlExpenses."
  }

  $firstCategory = @($pnl.categorizedExpenses) | Select-Object -First 1
  if (-not $firstCategory) {
    throw "P&L returned no category rows."
  }
  $encodedCategory = [Uri]::EscapeDataString([string]$firstCategory.category)
  $drilldown = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "$BaseUrl/api/clients/$clientId/pnl/drilldown?category=$encodedCategory"
  )
  if (@($drilldown.entries).Count -lt 1) {
    throw "P&L drill-down returned no evidence entries."
  }

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $sourceStatus = (& curl.exe --silent --output NUL --write-out "%{http_code}" -c $cookieJar -b $cookieJar "$BaseUrl/api/clients/$clientId/receipts/$receiptId/source")
    $sourceExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($sourceExitCode -ne 0 -or $sourceStatus -ne "200") {
    throw "Source evidence endpoint failed with HTTP $sourceStatus."
  }

  Write-Host "Verifying bank CSV normalization, duplicate protection, and deterministic receipt matching..."
  $bankDate = [string]$filed.receipt.extracted_date
  if ([string]::IsNullOrWhiteSpace($bankDate)) {
    throw "Filed receipt has no extracted date for the bank reconciliation smoke test."
  }
  $bankDescription = [string]$filed.receipt.extracted_merchant
  if ([string]::IsNullOrWhiteSpace($bankDescription)) {
    $bankDescription = "FOLIO TEST SUPPLY"
  }
  $escapedDescription = '"' + $bankDescription.Replace('"', '""') + '"'
  $bankAmount = -1 * [Math]::Abs($approvedTotal)
  $bankAmountText = $bankAmount.ToString("0.00", [System.Globalization.CultureInfo]::InvariantCulture)
  $bankCsvPath = Join-Path $env:TEMP "folio-smoke-bank-$([guid]::NewGuid().ToString('N')).csv"
  $bankCsv = "Date,Description,Amount`r`n$bankDate,$escapedDescription,$bankAmountText`r`n"
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($bankCsvPath, $bankCsv, $utf8)

  $bankPreview = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-F", "file=@$bankCsvPath",
    "$BaseUrl/api/clients/$clientId/bank-transactions/preview"
  )
  if (-not $bankPreview.ready -or $bankPreview.rowCount -ne 1) {
    throw "Bank CSV preview did not auto-detect the expected mapping."
  }

  $bankMappingBody = @{ date = "Date"; description = "Description"; amount = "Amount" } | ConvertTo-Json -Compress
  $bankMappingPayloadPath = New-JsonPayloadFile $bankMappingBody
  $bankImport = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-F", "file=@$bankCsvPath",
    "-F", "mapping=<$bankMappingPayloadPath",
    "$BaseUrl/api/clients/$clientId/bank-transactions/import"
  )
  if ($bankImport.insertedCount -ne 1 -or $bankImport.duplicateCount -ne 0) {
    throw "Initial bank CSV import did not insert exactly one normalized transaction."
  }
  $bankAgentTasks = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/agent-tasks")
  $bankTriageTask = @($bankAgentTasks.tasks) | Where-Object { $_.source_id -eq $bankImport.importBatchId -and $_.agent_name -eq "reconciliation_specialist" } | Select-Object -First 1
  if (-not $bankTriageTask -or $bankTriageTask.status -ne "awaiting_approval" -or $bankTriageTask.autonomy -ne "approval_required") {
    throw "Bank import triage was not held for professional approval."
  }

  $duplicateImport = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-F", "file=@$bankCsvPath",
    "-F", "mapping=<$bankMappingPayloadPath",
    "$BaseUrl/api/clients/$clientId/bank-transactions/import"
  )
  if ($duplicateImport.insertedCount -ne 0 -or $duplicateImport.duplicateCount -ne 1) {
    throw "Bank CSV duplicate protection did not block the repeated transaction."
  }

  $bankQueue = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/bank-transactions")
  $bankTransaction = @($bankQueue.transactions) | Where-Object {
    [Math]::Abs([double]$_.amount - $bankAmount) -le 0.01
  } | Select-Object -First 1
  if (-not $bankTransaction) {
    throw "Normalized bank transaction was not persisted."
  }
  $bankTransactionId = [string]$bankTransaction.id
  if (-not $bankTransaction.suggestedReceipt -or $bankTransaction.suggestedReceipt.id -ne $receiptId) {
    throw "Deterministic reconciliation did not suggest the filed receipt."
  }
  if ($bankTransaction.triage -notin @("likely_match", "needs_review")) {
    throw "Suggested bank transaction did not enter an actionable review state."
  }

  Write-Host "Confirming the prepared bank-to-receipt relationship..."
  $bankDecisionBody = @{ action = "confirm" } | ConvertTo-Json -Compress
  $bankDecisionPayloadPath = New-JsonPayloadFile $bankDecisionBody
  $null = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "--data-binary", "@$bankDecisionPayloadPath",
    "$BaseUrl/api/clients/$clientId/bank-transactions/$bankTransactionId/decision"
  )

  $matchedQueue = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/bank-transactions")
  $matchedTransaction = @($matchedQueue.transactions) | Where-Object { $_.id -eq $bankTransactionId } | Select-Object -First 1
  if (-not $matchedTransaction -or $matchedTransaction.triage -ne "matched" -or $matchedTransaction.matchedReceipt.id -ne $receiptId) {
    throw "Confirmed bank reconciliation was not persisted."
  }

  $bankAudit = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "$BaseUrl/api/clients/$clientId/bank-transactions/$bankTransactionId/audit"
  )
  $confirmedAudit = @($bankAudit.events) | Where-Object { $_.action -eq "bank_match_confirmed" } | Select-Object -First 1
  if (-not $confirmedAudit -or $confirmedAudit.receipt_id -ne $receiptId) {
    throw "Confirmed bank reconciliation did not create the expected audit event."
  }

  Write-Host "Verifying bank exception inbox and missing receipt resolution..."
  $bankExceptionCsvPath = Join-Path $env:TEMP "folio-smoke-bank-exceptions-$([guid]::NewGuid().ToString('N')).csv"
  $exceptionCsv = "Date,Description,Amount`r`n2026-08-01,FOLIO MISSING RECEIPT SMOKE,$bankAmountText`r`n2026-08-02,FOLIO NO RECEIPT SMOKE,-11.11`r`n"
  [System.IO.File]::WriteAllText($bankExceptionCsvPath, $exceptionCsv, $utf8)

  $exceptionImport = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-F", "file=@$bankExceptionCsvPath",
    "-F", "mapping=<$bankMappingPayloadPath",
    "$BaseUrl/api/clients/$clientId/bank-transactions/import"
  )
  if ($exceptionImport.insertedCount -ne 2 -or $exceptionImport.duplicateCount -ne 0) {
    throw "Bank exception CSV did not insert both unmatched transactions."
  }

  $exceptionQueue = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/bank-transactions")
  $missingTransaction = @($exceptionQueue.transactions) | Where-Object { $_.description -eq "FOLIO MISSING RECEIPT SMOKE" } | Select-Object -First 1
  $noReceiptTransaction = @($exceptionQueue.transactions) | Where-Object { $_.description -eq "FOLIO NO RECEIPT SMOKE" } | Select-Object -First 1
  if (-not $missingTransaction -or $missingTransaction.triage -ne "unmatched") {
    throw "Missing receipt exception did not enter the unmatched queue."
  }
  if (-not $noReceiptTransaction -or $noReceiptTransaction.triage -ne "unmatched") {
    throw "No-receipt exception did not enter the unmatched queue."
  }

  $missingTransactionId = [string]$missingTransaction.id
  $noReceiptTransactionId = [string]$noReceiptTransaction.id

  Write-Host "Documenting a professional no-receipt-required resolution..."
  $noReceiptReason = "Smoke test documented non-receipt resolution"
  $noReceiptDecisionBody = @{ action = "no_receipt_required"; reason = $noReceiptReason } | ConvertTo-Json -Compress
  $noReceiptDecisionPayloadPath = New-JsonPayloadFile $noReceiptDecisionBody
  $null = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "--data-binary", "@$noReceiptDecisionPayloadPath",
    "$BaseUrl/api/clients/$clientId/bank-transactions/$noReceiptTransactionId/decision"
  )

  $afterNoReceiptQueue = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/bank-transactions")
  $resolvedNoReceipt = @($afterNoReceiptQueue.transactions) | Where-Object { $_.id -eq $noReceiptTransactionId } | Select-Object -First 1
  if (-not $resolvedNoReceipt -or $resolvedNoReceipt.triage -ne "no_receipt_required" -or $resolvedNoReceipt.resolutionReason -ne $noReceiptReason) {
    throw "No-receipt-required resolution was not persisted with its reason."
  }

  $noReceiptAudit = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "$BaseUrl/api/clients/$clientId/bank-transactions/$noReceiptTransactionId/audit"
  )
  if (-not (@($noReceiptAudit.events) | Where-Object { $_.action -eq "bank_no_receipt_required" } | Select-Object -First 1)) {
    throw "No-receipt-required resolution did not create an audit event."
  }

  Write-Host "Uploading missing receipt evidence directly from the bank exception..."
  $exceptionReceiptUpload = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-F", "file=@$ReceiptPath",
    "-F", "bankTransactionId=$missingTransactionId",
    "$BaseUrl/api/clients/$clientId/receipts"
  )
  $exceptionReceiptId = [string]$exceptionReceiptUpload.receipt.id
  if (-not $exceptionReceiptId) {
    throw "Bank exception receipt upload did not return a receipt id."
  }

  $pendingQueue = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/bank-transactions")
  $pendingTransaction = @($pendingQueue.transactions) | Where-Object { $_.id -eq $missingTransactionId } | Select-Object -First 1
  if (-not $pendingTransaction -or $pendingTransaction.triage -ne "receipt_pending" -or $pendingTransaction.pendingReceipt.id -ne $exceptionReceiptId) {
    throw "Uploaded missing receipt was not attached to the bank exception in pending review state."
  }

  $exceptionReview = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/review")
  $exceptionReceipt = @($exceptionReview.receipts) | Where-Object { $_.id -eq $exceptionReceiptId } | Select-Object -First 1
  if (-not $exceptionReceipt) {
    throw "Bank exception receipt did not appear in the review inbox."
  }
  if ($exceptionReceipt.validation_status -eq "fail") {
    throw "Bank exception receipt failed deterministic validation and cannot be filed automatically by the smoke test."
  }

  Write-Host "Filing the deliberately linked receipt and verifying automatic exception completion..."
  $exceptionFiled = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "--data-binary", "@$approvePayloadPath",
    "$BaseUrl/api/clients/$clientId/receipts/$exceptionReceiptId/approve"
  )
  if ($exceptionFiled.receipt.status -ne "filed") {
    throw "Bank exception receipt did not file successfully."
  }
  if ($missingTransactionId -notin @($exceptionFiled.resolvedBankTransactions)) {
    throw "Filing the deliberately linked receipt did not report the bank exception as resolved."
  }

  $finalBankQueue = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/bank-transactions")
  $resolvedMissing = @($finalBankQueue.transactions) | Where-Object { $_.id -eq $missingTransactionId } | Select-Object -First 1
  if (-not $resolvedMissing -or $resolvedMissing.triage -ne "matched" -or $resolvedMissing.matchedReceipt.id -ne $exceptionReceiptId) {
    throw "Missing receipt exception did not resolve to the newly filed source evidence."
  }
  if ($finalBankQueue.summary.actionCount -ne 0 -or $finalBankQueue.summary.matched -lt 2 -or $finalBankQueue.summary.noReceiptRequired -lt 1) {
    throw "Bank exception summary does not reflect the resolved smoke-test workload."
  }

  $missingAudit = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "$BaseUrl/api/clients/$clientId/bank-transactions/$missingTransactionId/audit"
  )
  # Receipt intake records this as a pending-review linkage.  That is the
  # intentional safety boundary: upload evidence may be automated, but it
  # cannot become an accounting match until a professional files it.
  $uploadedAudit = @($missingAudit.events) | Where-Object { $_.action -eq "bank_receipt_linked_pending_review" } | Select-Object -First 1
  $resolvedAudit = @($missingAudit.events) | Where-Object { $_.action -eq "bank_match_confirmed" } | Select-Object -Last 1
  if (-not $uploadedAudit -or -not $resolvedAudit -or $resolvedAudit.receipt_id -ne $exceptionReceiptId) {
    throw "Missing receipt workflow did not preserve the expected upload and confirmation audit history."
  }

  Write-Host "Fetching client categories for disposition and folder verification..."
  $categoryList = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/categories")
  $smokeCategory = @($categoryList.categories) | Where-Object { $_.slug -eq [string]$firstCategory.category -or $_.name -eq [string]$firstCategory.category } | Select-Object -First 1
  if (-not $smokeCategory) { $smokeCategory = @($categoryList.categories) | Select-Object -First 1 }
  if (-not $smokeCategory) { throw "No categories exist for the smoke-test client." }
  $smokeCategoryId = [string]$smokeCategory.id

  Write-Host "Classifying the deliberately no-receipt bank transaction as an explicit business expense..."
  $expenseDispositionBody = @{ disposition = "business_expense"; categoryId = $smokeCategoryId; note = "Smoke test explicit business expense classification" } | ConvertTo-Json -Compress
  $expenseDispositionPayloadPath = New-JsonPayloadFile $expenseDispositionBody
  $expenseDispositionResult = Invoke-CurlJson @(
    "-c", $cookieJar, "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "-X", "PATCH",
    "--data-binary", "@$expenseDispositionPayloadPath",
    "$BaseUrl/api/clients/$clientId/bank-transactions/$noReceiptTransactionId/disposition"
  )
  Remove-TempFile $expenseDispositionPayloadPath
  if ($expenseDispositionResult.transaction.disposition -ne "business_expense") {
    throw "Bank disposition PATCH did not persist business_expense."
  }

  $dispositionAudit = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/bank-transactions/$noReceiptTransactionId/audit")
  $dispositionAuditEvent = @($dispositionAudit.events) | Where-Object { $_.action -eq "bank_disposition_changed" } | Select-Object -First 1
  if (-not $dispositionAuditEvent -or -not $dispositionAuditEvent.before_json -or -not $dispositionAuditEvent.after_json) {
    throw "Bank disposition change did not create an audit event with before/after state."
  }

  # FOLIO NO RECEIPT SMOKE is dated 2026-08-02 earlier in this script.
  $noReceiptMonthStart = "2026-08-01"
  $noReceiptMonthEnd = "2026-08-31"

  Write-Host "Verifying the no-receipt business expense enters period-filtered P&L only after classification..."
  $pnlWithExpense = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/pnl?startDate=$noReceiptMonthStart&endDate=$noReceiptMonthEnd")
  $expenseCategoryRow = @($pnlWithExpense.categorizedExpenses) | Where-Object { $_.bankCount -gt 0 } | Select-Object -First 1
  if (-not $expenseCategoryRow) {
    throw "Explicitly classified no-receipt business expense did not appear in period-filtered P&L."
  }
  if ($pnlWithExpense.counts.noReceiptBusinessExpenses -lt 1) {
    throw "P&L counts did not reflect the classified no-receipt business expense."
  }

  Write-Host "Importing income and excluded-activity transactions in a different month..."
  $bookkeepingCsvPath = Join-Path $env:TEMP "folio-smoke-bookkeeping-$([guid]::NewGuid().ToString('N')).csv"
  $bookkeepingCsv = "Date,Description,Amount`r`n2026-09-10,FOLIO INCOME SMOKE,250.00`r`n2026-09-11,FOLIO PERSONAL SMOKE,-30.00`r`n"
  [System.IO.File]::WriteAllText($bookkeepingCsvPath, $bookkeepingCsv, $utf8)
  $bookkeepingImport = Invoke-CurlJson @(
    "-c", $cookieJar, "-b", $cookieJar,
    "-F", "file=@$bookkeepingCsvPath",
    "-F", "mapping=<$bankMappingPayloadPath",
    "$BaseUrl/api/clients/$clientId/bank-transactions/import"
  )
  if ($bookkeepingImport.insertedCount -ne 2) { throw "Income/excluded smoke CSV did not insert exactly two new transactions." }
  Remove-TempFile $bookkeepingCsvPath

  $bookkeepingQueue = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/bank-transactions")
  $incomeTxn = @($bookkeepingQueue.transactions) | Where-Object { $_.description -eq "FOLIO INCOME SMOKE" } | Select-Object -First 1
  $personalTxn = @($bookkeepingQueue.transactions) | Where-Object { $_.description -eq "FOLIO PERSONAL SMOKE" } | Select-Object -First 1
  if (-not $incomeTxn -or -not $personalTxn) { throw "Income/excluded smoke transactions were not persisted." }
  $incomeTxnId = [string]$incomeTxn.id
  $personalTxnId = [string]$personalTxn.id

  foreach ($id in @($incomeTxnId, $personalTxnId)) {
    $noReceiptBody = @{ action = "no_receipt_required"; reason = "Smoke test: no receipt applies to this cash movement" } | ConvertTo-Json -Compress
    $noReceiptPayloadPath = New-JsonPayloadFile $noReceiptBody
    $null = Invoke-CurlJson @(
      "-c", $cookieJar, "-b", $cookieJar,
      "-H", "Content-Type: application/json",
      "--data-binary", "@$noReceiptPayloadPath",
      "$BaseUrl/api/clients/$clientId/bank-transactions/$id/decision"
    )
    Remove-TempFile $noReceiptPayloadPath
  }

  Write-Host "Classifying one transaction as business income and one as excluded personal activity..."
  $incomeDispositionBody = @{ disposition = "business_income" } | ConvertTo-Json -Compress
  $incomeDispositionPayloadPath = New-JsonPayloadFile $incomeDispositionBody
  $null = Invoke-CurlJson @(
    "-c", $cookieJar, "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "-X", "PATCH",
    "--data-binary", "@$incomeDispositionPayloadPath",
    "$BaseUrl/api/clients/$clientId/bank-transactions/$incomeTxnId/disposition"
  )
  Remove-TempFile $incomeDispositionPayloadPath

  $personalDispositionBody = @{ disposition = "personal" } | ConvertTo-Json -Compress
  $personalDispositionPayloadPath = New-JsonPayloadFile $personalDispositionBody
  $null = Invoke-CurlJson @(
    "-c", $cookieJar, "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "-X", "PATCH",
    "--data-binary", "@$personalDispositionPayloadPath",
    "$BaseUrl/api/clients/$clientId/bank-transactions/$personalTxnId/disposition"
  )
  Remove-TempFile $personalDispositionPayloadPath

  Write-Host "Verifying business income appears and personal activity is excluded for September..."
  $pnlSeptember = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/pnl?startDate=2026-09-01&endDate=2026-09-30")
  if ([Math]::Abs([double]$pnlSeptember.income - 250.00) -gt 0.01) {
    throw "Confirmed business income did not reach period-filtered P&L. Found income $($pnlSeptember.income)."
  }
  if ($pnlSeptember.counts.businessIncomeTransactions -lt 1) {
    throw "P&L counts did not reflect the classified business income transaction."
  }
  $personalInExpenses = @($pnlSeptember.categorizedExpenses) | Where-Object { $_.total -eq 30.00 }
  if (@($personalInExpenses).Count -gt 0) {
    throw "Personal activity leaked into P&L expenses."
  }

  Write-Host "Verifying monthly and yearly P&L windows produce different totals..."
  $pnlAugustOnly = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/pnl?startDate=2026-08-01&endDate=2026-08-31")
  $pnlFullYear = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/pnl?startDate=2026-01-01&endDate=2026-12-31")
  if ([double]$pnlAugustOnly.income -eq [double]$pnlFullYear.income -and [double]$pnlFullYear.income -le 0) {
    throw "Yearly P&L did not include income recorded outside the August window."
  }
  if ([double]$pnlFullYear.income -lt [double]$pnlAugustOnly.income) {
    throw "A wider yearly window must not report less income than a narrower monthly window."
  }

  Write-Host "Verifying an unclassified/unresolved period is flagged incomplete..."
  $incompleteCsvPath = Join-Path $env:TEMP "folio-smoke-incomplete-$([guid]::NewGuid().ToString('N')).csv"
  $incompleteCsv = "Date,Description,Amount`r`n2026-09-20,FOLIO INCOMPLETE SMOKE,-5.00`r`n"
  [System.IO.File]::WriteAllText($incompleteCsvPath, $incompleteCsv, $utf8)
  $null = Invoke-CurlJson @(
    "-c", $cookieJar, "-b", $cookieJar,
    "-F", "file=@$incompleteCsvPath",
    "-F", "mapping=<$bankMappingPayloadPath",
    "$BaseUrl/api/clients/$clientId/bank-transactions/import"
  )
  Remove-TempFile $incompleteCsvPath
  $pnlIncomplete = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/pnl?startDate=2026-09-01&endDate=2026-09-30")
  if ($pnlIncomplete.completeness.isComplete) {
    throw "P&L must flag the period incomplete while an unclassified bank transaction exists in it."
  }
  if ($pnlIncomplete.completeness.unclassifiedCount -lt 1) {
    throw "P&L completeness did not count the unclassified transaction."
  }

  Write-Host "Verifying the evidence folder shows filed receipts, not unreviewed extraction..."
  $folderEvidence = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/categories/$smokeCategoryId/evidence")
  $folderReceiptMatch = @($folderEvidence.receipts) | Where-Object { $_.id -eq $receiptId } | Select-Object -First 1
  if (-not $folderReceiptMatch) {
    throw "Folder evidence did not include the filed receipt for its category."
  }
  if (-not $folderReceiptMatch.sourceUrl -or -not $folderReceiptMatch.filename) {
    throw "Folder evidence entries must carry filename and source link."
  }

  Write-Host "Verifying a receipt matched to a personal-disposition bank transaction is excluded from P&L (conflict handling)..."
  $pnlBeforeConflict = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/pnl")
  $conflictDispositionBody = @{ disposition = "personal" } | ConvertTo-Json -Compress
  $conflictDispositionPayloadPath = New-JsonPayloadFile $conflictDispositionBody
  $null = Invoke-CurlJson @(
    "-c", $cookieJar, "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "-X", "PATCH",
    "--data-binary", "@$conflictDispositionPayloadPath",
    "$BaseUrl/api/clients/$clientId/bank-transactions/$bankTransactionId/disposition"
  )
  Remove-TempFile $conflictDispositionPayloadPath
  $pnlAfterConflict = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/pnl")
  $expectedExpensesAfterExclusion = [double]$pnlBeforeConflict.expenses - $approvedTotal
  if ([Math]::Abs([double]$pnlAfterConflict.expenses - $expectedExpensesAfterExclusion) -gt 0.02) {
    throw "A filed receipt whose matched bank transaction is explicitly classified personal must be excluded from expenses. Expected $expectedExpensesAfterExclusion, got $($pnlAfterConflict.expenses)."
  }
  if ([int]$pnlAfterConflict.excludedFiledReceiptCount -lt 1) {
    throw "excludedFiledReceiptCount did not report the personal-disposition exclusion."
  }
  $excludedEntry = @($pnlAfterConflict.excludedFiledReceipts) | Where-Object { $_.receiptId -eq $receiptId } | Select-Object -First 1
  if (-not $excludedEntry -or $excludedEntry.bankTransactionId -ne $bankTransactionId -or $excludedEntry.bankDisposition -ne "personal" -or -not $excludedEntry.sourceUrl) {
    throw "excludedFiledReceipts did not surface the excluded receipt with its matched bank transaction and source link."
  }
  Write-Host "Verifying one receipt cannot be matched to a second bank transaction (409)..."
  $dupMatchCsvPath = Join-Path $env:TEMP "folio-smoke-dupmatch-$([guid]::NewGuid().ToString('N')).csv"
  $dupMatchCsv = "Date,Description,Amount`r`n2026-12-15,FOLIO DUPLICATE MATCH ATTEMPT SMOKE,-5.00`r`n"
  [System.IO.File]::WriteAllText($dupMatchCsvPath, $dupMatchCsv, $utf8)
  $dupMatchImport = Invoke-CurlJson @(
    "-c", $cookieJar, "-b", $cookieJar,
    "-F", "file=@$dupMatchCsvPath",
    "-F", "mapping=<$bankMappingPayloadPath",
    "$BaseUrl/api/clients/$clientId/bank-transactions/import"
  )
  if ($dupMatchImport.insertedCount -ne 1) { throw "Duplicate-match smoke CSV did not insert the probe transaction." }
  Remove-TempFile $dupMatchCsvPath

  $dupMatchQueue = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/bank-transactions")
  $dupMatchTxn = @($dupMatchQueue.transactions) | Where-Object { $_.description -eq "FOLIO DUPLICATE MATCH ATTEMPT SMOKE" } | Select-Object -First 1
  if (-not $dupMatchTxn) { throw "Duplicate-match probe transaction was not persisted." }

  $dupConfirmBody = @{ action = "confirm"; receiptId = $receiptId } | ConvertTo-Json -Compress
  $dupConfirmPayloadPath = New-JsonPayloadFile $dupConfirmBody
  $dupConfirmStatus = ""
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $dupConfirmStatus = (& curl.exe --silent --output NUL --write-out "%{http_code}" -c $cookieJar -b $cookieJar -H "Content-Type: application/json" --data-binary "@$dupConfirmPayloadPath" "$BaseUrl/api/clients/$clientId/bank-transactions/$([string]$dupMatchTxn.id)/decision")
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  Remove-TempFile $dupConfirmPayloadPath
  if ($dupConfirmStatus -ne "409") {
    throw "Confirming a receipt that is already matched to another bank transaction must return HTTP 409, got $dupConfirmStatus."
  }

  Write-Host "Verifying an already-matched receipt is excluded from future receipt-option suggestions..."
  $receiptOptions = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/bank-transactions/$([string]$dupMatchTxn.id)/receipt-options")
  if (@($receiptOptions.receipts) | Where-Object { $_.id -eq $receiptId }) {
    throw "An already-matched receipt must not be offered as a receipt-option suggestion for another bank transaction."
  }

  Write-Host "Verifying link_receipt also enforces cross-state receipt claim protection (409)..."
  $dupLinkBody = @{ action = "link_receipt"; receiptId = $receiptId } | ConvertTo-Json -Compress
  $dupLinkPayloadPath = New-JsonPayloadFile $dupLinkBody
  $dupLinkStatus = ""
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $dupLinkStatus = (& curl.exe --silent --output NUL --write-out "%{http_code}" -c $cookieJar -b $cookieJar -H "Content-Type: application/json" --data-binary "@$dupLinkPayloadPath" "$BaseUrl/api/clients/$clientId/bank-transactions/$([string]$dupMatchTxn.id)/decision")
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  Remove-TempFile $dupLinkPayloadPath
  if ($dupLinkStatus -ne "409") {
    throw "link_receipt on a receipt already claimed by another bank transaction must return HTTP 409, got $dupLinkStatus."
  }

  Write-Host "Verifying migration-repair audit history (if any) is retrievable through the normal History API..."
  $dupMatchAudit = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/bank-transactions/$([string]$dupMatchTxn.id)/audit")
  if ($null -eq $dupMatchAudit.events) {
    throw "The bank transaction audit endpoint did not return an events array."
  }


  Write-Host "Verifying signed accounting: a vendor refund reduces net expense rather than adding to it..."
  $refundCsvPath = Join-Path $env:TEMP "folio-smoke-refund-$([guid]::NewGuid().ToString('N')).csv"
  $refundCsv = "Date,Description,Amount`r`n2026-10-05,FOLIO REFUND SMOKE DEBIT,-100.00`r`n2026-10-06,FOLIO REFUND SMOKE CREDIT,20.00`r`n"
  [System.IO.File]::WriteAllText($refundCsvPath, $refundCsv, $utf8)
  $refundImport = Invoke-CurlJson @(
    "-c", $cookieJar, "-b", $cookieJar,
    "-F", "file=@$refundCsvPath",
    "-F", "mapping=<$bankMappingPayloadPath",
    "$BaseUrl/api/clients/$clientId/bank-transactions/import"
  )
  if ($refundImport.insertedCount -ne 2) { throw "Refund smoke CSV did not insert exactly two transactions." }
  Remove-TempFile $refundCsvPath

  $refundQueue = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/bank-transactions")
  $refundDebit = @($refundQueue.transactions) | Where-Object { $_.description -eq "FOLIO REFUND SMOKE DEBIT" } | Select-Object -First 1
  $refundCredit = @($refundQueue.transactions) | Where-Object { $_.description -eq "FOLIO REFUND SMOKE CREDIT" } | Select-Object -First 1
  if (-not $refundDebit -or -not $refundCredit) { throw "Refund smoke transactions were not persisted." }
  foreach ($id in @([string]$refundDebit.id, [string]$refundCredit.id)) {
    $noReceiptBody = @{ action = "no_receipt_required"; reason = "Smoke test refund/contra scenario" } | ConvertTo-Json -Compress
    $noReceiptPayloadPath = New-JsonPayloadFile $noReceiptBody
    $null = Invoke-CurlJson @(
      "-c", $cookieJar, "-b", $cookieJar,
      "-H", "Content-Type: application/json",
      "--data-binary", "@$noReceiptPayloadPath",
      "$BaseUrl/api/clients/$clientId/bank-transactions/$id/decision"
    )
    Remove-TempFile $noReceiptPayloadPath
    $expenseBody = @{ disposition = "business_expense"; categoryId = $smokeCategoryId } | ConvertTo-Json -Compress
    $expensePayloadPath = New-JsonPayloadFile $expenseBody
    $null = Invoke-CurlJson @(
      "-c", $cookieJar, "-b", $cookieJar,
      "-H", "Content-Type: application/json",
      "-X", "PATCH",
      "--data-binary", "@$expensePayloadPath",
      "$BaseUrl/api/clients/$clientId/bank-transactions/$id/disposition"
    )
    Remove-TempFile $expensePayloadPath
  }
  $pnlOctober = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/pnl?startDate=2026-10-01&endDate=2026-10-31")
  if ([Math]::Abs([double]$pnlOctober.expenses - 80.00) -gt 0.01) {
    throw "Signed accounting is broken: expected a -100 debit plus a 20 refund to net to 80.00 in expenses, got $($pnlOctober.expenses)."
  }

  Write-Host "Verifying signed accounting: an income reversal reduces net income rather than being ignored..."
  $reversalCsvPath = Join-Path $env:TEMP "folio-smoke-reversal-$([guid]::NewGuid().ToString('N')).csv"
  $reversalCsv = "Date,Description,Amount`r`n2026-11-05,FOLIO INCOME REVERSAL SMOKE CREDIT,1000.00`r`n2026-11-06,FOLIO INCOME REVERSAL SMOKE DEBIT,-100.00`r`n2026-11-07,FOLIO UNCATEGORIZED EXPENSE SMOKE,-7.00`r`n"
  [System.IO.File]::WriteAllText($reversalCsvPath, $reversalCsv, $utf8)
  $reversalImport = Invoke-CurlJson @(
    "-c", $cookieJar, "-b", $cookieJar,
    "-F", "file=@$reversalCsvPath",
    "-F", "mapping=<$bankMappingPayloadPath",
    "$BaseUrl/api/clients/$clientId/bank-transactions/import"
  )
  if ($reversalImport.insertedCount -ne 3) { throw "Income reversal smoke CSV did not insert exactly three transactions." }
  Remove-TempFile $reversalCsvPath

  $reversalQueue = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/bank-transactions")
  $reversalCredit = @($reversalQueue.transactions) | Where-Object { $_.description -eq "FOLIO INCOME REVERSAL SMOKE CREDIT" } | Select-Object -First 1
  $reversalDebit = @($reversalQueue.transactions) | Where-Object { $_.description -eq "FOLIO INCOME REVERSAL SMOKE DEBIT" } | Select-Object -First 1
  $uncategorizedExpense = @($reversalQueue.transactions) | Where-Object { $_.description -eq "FOLIO UNCATEGORIZED EXPENSE SMOKE" } | Select-Object -First 1
  if (-not $reversalCredit -or -not $reversalDebit -or -not $uncategorizedExpense) { throw "Income reversal/uncategorized smoke transactions were not persisted." }

  foreach ($id in @([string]$reversalCredit.id, [string]$reversalDebit.id, [string]$uncategorizedExpense.id)) {
    $noReceiptBody = @{ action = "no_receipt_required"; reason = "Smoke test income reversal / uncategorized scenario" } | ConvertTo-Json -Compress
    $noReceiptPayloadPath = New-JsonPayloadFile $noReceiptBody
    $null = Invoke-CurlJson @(
      "-c", $cookieJar, "-b", $cookieJar,
      "-H", "Content-Type: application/json",
      "--data-binary", "@$noReceiptPayloadPath",
      "$BaseUrl/api/clients/$clientId/bank-transactions/$id/decision"
    )
    Remove-TempFile $noReceiptPayloadPath
  }

  foreach ($id in @([string]$reversalCredit.id, [string]$reversalDebit.id)) {
    $incomeBody = @{ disposition = "business_income" } | ConvertTo-Json -Compress
    $incomePayloadPath = New-JsonPayloadFile $incomeBody
    $null = Invoke-CurlJson @(
      "-c", $cookieJar, "-b", $cookieJar,
      "-H", "Content-Type: application/json",
      "-X", "PATCH",
      "--data-binary", "@$incomePayloadPath",
      "$BaseUrl/api/clients/$clientId/bank-transactions/$id/disposition"
    )
    Remove-TempFile $incomePayloadPath
  }

  $uncategorizedExpenseBody = @{ disposition = "business_expense" } | ConvertTo-Json -Compress
  $uncategorizedExpensePayloadPath = New-JsonPayloadFile $uncategorizedExpenseBody
  $null = Invoke-CurlJson @(
    "-c", $cookieJar, "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "-X", "PATCH",
    "--data-binary", "@$uncategorizedExpensePayloadPath",
    "$BaseUrl/api/clients/$clientId/bank-transactions/$([string]$uncategorizedExpense.id)/disposition"
  )
  Remove-TempFile $uncategorizedExpensePayloadPath

  $pnlNovember = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/pnl?startDate=2026-11-01&endDate=2026-11-30")
  if ([Math]::Abs([double]$pnlNovember.income - 900.00) -gt 0.01) {
    throw "Signed accounting is broken: expected a +1000 credit plus a -100 reversal to net to 900.00 in income, got $($pnlNovember.income)."
  }
  if ($pnlNovember.completeness.uncategorizedCount -lt 1) {
    throw "P&L completeness did not flag the uncategorized business-expense bank transaction."
  }

  Write-Host "Verifying an income reversal shows a negative signed amount and negative reported contribution in drill-down..."
  $reversalDrilldownEncoded = [Uri]::EscapeDataString("Uncategorized")
  $reversalDrilldown = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/pnl/drilldown?type=income&category=$reversalDrilldownEncoded&startDate=2026-11-01&endDate=2026-11-30")
  $reversalDrilldownEntry = @($reversalDrilldown.entries) | Where-Object { $_.bankTransactionId -eq [string]$reversalDebit.id } | Select-Object -First 1
  if (-not $reversalDrilldownEntry -or [double]$reversalDrilldownEntry.amount -ge 0 -or [double]$reversalDrilldownEntry.reportedAmount -ge 0) {
    throw "An income reversal must show a negative signed amount and a negative reported contribution in drill-down."
  }

  Write-Host "Verifying invalid reporting dates are rejected with HTTP 400 rather than silently unbounded..."
  $badDateEncoded = [Uri]::EscapeDataString("foo")
  $invalidDateStatus = Get-HttpStatusOnly "$BaseUrl/api/clients/$clientId/pnl?startDate=$badDateEncoded" $cookieJar
  if ($invalidDateStatus -ne "400") { throw "A non-date startDate value must return HTTP 400, got $invalidDateStatus." }

  $invalidMonthStatus = Get-HttpStatusOnly "$BaseUrl/api/clients/$clientId/pnl?startDate=2026-13-01" $cookieJar
  if ($invalidMonthStatus -ne "400") { throw "An out-of-range month must return HTTP 400, got $invalidMonthStatus." }

  $invalidDayStatus = Get-HttpStatusOnly "$BaseUrl/api/clients/$clientId/pnl?startDate=2026-02-30" $cookieJar
  if ($invalidDayStatus -ne "400") { throw "A calendar-invalid day must return HTTP 400, got $invalidDayStatus." }

  $reversedRangeStatus = Get-HttpStatusOnly "$BaseUrl/api/clients/$clientId/pnl?startDate=2026-06-01&endDate=2026-01-01" $cookieJar
  if ($reversedRangeStatus -ne "400") { throw "startDate after endDate must return HTTP 400, got $reversedRangeStatus." }

  Write-Host "Verifying accrual-basis clients receive an explicit guardrail instead of a cash-derived P&L..."
  $accrualProfileBody = @{ accounting_basis = "accrual" } | ConvertTo-Json -Compress
  $accrualProfilePayloadPath = New-JsonPayloadFile $accrualProfileBody
  $null = Invoke-CurlJson @(
    "-c", $cookieJar, "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "-X", "PATCH",
    "--data-binary", "@$accrualProfilePayloadPath",
    "$BaseUrl/api/clients/$clientId/profile"
  )
  Remove-TempFile $accrualProfilePayloadPath
  $pnlAccrual = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/pnl")
  if ($pnlAccrual.accrualSupported -ne $false -or -not $pnlAccrual.warning) {
    throw "An accrual-basis client must receive an explicit unsupported warning, not a cash-derived P&L."
  }
  if (($pnlAccrual.PSObject.Properties.Name -contains "income") -or ($pnlAccrual.PSObject.Properties.Name -contains "expenses")) {
    throw "An accrual-basis client must never receive cash-derived income/expense figures presented as accrual."
  }

  $cashProfileBody = @{ accounting_basis = "cash" } | ConvertTo-Json -Compress
  $cashProfilePayloadPath = New-JsonPayloadFile $cashProfileBody
  $null = Invoke-CurlJson @(
    "-c", $cookieJar, "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "-X", "PATCH",
    "--data-binary", "@$cashProfilePayloadPath",
    "$BaseUrl/api/clients/$clientId/profile"
  )
  Remove-TempFile $cashProfilePayloadPath


  Write-Host "Verifying income category drill-down returns the underlying bank transaction..."
  $incomeDrilldownEncoded = [Uri]::EscapeDataString("Uncategorized")
  $incomeDrilldown = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/pnl/drilldown?type=income&category=$incomeDrilldownEncoded&startDate=2026-09-01&endDate=2026-09-30")
  if ($incomeDrilldown.type -ne "income") { throw "Income drilldown did not return type=income." }
  $incomeDrilldownEntry = @($incomeDrilldown.entries) | Where-Object { $_.bankTransactionId -eq $incomeTxnId } | Select-Object -First 1
  if (-not $incomeDrilldownEntry -or [double]$incomeDrilldownEntry.reportedAmount -le 0) {
    throw "Income drill-down did not surface the classified business income transaction with a reported amount."
  }
  if ([double]$incomeDrilldownEntry.amount -ne [double]$incomeDrilldownEntry.reportedAmount) {
    throw "Income drill-down signed bank amount must equal the reported amount for a normal (non-reversed) income transaction."
  }
  if (-not $incomeDrilldownEntry.sourceFilename) {
    throw "Income drill-down did not surface the source CSV filename."
  }
  if ($null -eq $incomeDrilldownEntry.sourceRow) {
    throw "Income drill-down did not surface the original CSV source row number."
  }
  if (-not $incomeDrilldownEntry.importBatchId) {
    throw "Income drill-down did not surface the import batch id."
  }
  if (-not $incomeDrilldownEntry.originalRow) {
    throw "Income drill-down did not preserve the original imported bank row for source traceability."
  }

  Write-Host "Verifying foreign-currency completeness: an unclassified EUR transaction cannot disappear from the report..."
  $eurCsvPath = Join-Path $env:TEMP "folio-smoke-eur-$([guid]::NewGuid().ToString('N')).csv"
  $eurCsv = "Date,Description,Amount,Currency`r`n2026-12-05,FOLIO EUR UNCLASSIFIED SMOKE,-42.00,EUR`r`n"
  [System.IO.File]::WriteAllText($eurCsvPath, $eurCsv, $utf8)
  $eurMappingBody = @{ date = "Date"; description = "Description"; amount = "Amount"; currency = "Currency" } | ConvertTo-Json -Compress
  $eurMappingPayloadPath = New-JsonPayloadFile $eurMappingBody
  $eurImport = Invoke-CurlJson @(
    "-c", $cookieJar, "-b", $cookieJar,
    "-F", "file=@$eurCsvPath",
    "-F", "mapping=<$eurMappingPayloadPath",
    "$BaseUrl/api/clients/$clientId/bank-transactions/import"
  )
  if ($eurImport.insertedCount -ne 1) { throw "Foreign-currency smoke CSV did not insert the EUR transaction." }
  Remove-TempFile $eurCsvPath

  $pnlDecemberUnclassified = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/pnl?startDate=2026-12-01&endDate=2026-12-31")
  if ($pnlDecemberUnclassified.completeness.unclassifiedCount -lt 1) {
    throw "An unclassified foreign-currency transaction disappeared from unclassifiedCount instead of blocking completeness."
  }
  if ($pnlDecemberUnclassified.completeness.isComplete) {
    throw "A period with an unclassified foreign-currency transaction must not report complete."
  }

  $eurQueue = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/bank-transactions")
  $eurTxn = @($eurQueue.transactions) | Where-Object { $_.description -eq "FOLIO EUR UNCLASSIFIED SMOKE" } | Select-Object -First 1
  if (-not $eurTxn) { throw "EUR smoke transaction was not persisted." }
  $eurNoReceiptBody = @{ action = "no_receipt_required"; reason = "Smoke test foreign-currency scenario" } | ConvertTo-Json -Compress
  $eurNoReceiptPayloadPath = New-JsonPayloadFile $eurNoReceiptBody
  $null = Invoke-CurlJson @(
    "-c", $cookieJar, "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "--data-binary", "@$eurNoReceiptPayloadPath",
    "$BaseUrl/api/clients/$clientId/bank-transactions/$([string]$eurTxn.id)/decision"
  )
  Remove-TempFile $eurNoReceiptPayloadPath
  $eurExpenseBody = @{ disposition = "business_expense"; categoryId = $smokeCategoryId } | ConvertTo-Json -Compress
  $eurExpensePayloadPath = New-JsonPayloadFile $eurExpenseBody
  $null = Invoke-CurlJson @(
    "-c", $cookieJar, "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "-X", "PATCH",
    "--data-binary", "@$eurExpensePayloadPath",
    "$BaseUrl/api/clients/$clientId/bank-transactions/$([string]$eurTxn.id)/disposition"
  )
  Remove-TempFile $eurExpensePayloadPath

  $pnlDecemberClassified = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/pnl?startDate=2026-12-01&endDate=2026-12-31")
  if ($pnlDecemberClassified.completeness.currencyConflictCount -lt 1) {
    throw "An explicitly classified foreign-currency business transaction did not create a currency conflict."
  }
  if ([double]$pnlDecemberClassified.expenses -ne 0) {
    throw "A foreign-currency business expense must be excluded from operating totals, not silently summed in."
  }

  Write-Host "Verifying client currency is normalized to canonical uppercase..."
  $lowercaseCurrencyBody = @{ default_currency = "usd" } | ConvertTo-Json -Compress
  $lowercaseCurrencyPayloadPath = New-JsonPayloadFile $lowercaseCurrencyBody
  $normalizedProfile = Invoke-CurlJson @(
    "-c", $cookieJar, "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "-X", "PATCH",
    "--data-binary", "@$lowercaseCurrencyPayloadPath",
    "$BaseUrl/api/clients/$clientId/profile"
  )
  Remove-TempFile $lowercaseCurrencyPayloadPath
  if ($normalizedProfile.profile.default_currency -ne "USD") {
    throw "Lowercase default_currency input was not normalized to uppercase, got $($normalizedProfile.profile.default_currency)."
  }

  $invalidCurrencyBody = @{ default_currency = "US1" } | ConvertTo-Json -Compress
  $invalidCurrencyPayloadPath = New-JsonPayloadFile $invalidCurrencyBody
  $invalidCurrencyStatus = ""
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $invalidCurrencyStatus = (& curl.exe --silent --output NUL --write-out "%{http_code}" -c $cookieJar -b $cookieJar -H "Content-Type: application/json" -X PATCH --data-binary "@$invalidCurrencyPayloadPath" "$BaseUrl/api/clients/$clientId/profile")
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  Remove-TempFile $invalidCurrencyPayloadPath
  if ($invalidCurrencyStatus -ne "400") {
    throw "An invalid default_currency value must be rejected with HTTP 400, got $invalidCurrencyStatus."
  }

  Write-Host "Verifying duplicate category names are rejected case-insensitively..."
  $duplicateCategoryName = "Smoke Duplicate Category $stamp"
  $firstCategoryBody = @{ name = $duplicateCategoryName } | ConvertTo-Json -Compress
  $firstCategoryPayloadPath = New-JsonPayloadFile $firstCategoryBody
  $null = Invoke-CurlJson @(
    "-c", $cookieJar, "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "--data-binary", "@$firstCategoryPayloadPath",
    "$BaseUrl/api/clients/$clientId/categories"
  )
  Remove-TempFile $firstCategoryPayloadPath

  $duplicateCategoryBody = @{ name = $duplicateCategoryName.ToLowerInvariant() } | ConvertTo-Json -Compress
  $duplicateCategoryPayloadPath = New-JsonPayloadFile $duplicateCategoryBody
  $duplicateCategoryStatus = ""
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $duplicateCategoryStatus = (& curl.exe --silent --output NUL --write-out "%{http_code}" -c $cookieJar -b $cookieJar -H "Content-Type: application/json" --data-binary "@$duplicateCategoryPayloadPath" "$BaseUrl/api/clients/$clientId/categories")
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  Remove-TempFile $duplicateCategoryPayloadPath
  if ($duplicateCategoryStatus -ne "409") {
    throw "A case-insensitive duplicate category name must be rejected with HTTP 409, got $duplicateCategoryStatus."
  }

    Write-Host "Verifying professional export center data reconciles to the canonical P&L..."
  $exportPnl = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/pnl")
  $exportPreview = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/export/preview")
  if ([double]$exportPreview.income -ne [double]$exportPnl.income) {
    throw "Export preview income $($exportPreview.income) does not reconcile to canonical P&L income $($exportPnl.income)."
  }
  if ([double]$exportPreview.expenses -ne [double]$exportPnl.expenses) {
    throw "Export preview expenses $($exportPreview.expenses) does not reconcile to canonical P&L expenses $($exportPnl.expenses)."
  }
  if ([double]$exportPreview.net -ne [double]$exportPnl.net) {
    throw "Export preview net $($exportPreview.net) does not reconcile to canonical P&L net $($exportPnl.net)."
  }

  Write-Host "Downloading the professional Excel workbook and verifying the reconciled totals arrive as a real .xlsx file..."
  $workbookPath = Join-Path $env:TEMP "folio-smoke-workbook-$([guid]::NewGuid().ToString('N')).xlsx"
  $workbookHeadersPath = Join-Path $env:TEMP "folio-smoke-workbook-headers-$([guid]::NewGuid().ToString('N')).txt"
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $workbookStatus = (& curl.exe --silent --output $workbookPath --dump-header $workbookHeadersPath --write-out "%{http_code}" -c $cookieJar -b $cookieJar "$BaseUrl/api/clients/$clientId/export/workbook")
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($workbookStatus -ne "200") { throw "Workbook download returned HTTP $workbookStatus." }
  $workbookHeaders = Get-Content $workbookHeadersPath -Raw
  if ($workbookHeaders -notmatch "spreadsheetml") { throw "Workbook download did not report an .xlsx content type." }
  if ($workbookHeaders -notmatch "attachment") { throw "Workbook download did not set a Content-Disposition attachment filename." }
  $workbookBytes = (Get-Item $workbookPath).Length
  if ($workbookBytes -lt 1000) { throw "Workbook download was implausibly small ($workbookBytes bytes)." }
  Remove-TempFile $workbookPath
  Remove-TempFile $workbookHeadersPath

  Write-Host "Verifying the excluded EUR/personal activity is present in export data but absent from operating P&L income/expenses composition..."
  $exportPreviewExcludedCount = [int]$exportPreview.excludedTransactions
  if ($exportPreviewExcludedCount -lt 1) { throw "Expected at least one excluded/nonbusiness transaction in the export preview, found $exportPreviewExcludedCount." }
  if ([int]$exportPreview.completeness.currencyConflictCount -lt 1) {
    throw "Expected the EUR smoke transaction to register as a currency conflict in export completeness."
  }
  if ([int]$exportPreview.openItemsCount -lt 1) { throw "Expected at least one open item in the export preview." }

  Write-Host "Verifying source/import-batch isolation: distinct CSV uploads remain distinct batches..."
  $importBatches = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/export/import-batches")
  $batchList = @($importBatches.batches)
  if ($batchList.Count -lt 2) { throw "Expected at least two distinct import-batch groupings, found $($batchList.Count)." }

  $usdBatches = @($batchList | Where-Object { $_.currency -eq "USD" })
  if ($usdBatches.Count -lt 2) { throw "Expected at least two distinct USD import batches from the smoke run's separate CSV uploads." }

  $singleBatch = $usdBatches[0]
  $encodedBatchId = [Uri]::EscapeDataString([string]$singleBatch.importBatchId)
  $bankCsvPath = Join-Path $env:TEMP "folio-smoke-bank-$([guid]::NewGuid().ToString('N')).csv"
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $bankCsvStatus = (& curl.exe --silent --output $bankCsvPath --write-out "%{http_code}" -c $cookieJar -b $cookieJar "$BaseUrl/api/clients/$clientId/export/bank-transactions-csv?importBatchId=$encodedBatchId&currency=USD")
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($bankCsvStatus -ne "200") { throw "Single-batch bank transactions CSV download returned HTTP $bankCsvStatus." }
  $bankCsvLines = @(Get-Content $bankCsvPath)
  if ($bankCsvLines[0] -ne "Date,Description,Amount") {
    throw "Bank transactions CSV header must be exactly 'Date,Description,Amount', got '$($bankCsvLines[0])'."
  }
  $expectedRowCount = [int]$singleBatch.transactionCount
  $actualRowCount = $bankCsvLines.Count - 1
  if ($actualRowCount -ne $expectedRowCount) {
    throw "Bank transactions CSV row count $actualRowCount does not reconcile to the selected batch's $expectedRowCount transactions."
  }
  Remove-TempFile $bankCsvPath

  Write-Host "Verifying the bank transactions CSV refuses to silently merge two distinct USD import batches..."
  $mixedBatchStatus = ""
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $mixedBatchStatus = (& curl.exe --silent --output NUL --write-out "%{http_code}" -c $cookieJar -b $cookieJar "$BaseUrl/api/clients/$clientId/export/bank-transactions-csv?currency=USD")
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($mixedBatchStatus -ne "400") {
    throw "Requesting a bank transactions CSV across multiple USD import batches without selecting one must return HTTP 400, got $mixedBatchStatus."
  }

  Write-Host "Creating a fully resolved dashboard client (Client A) with no open work..."
  $clientABody = @{ name = "Smoke Dashboard Ready $stamp"; legal_name = "Smoke Dashboard Ready LLC" } | ConvertTo-Json -Compress
  $clientAPayloadPath = New-JsonPayloadFile $clientABody
  $clientAResponse = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "--data-binary", "@$clientAPayloadPath", "$BaseUrl/api/clients")
  Remove-TempFile $clientAPayloadPath
  $clientAId = [string]$clientAResponse.client.id
  if (-not $clientAId) { throw "Dashboard Client A creation did not return an id." }

  $clientACategories = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientAId/categories")
  $clientACategoryId = [string](@($clientACategories.categories) | Select-Object -First 1).id
  if (-not $clientACategoryId) { throw "Dashboard Client A has no default categories to classify against." }

  $clientACsvPath = Join-Path $env:TEMP "folio-smoke-dashboard-a-$([guid]::NewGuid().ToString('N')).csv"
  $clientACsv = "Date,Description,Amount`r`n2026-05-01,FOLIO DASHBOARD READY SMOKE,-40.00`r`n"
  [System.IO.File]::WriteAllText($clientACsvPath, $clientACsv, $utf8)
  $clientAMappingBody = @{ date = "Date"; description = "Description"; amount = "Amount" } | ConvertTo-Json -Compress
  $clientAMappingPayloadPath = New-JsonPayloadFile $clientAMappingBody
  $clientAImport = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-F", "file=@$clientACsvPath", "-F", "mapping=<$clientAMappingPayloadPath", "$BaseUrl/api/clients/$clientAId/bank-transactions/import")
  if ($clientAImport.insertedCount -ne 1) { throw "Dashboard Client A bank CSV did not insert exactly one transaction." }
  Remove-TempFile $clientACsvPath

  $clientATxns = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientAId/bank-transactions")
  $clientATxn = @($clientATxns.transactions) | Where-Object { $_.description -eq "FOLIO DASHBOARD READY SMOKE" } | Select-Object -First 1
  if (-not $clientATxn) { throw "Dashboard Client A transaction was not persisted." }
  $clientATxnId = [string]$clientATxn.id

  $clientANoReceiptBody = @{ action = "no_receipt_required"; reason = "Smoke test: dashboard ready client" } | ConvertTo-Json -Compress
  $clientANoReceiptPayloadPath = New-JsonPayloadFile $clientANoReceiptBody
  $null = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "--data-binary", "@$clientANoReceiptPayloadPath", "$BaseUrl/api/clients/$clientAId/bank-transactions/$clientATxnId/decision")
  Remove-TempFile $clientANoReceiptPayloadPath

  $clientAExpenseBody = @{ disposition = "business_expense"; categoryId = $clientACategoryId; note = "Smoke test: dashboard ready" } | ConvertTo-Json -Compress
  $clientAExpensePayloadPath = New-JsonPayloadFile $clientAExpenseBody
  $null = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "-X", "PATCH", "--data-binary", "@$clientAExpensePayloadPath", "$BaseUrl/api/clients/$clientAId/bank-transactions/$clientATxnId/disposition")
  Remove-TempFile $clientAExpensePayloadPath

  Write-Host "Creating an unresolved dashboard client (Client B) with open work..."
  $clientBBody = @{ name = "Smoke Dashboard Attention $stamp"; legal_name = "Smoke Dashboard Attention LLC" } | ConvertTo-Json -Compress
  $clientBPayloadPath = New-JsonPayloadFile $clientBBody
  $clientBResponse = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "--data-binary", "@$clientBPayloadPath", "$BaseUrl/api/clients")
  Remove-TempFile $clientBPayloadPath
  $clientBId = [string]$clientBResponse.client.id
  if (-not $clientBId) { throw "Dashboard Client B creation did not return an id." }

  $clientBCsvPath = Join-Path $env:TEMP "folio-smoke-dashboard-b-$([guid]::NewGuid().ToString('N')).csv"
  $clientBCsv = "Date,Description,Amount`r`n2026-05-02,FOLIO DASHBOARD ATTENTION SMOKE,-75.00`r`n"
  [System.IO.File]::WriteAllText($clientBCsvPath, $clientBCsv, $utf8)
  $clientBImport = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-F", "file=@$clientBCsvPath", "-F", "mapping=<$clientAMappingPayloadPath", "$BaseUrl/api/clients/$clientBId/bank-transactions/import")
  if ($clientBImport.insertedCount -ne 1) { throw "Dashboard Client B bank CSV did not insert exactly one transaction." }
  Remove-TempFile $clientBCsvPath
  Remove-TempFile $clientAMappingPayloadPath

  $clientBTxns = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientBId/bank-transactions")
  $clientBTxn = @($clientBTxns.transactions) | Where-Object { $_.description -eq "FOLIO DASHBOARD ATTENTION SMOKE" } | Select-Object -First 1
  if (-not $clientBTxn) { throw "Dashboard Client B transaction was not persisted." }
  $clientBTxnId = [string]$clientBTxn.id
  # Deliberately left unclassified and unmatched (triage=unmatched, disposition=unclassified).

  Write-Host "Verifying the firm-wide operations dashboard reflects both clients correctly..."
  $dashboard = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/dashboard")
  $allClients = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients")
  if ([int]$dashboard.summary.clients -ne @($allClients.clients).Count) {
    throw "Dashboard client count $($dashboard.summary.clients) does not reconcile to the firm's actual client count $(@($allClients.clients).Count)."
  }

  $dashClientA = @($dashboard.clients) | Where-Object { $_.id -eq $clientAId } | Select-Object -First 1
  $dashClientB = @($dashboard.clients) | Where-Object { $_.id -eq $clientBId } | Select-Object -First 1
  if (-not $dashClientA -or -not $dashClientB) {
    throw "Dashboard did not return both newly created clients."
  }
  if ($dashClientA.readiness -ne "ready") {
    throw "Fully resolved Client A should be Ready on the dashboard, got '$($dashClientA.readiness)'."
  }
  if ($dashClientB.readiness -eq "ready") {
    throw "Client B has unresolved bank activity and must not be Ready on the dashboard."
  }
  if ($dashClientB.missingEvidenceCount -lt 1) {
    throw "Client B's unmatched bank transaction should count as missing evidence, got $($dashClientB.missingEvidenceCount)."
  }

  $clientBAction = @($dashboard.actions) | Where-Object { $_.clientId -eq $clientBId -and $_.sourceEntityId -eq $clientBTxnId } | Select-Object -First 1
  if (-not $clientBAction) {
    throw "The global action queue did not surface Client B's open bank transaction."
  }
  $expectedDeepLink = "/clients/${clientBId}?tab=bank&focus=${clientBTxnId}"
  if ($clientBAction.deepLink -ne $expectedDeepLink) {
    throw "Client B's action deep link '$($clientBAction.deepLink)' did not match the expected exact destination '$expectedDeepLink'."
  }
  $clientAActions = @($dashboard.actions) | Where-Object { $_.clientId -eq $clientAId }
  if (@($clientAActions).Count -ne 0) {
    throw "Fully resolved Client A must have zero open actions on the dashboard."
  }

  Write-Host "Resolving Client B so the dashboard action disappears once the work is done..."
  $clientBCategories = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientBId/categories")
  $clientBFixCategoryId = [string](@($clientBCategories.categories) | Select-Object -First 1).id
  if (-not $clientBFixCategoryId) { throw "Dashboard Client B has no default categories to classify against." }
  $clientBNoReceiptBody = @{ action = "no_receipt_required"; reason = "Smoke test: resolving dashboard attention client" } | ConvertTo-Json -Compress
  $clientBNoReceiptPayloadPath = New-JsonPayloadFile $clientBNoReceiptBody
  $null = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "--data-binary", "@$clientBNoReceiptPayloadPath", "$BaseUrl/api/clients/$clientBId/bank-transactions/$clientBTxnId/decision")
  Remove-TempFile $clientBNoReceiptPayloadPath
  $clientBFixBody = @{ disposition = "business_expense"; categoryId = $clientBFixCategoryId; note = "Smoke test: resolved" } | ConvertTo-Json -Compress
  $clientBFixPayloadPath = New-JsonPayloadFile $clientBFixBody
  $null = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "-X", "PATCH", "--data-binary", "@$clientBFixPayloadPath", "$BaseUrl/api/clients/$clientBId/bank-transactions/$clientBTxnId/disposition")
  Remove-TempFile $clientBFixPayloadPath

  $dashboardAfterFix = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/dashboard")
  $residualClientBAction = @($dashboardAfterFix.actions) | Where-Object { $_.sourceEntityId -eq $clientBTxnId } | Select-Object -First 1
  if ($residualClientBAction) {
    throw "Resolving Client B's transaction should remove its dashboard action, but it is still present."
  }
  $dashClientBAfterFix = @($dashboardAfterFix.clients) | Where-Object { $_.id -eq $clientBId } | Select-Object -First 1
  if (-not $dashClientBAfterFix -or $dashClientBAfterFix.readiness -ne "ready") {
    throw "Client B should be Ready after its only open item was resolved, got '$($dashClientBAfterFix.readiness)'."
  }

  Write-Host "Setting up Client A tax readiness: profile, checklist generation, document confirmation..."
  $clientAProfileBody = @{ entity_type = "llc"; tax_year = 2026; profile = @{ taxPrepRequired = $true; priorYearReturnAvailable = $true } } | ConvertTo-Json -Compress
  $clientAProfilePayloadPath = New-JsonPayloadFile $clientAProfileBody
  $null = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "-X", "PATCH", "--data-binary", "@$clientAProfilePayloadPath", "$BaseUrl/api/clients/$clientAId/profile")
  Remove-TempFile $clientAProfilePayloadPath

  $clientAChecklistGen = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-X", "POST", "$BaseUrl/api/clients/$clientAId/tax-readiness/2026/checklist/generate")
  if ([int]$clientAChecklistGen.added -lt 1) { throw "Client A checklist generation added no items." }

  $clientAReadiness = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientAId/tax-readiness/2026")
  if ($clientAReadiness.suggestedStatus -ne "collecting_documents") {
    throw "Client A with resolved bookkeeping and an unfulfilled checklist should suggest collecting_documents, got '$($clientAReadiness.suggestedStatus)'."
  }
  $clientAChecklistItem = @($clientAReadiness.checklist) | Where-Object { $_.doc_type -eq "prior_year_return" } | Select-Object -First 1
  if (-not $clientAChecklistItem) { throw "Client A checklist did not include a prior-year-return item." }

  Write-Host "Uploading and confirming a document that matches Client A's checklist item..."
  $clientADocPath = Join-Path $env:TEMP "folio-smoke-doc-a-$([guid]::NewGuid().ToString('N')).pdf"
  [System.IO.File]::WriteAllText($clientADocPath, "Folio smoke test prior-year return fixture", $utf8)
  $clientADocUpload = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-F", "file=@$clientADocPath;type=application/pdf", "-F", "taxYear=2026", "$BaseUrl/api/clients/$clientAId/documents")
  Remove-TempFile $clientADocPath
  $clientADocId = [string]$clientADocUpload.id
  if (-not $clientADocId) { throw "Client A document upload did not return an id." }

  $clientAMatchBody = @{ action = "match_checklist"; checklistItemId = $clientAChecklistItem.id } | ConvertTo-Json -Compress
  $clientAMatchPayloadPath = New-JsonPayloadFile $clientAMatchBody
  $null = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "-X", "PATCH", "--data-binary", "@$clientAMatchPayloadPath", "$BaseUrl/api/clients/$clientAId/documents/$clientADocId")
  Remove-TempFile $clientAMatchPayloadPath

  $clientAReadinessAfter = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientAId/tax-readiness/2026")
  $clientAChecklistItemAfter = @($clientAReadinessAfter.checklist) | Where-Object { $_.id -eq $clientAChecklistItem.id } | Select-Object -First 1
  if ($clientAChecklistItemAfter.status -ne "received") {
    throw "Matching a document to Client A's checklist item should mark it received, got '$($clientAChecklistItemAfter.status)'."
  }

  Write-Host "Advancing Client A tax readiness to professional_review explicitly (professional-controlled, never automatic)..."
  $clientAReadySetBody = @{ status = "professional_review" } | ConvertTo-Json -Compress
  $clientAReadySetPayloadPath = New-JsonPayloadFile $clientAReadySetBody
  $null = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "-X", "PUT", "--data-binary", "@$clientAReadySetPayloadPath", "$BaseUrl/api/clients/$clientAId/tax-readiness/2026")
  Remove-TempFile $clientAReadySetPayloadPath
  $clientAReadinessFinal = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientAId/tax-readiness/2026")
  if ($clientAReadinessFinal.status -ne "professional_review") {
    throw "Client A tax readiness status did not persist the professional's explicit choice."
  }

  Write-Host "Setting up Client B missing-document and document-review scenario..."
  $clientBProfileBody = @{ entity_type = "llc"; tax_year = 2026; profile = @{ taxPrepRequired = $true } } | ConvertTo-Json -Compress
  $clientBProfilePayloadPath = New-JsonPayloadFile $clientBProfileBody
  $null = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "-X", "PATCH", "--data-binary", "@$clientBProfilePayloadPath", "$BaseUrl/api/clients/$clientBId/profile")
  Remove-TempFile $clientBProfilePayloadPath

  $clientBChecklistGen = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-X", "POST", "$BaseUrl/api/clients/$clientBId/tax-readiness/2026/checklist/generate")
  if ([int]$clientBChecklistGen.added -lt 1) { throw "Client B checklist generation added no items." }

  $clientBDocPath = Join-Path $env:TEMP "folio-smoke-doc-b-$([guid]::NewGuid().ToString('N')).pdf"
  [System.IO.File]::WriteAllText($clientBDocPath, "Folio smoke test unreviewed document fixture", $utf8)
  $clientBDocUpload = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-F", "file=@$clientBDocPath;type=application/pdf", "$BaseUrl/api/clients/$clientBId/documents")
  Remove-TempFile $clientBDocPath
  $clientBDocId = [string]$clientBDocUpload.id
  if (-not $clientBDocId) { throw "Client B document upload did not return an id." }

  Write-Host "Verifying missing-document and document-review actions surface identically in the global dashboard and the client overview..."
  $dashboardWithDocs = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/dashboard")
  $missingDocAction = @($dashboardWithDocs.actions) | Where-Object { $_.clientId -eq $clientBId -and $_.type -eq "missing_document" } | Select-Object -First 1
  if (-not $missingDocAction) { throw "The global dashboard did not surface Client B's missing-document action." }
  $reviewDocAction = @($dashboardWithDocs.actions) | Where-Object { $_.clientId -eq $clientBId -and $_.type -eq "document_review" -and $_.sourceEntityId -eq $clientBDocId } | Select-Object -First 1
  if (-not $reviewDocAction) { throw "The global dashboard did not surface Client B's document-review action." }

  $clientBOverview = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientBId/overview")
  $overviewHasMissingDoc = @($clientBOverview.nextActions) | Where-Object { $_.type -eq "missing_document" }
  $overviewHasReviewDoc = @($clientBOverview.nextActions) | Where-Object { $_.type -eq "document_review" -and $_.sourceEntityId -eq $clientBDocId }
  if (@($overviewHasMissingDoc).Count -eq 0 -or @($overviewHasReviewDoc).Count -eq 0) {
    throw "Client B's own overview must show the same missing-document and document-review actions as the global dashboard."
  }

  Write-Host "Confirming the document through the review inbox clears its document_review action everywhere..."
  $clientBConfirmBody = @{ action = "confirm" } | ConvertTo-Json -Compress
  $clientBConfirmPayloadPath = New-JsonPayloadFile $clientBConfirmBody
  $null = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "-X", "PATCH", "--data-binary", "@$clientBConfirmPayloadPath", "$BaseUrl/api/documents/review/$clientBDocId")
  Remove-TempFile $clientBConfirmPayloadPath
  $dashboardAfterConfirm = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/dashboard")
  $residualReviewAction = @($dashboardAfterConfirm.actions) | Where-Object { $_.sourceEntityId -eq $clientBDocId -and $_.type -eq "document_review" }
  if (@($residualReviewAction).Count -gt 0) { throw "Confirming Client B's document should clear its document_review action, but it is still present." }

  Write-Host "Verifying canonical readiness reconciliation using an uncategorized filed-receipt line (not bank triage)..."
  $clientBReceiptUpload = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-F", "file=@$ReceiptPath", "$BaseUrl/api/clients/$clientBId/receipts")
  $clientBReceiptId = [string]$clientBReceiptUpload.receipt.id
  if (-not $clientBReceiptId) { throw "Client B receipt upload did not return an extracted receipt." }
  $clientBReview = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientBId/review")
  $clientBReceipt = @($clientBReview.receipts) | Where-Object { $_.id -eq $clientBReceiptId } | Select-Object -First 1
  if (-not $clientBReceipt) { throw "Client B's extracted receipt did not appear in the review queue." }

  Write-Host "Forcing an uncategorized line so this receipt cannot silently reconcile as complete..."
  $uncategorizedLineItems = @(@($clientBReceipt.lineItems) | ForEach-Object {
    @{ description = $_.description; quantity = $_.quantity; unitPrice = $_.unitPrice; amount = $_.amount; category = $null }
  })
  $clientBCorrectionBody = @{
    date = $clientBReceipt.extracted_date
    merchant = $clientBReceipt.extracted_merchant
    subtotal = $clientBReceipt.extracted_subtotal
    tax = $clientBReceipt.extracted_tax
    tip = $clientBReceipt.extracted_tip
    total = $clientBReceipt.extracted_total
    currency = $clientBReceipt.extracted_currency
    category = $null
    confidence = 1
    lineItems = $uncategorizedLineItems
  } | ConvertTo-Json -Compress -Depth 6
  $clientBCorrectionPayloadPath = New-JsonPayloadFile $clientBCorrectionBody
  $null = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "-X", "PATCH", "--data-binary", "@$clientBCorrectionPayloadPath", "$BaseUrl/api/clients/$clientBId/receipts/$clientBReceiptId")
  Remove-TempFile $clientBCorrectionPayloadPath

  $clientBApproveBody = @{ confirmOverride = $true } | ConvertTo-Json -Compress
  $clientBApprovePayloadPath = New-JsonPayloadFile $clientBApproveBody
  $clientBFiled = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "--data-binary", "@$clientBApprovePayloadPath", "$BaseUrl/api/clients/$clientBId/receipts/$clientBReceiptId/approve")
  Remove-TempFile $clientBApprovePayloadPath
  if ($clientBFiled.receipt.status -ne "filed") { throw "Client B's deliberately uncategorized receipt did not file." }

  $pnlBBefore = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientBId/pnl")
  if ($pnlBBefore.completeness.isComplete) { throw "P&L must be incomplete while a filed receipt has an uncategorized line." }
  $dashboardBBefore = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/dashboard")
  $dashRowBBefore = @($dashboardBBefore.clients) | Where-Object { $_.id -eq $clientBId } | Select-Object -First 1
  if ($dashRowBBefore.readiness -eq "ready") { throw "The Operations dashboard must not mark Client B Ready while a receipt line is uncategorized." }
  $overviewBBefore = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientBId/overview")
  if ($overviewBBefore.financialStatus.pnlCompleteness) { throw "Client B's own overview must not report books complete while a receipt line is uncategorized." }
  $readinessBBefore = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientBId/tax-readiness/2026")
  if ($readinessBBefore.suggestedStatus -ne "bookkeeping_incomplete") {
    throw "Tax readiness must suggest bookkeeping_incomplete while a receipt line is uncategorized, got '$($readinessBBefore.suggestedStatus)'."
  }
  Write-Host "Confirmed: P&L, Operations dashboard, client overview, and tax readiness all agree the books are incomplete."

  Write-Host "Verifying the client overview API contract actually returns financialPeriod (not just a frontend mock)..."
  if ($null -eq $overviewBBefore.financialPeriod) {
    throw "GET /api/clients/:clientId/overview must return a financialPeriod object."
  }
  if (-not ($overviewBBefore.financialPeriod.PSObject.Properties.Name -contains "income") -or
      -not ($overviewBBefore.financialPeriod.PSObject.Properties.Name -contains "expenses") -or
      -not ($overviewBBefore.financialPeriod.PSObject.Properties.Name -contains "net") -or
      -not ($overviewBBefore.financialPeriod.PSObject.Properties.Name -contains "periodStart") -or
      -not ($overviewBBefore.financialPeriod.PSObject.Properties.Name -contains "periodEnd")) {
    throw "financialPeriod is missing one of income/expenses/net/periodStart/periodEnd."
  }
  if (-not ($overviewBBefore.financialStatus.PSObject.Properties.Name -contains "resolvedCount")) {
    throw "financialStatus must include a resolvedCount (reconciled/matched bank transaction count)."
  }
  if ($overviewBBefore.financialStatus.periodStart -ne $overviewBBefore.financialPeriod.periodStart) {
    throw "financialStatus and financialPeriod must refer to the same selected period, got '$($overviewBBefore.financialStatus.periodStart)' vs '$($overviewBBefore.financialPeriod.periodStart)'."
  }

  Write-Host "Verifying the uncategorized receipt evidence produces a real, resolvable action..."
  $dashboardActionsBBefore = @($dashboardBBefore.actions) | Where-Object { $_.type -eq "uncategorized_receipt_evidence" -and $_.sourceEntityId -eq $clientBReceiptId }
  if (@($dashboardActionsBBefore).Count -eq 0) { throw "The Operations dashboard must surface an uncategorized_receipt_evidence action for the affected receipt." }
  $overviewActionsBBefore = @($overviewBBefore.nextActions) | Where-Object { $_.type -eq "uncategorized_receipt_evidence" -and $_.sourceEntityId -eq $clientBReceiptId }
  if (@($overviewActionsBBefore).Count -eq 0) { throw "Client B's own overview must surface the same uncategorized_receipt_evidence action." }

  Write-Host "Resolving the uncategorized receipt evidence via the real correction endpoint..."
  $categorizeBody = @{ categoryId = $clientBFixCategoryId } | ConvertTo-Json -Compress
  $categorizePayloadPath = New-JsonPayloadFile $categorizeBody
  $categorizeResult = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "-X", "PATCH", "--data-binary", "@$categorizePayloadPath", "$BaseUrl/api/clients/$clientBId/receipts/$clientBReceiptId/category")
  Remove-TempFile $categorizePayloadPath
  if (-not $categorizeResult.receipt -or -not $categorizeResult.receipt.category_id) { throw "Categorizing the filed receipt did not return the updated receipt." }

  $pnlBAfter = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientBId/pnl")
  if (-not $pnlBAfter.completeness.isComplete) { throw "P&L must become complete once the receipt's category is corrected." }
  $overviewBAfter = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientBId/overview")
  $overviewActionsBAfter = @($overviewBAfter.nextActions) | Where-Object { $_.type -eq "uncategorized_receipt_evidence" -and $_.sourceEntityId -eq $clientBReceiptId }
  if (@($overviewActionsBAfter).Count -ne 0) { throw "The uncategorized_receipt_evidence action must clear once the receipt is categorized." }
  Write-Host "Confirmed: correcting the receipt's category resolves it consistently across P&L, dashboard, and client overview."


  Write-Host "Verifying migration 0011's FK deletion semantics with a live cascade-delete scenario..."
  $cascadeRaw = & node (Join-Path $PSScriptRoot "smoke-admin.mjs") cascade-delete-test $firmId
  if ($LASTEXITCODE -ne 0) { throw "Live cascade-delete-test failed: $cascadeRaw" }
  $cascadeResult = ($cascadeRaw | Select-Object -Last 1) | ConvertFrom-Json
  if (-not $cascadeResult.passed) { throw "Live cascade-delete-test reported failure: $($cascadeRaw | Select-Object -Last 1)" }
  Write-Host "Confirmed: deleting a referenced checklist item or duplicate-target document nulls only the relationship column and preserves client_id, and the dependent client tree deletes cleanly."

  Write-Host "Creating a client to prove tax-year readiness is genuinely date-bound, not just metadata..."
  $clientXBody = @{ name = "Smoke Cross Tax Year $stamp" } | ConvertTo-Json -Compress
  $clientXPayloadPath = New-JsonPayloadFile $clientXBody
  $clientXResponse = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "--data-binary", "@$clientXPayloadPath", "$BaseUrl/api/clients")
  Remove-TempFile $clientXPayloadPath
  $clientXId = [string]$clientXResponse.client.id
  if (-not $clientXId) { throw "Cross tax year client creation did not return an id." }

  $clientXCategories = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientXId/categories")
  $clientXCategoryId = [string](@($clientXCategories.categories) | Select-Object -First 1).id
  if (-not $clientXCategoryId) { throw "Cross tax year client has no default categories to classify against." }

  $clientXMappingBody = @{ date = "Date"; description = "Description"; amount = "Amount" } | ConvertTo-Json -Compress
  $clientXMappingPayloadPath = New-JsonPayloadFile $clientXMappingBody

  $clientX2025CsvPath = Join-Path $env:TEMP "folio-smoke-crossyear-2025-$([guid]::NewGuid().ToString('N')).csv"
  $clientX2025Csv = "Date,Description,Amount`r`n2025-06-01,FOLIO CROSS YEAR 2025 SMOKE,-50.00`r`n"
  [System.IO.File]::WriteAllText($clientX2025CsvPath, $clientX2025Csv, $utf8)
  $clientX2025Import = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-F", "file=@$clientX2025CsvPath", "-F", "mapping=<$clientXMappingPayloadPath", "$BaseUrl/api/clients/$clientXId/bank-transactions/import")
  if ($clientX2025Import.insertedCount -ne 1) { throw "Cross tax year 2025 CSV did not insert exactly one transaction." }
  Remove-TempFile $clientX2025CsvPath

  $clientX2026CsvPath = Join-Path $env:TEMP "folio-smoke-crossyear-2026-$([guid]::NewGuid().ToString('N')).csv"
  $clientX2026Csv = "Date,Description,Amount`r`n2026-06-01,FOLIO CROSS YEAR 2026 SMOKE,-60.00`r`n"
  [System.IO.File]::WriteAllText($clientX2026CsvPath, $clientX2026Csv, $utf8)
  $clientX2026Import = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-F", "file=@$clientX2026CsvPath", "-F", "mapping=<$clientXMappingPayloadPath", "$BaseUrl/api/clients/$clientXId/bank-transactions/import")
  if ($clientX2026Import.insertedCount -ne 1) { throw "Cross tax year 2026 CSV did not insert exactly one transaction." }
  Remove-TempFile $clientX2026CsvPath
  Remove-TempFile $clientXMappingPayloadPath

  $clientXTxns = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientXId/bank-transactions")
  $clientX2025Txn = @($clientXTxns.transactions) | Where-Object { $_.description -eq "FOLIO CROSS YEAR 2025 SMOKE" } | Select-Object -First 1
  $clientX2026Txn = @($clientXTxns.transactions) | Where-Object { $_.description -eq "FOLIO CROSS YEAR 2026 SMOKE" } | Select-Object -First 1
  if (-not $clientX2025Txn -or -not $clientX2026Txn) { throw "Cross tax year transactions were not both persisted." }
  $clientX2025TxnId = [string]$clientX2025Txn.id
  $clientX2026TxnId = [string]$clientX2026Txn.id

  Write-Host "Resolving only the 2025 transaction, deliberately leaving 2026 unclassified..."
  $clientX2025NoReceiptBody = @{ action = "no_receipt_required"; reason = "Smoke test: cross tax year 2025 resolved" } | ConvertTo-Json -Compress
  $clientX2025NoReceiptPayloadPath = New-JsonPayloadFile $clientX2025NoReceiptBody
  $null = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "--data-binary", "@$clientX2025NoReceiptPayloadPath", "$BaseUrl/api/clients/$clientXId/bank-transactions/$clientX2025TxnId/decision")
  Remove-TempFile $clientX2025NoReceiptPayloadPath
  $clientX2025ExpenseBody = @{ disposition = "business_expense"; categoryId = $clientXCategoryId; note = "Smoke test: cross tax year 2025 resolved" } | ConvertTo-Json -Compress
  $clientX2025ExpensePayloadPath = New-JsonPayloadFile $clientX2025ExpenseBody
  $null = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "-X", "PATCH", "--data-binary", "@$clientX2025ExpensePayloadPath", "$BaseUrl/api/clients/$clientXId/bank-transactions/$clientX2025TxnId/disposition")
  Remove-TempFile $clientX2025ExpensePayloadPath
  # $clientX2026TxnId deliberately left unclassified and unmatched.

  Write-Host "Verifying the real tax-readiness endpoint: 2025 complete, 2026 incomplete, from the same client's activity..."
  $clientXReadiness2025 = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientXId/tax-readiness/2025")
  if (-not $clientXReadiness2025.bookkeepingComplete) {
    throw "2025 tax readiness must be complete using only 2025 activity, but bookkeepingComplete was false."
  }
  $clientXReadiness2026 = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientXId/tax-readiness/2026")
  if ($clientXReadiness2026.bookkeepingComplete) {
    throw "2026 tax readiness must be incomplete due to its own unresolved transaction, but bookkeepingComplete was true."
  }

  Write-Host "Resolving the 2026 transaction and confirming 2026 becomes complete independent of 2025..."
  $clientX2026NoReceiptBody = @{ action = "no_receipt_required"; reason = "Smoke test: cross tax year 2026 resolved" } | ConvertTo-Json -Compress
  $clientX2026NoReceiptPayloadPath = New-JsonPayloadFile $clientX2026NoReceiptBody
  $null = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "--data-binary", "@$clientX2026NoReceiptPayloadPath", "$BaseUrl/api/clients/$clientXId/bank-transactions/$clientX2026TxnId/decision")
  Remove-TempFile $clientX2026NoReceiptPayloadPath
  $clientX2026ExpenseBody = @{ disposition = "business_expense"; categoryId = $clientXCategoryId; note = "Smoke test: cross tax year 2026 resolved" } | ConvertTo-Json -Compress
  $clientX2026ExpensePayloadPath = New-JsonPayloadFile $clientX2026ExpenseBody
  $null = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "-X", "PATCH", "--data-binary", "@$clientX2026ExpensePayloadPath", "$BaseUrl/api/clients/$clientXId/bank-transactions/$clientX2026TxnId/disposition")
  Remove-TempFile $clientX2026ExpensePayloadPath

  $clientXReadiness2026After = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientXId/tax-readiness/2026")
  if (-not $clientXReadiness2026After.bookkeepingComplete) {
    throw "2026 tax readiness must become complete once its own transaction is resolved."
  }
  $clientXReadiness2025After = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientXId/tax-readiness/2025")
  if (-not $clientXReadiness2025After.bookkeepingComplete) {
    throw "2025 tax readiness must remain unaffected and still complete throughout the 2026 changes."
  }
  Write-Host "Confirmed: tax-year readiness is a real date-bound filter, not just metadata forwarded into a helper."


  Write-Host "Seeding a second synthetic firm to prove live cross-tenant isolation..."
  $emailC = "folio-smoke-tenant2-$runId@example.com"
  $passwordC = "Smoke!$([guid]::NewGuid().ToString('N').Substring(0, 18))"
  $cookieJarC = Join-Path $env:TEMP "folio-smoke-cookies-c-$([guid]::NewGuid().ToString('N')).txt"
  $seedResultCRaw = & node (Join-Path $PSScriptRoot "smoke-admin.mjs") seed-invite $emailC 30
  if ($LASTEXITCODE -ne 0) { throw "Failed to seed the second-tenant smoke invitation: $seedResultCRaw" }
  $seedResultC = ($seedResultCRaw | Select-Object -Last 1) | ConvertFrom-Json
  $inviteTokenC = $seedResultC.token
  if (-not $inviteTokenC) { throw "Second-tenant invitation seeding did not return a token." }

  $redeemBodyC = @{ token = $inviteTokenC; email = $emailC; password = $passwordC; name = "Folio Smoke Test" } | ConvertTo-Json -Compress
  $redeemPayloadPathC = New-JsonPayloadFile $redeemBodyC
  $null = Invoke-CurlJson @("-c", $cookieJarC, "-b", $cookieJarC, "-H", "Content-Type: application/json", "-H", "Origin: $BaseUrl", "--data-binary", "@$redeemPayloadPathC", "$BaseUrl/api/beta/redeem")
  Remove-TempFile $redeemPayloadPathC

  $meC = Invoke-CurlJson @("-c", $cookieJarC, "-b", $cookieJarC, "$BaseUrl/api/me")
  $firmCId = [string]$meC.firm.id
  $ownerUserCId = [string]$meC.user.id
  if (-not $firmCId) { throw "Second-tenant session did not establish a firm." }

  $clientCBody = @{ name = "Smoke Second Tenant Client $stamp" } | ConvertTo-Json -Compress
  $clientCPayloadPath = New-JsonPayloadFile $clientCBody
  $clientCResponse = Invoke-CurlJson @("-c", $cookieJarC, "-b", $cookieJarC, "-H", "Content-Type: application/json", "--data-binary", "@$clientCPayloadPath", "$BaseUrl/api/clients")
  Remove-TempFile $clientCPayloadPath
  $clientCId = [string]$clientCResponse.client.id
  if (-not $clientCId) { throw "Second-tenant client creation did not return an id." }

  $clientCDocPath = Join-Path $env:TEMP "folio-smoke-doc-c-$([guid]::NewGuid().ToString('N')).pdf"
  [System.IO.File]::WriteAllText($clientCDocPath, "Folio smoke test second-tenant document fixture", $utf8)
  $clientCDocUpload = Invoke-CurlJson @("-c", $cookieJarC, "-b", $cookieJarC, "-F", "file=@$clientCDocPath;type=application/pdf", "$BaseUrl/api/clients/$clientCId/documents")
  Remove-TempFile $clientCDocPath
  $clientCDocId = [string]$clientCDocUpload.id

  Write-Host "Verifying Firm A cannot access Firm C's client, overview, documents, or review queue..."
  function Get-HttpStatus([string]$Url, [string]$Jar) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      return (& curl.exe --silent --output NUL --write-out "%{http_code}" -c $Jar -b $Jar $Url)
    } finally {
      $ErrorActionPreference = $prev
    }
  }
  $crossStatus1 = Get-HttpStatus "$BaseUrl/api/clients/$clientCId/overview" $cookieJar
  if ($crossStatus1 -ne "404") { throw "Firm A must not be able to read Firm C's client overview, got HTTP $crossStatus1." }
  $crossStatus2 = Get-HttpStatus "$BaseUrl/api/clients/$clientCId/documents" $cookieJar
  if ($crossStatus2 -ne "404") { throw "Firm A must not be able to list Firm C's documents, got HTTP $crossStatus2." }
  $crossStatus3 = Get-HttpStatus "$BaseUrl/api/clients/$clientCId/documents/$clientCDocId/source" $cookieJar
  if ($crossStatus3 -ne "404") { throw "Firm A must not be able to fetch Firm C's document source, got HTTP $crossStatus3." }

  Write-Host "Verifying Firm C cannot access Firm A's client or overview..."
  $crossStatus4 = Get-HttpStatus "$BaseUrl/api/clients/$clientAId/overview" $cookieJarC
  if ($crossStatus4 -ne "404") { throw "Firm C must not be able to read Firm A's client overview, got HTTP $crossStatus4." }

  Write-Host "Verifying the document review queue is firm-scoped in both directions..."
  $reviewAsA = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/documents/review")
  if (@($reviewAsA.documents) | Where-Object { $_.id -eq $clientCDocId }) {
    throw "Firm A's document review queue must not include Firm C's document."
  }
  $reviewAsC = Invoke-CurlJson @("-c", $cookieJarC, "-b", $cookieJarC, "$BaseUrl/api/documents/review")
  if (-not (@($reviewAsC.documents) | Where-Object { $_.id -eq $clientCDocId })) {
    throw "Firm C's own document review queue should include its own document."
  }
  if (@($reviewAsC.documents) | Where-Object { $_.id -eq $clientBDocId }) {
    throw "Firm C's document review queue must not include Firm A's document."
  }


  function Get-HttpStatusForPatch([string]$Url, [string]$Jar, [string]$JsonBody) {
    $payloadPath = New-JsonPayloadFile $JsonBody
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      return (& curl.exe --silent --output NUL --write-out "%{http_code}" -c $Jar -b $Jar -H "Content-Type: application/json" -X PATCH --data-binary "@$payloadPath" $Url)
    } finally {
      $ErrorActionPreference = $prev
      Remove-TempFile $payloadPath
    }
  }

  Write-Host "Verifying malicious cross-tenant and cross-client relationship mutations fail safely..."
  $crossFirmAssignBody = @{ action = "assign_client"; targetClientId = $clientCId } | ConvertTo-Json -Compress
  $crossFirmAssignStatus = Get-HttpStatusForPatch "$BaseUrl/api/documents/review/$clientBDocId" $cookieJar $crossFirmAssignBody
  if ($crossFirmAssignStatus -ne "404") { throw "Firm A must not be able to reassign its document to Firm C's client, got HTTP $crossFirmAssignStatus." }

  $clientCChecklistBody = @{ taxYear = 2026; docType = "other"; customLabel = "Firm C isolation probe" } | ConvertTo-Json -Compress
  $clientCChecklistPayloadPath = New-JsonPayloadFile $clientCChecklistBody
  $clientCChecklistItem = Invoke-CurlJson @("-c", $cookieJarC, "-b", $cookieJarC, "-H", "Content-Type: application/json", "--data-binary", "@$clientCChecklistPayloadPath", "$BaseUrl/api/clients/$clientCId/checklist")
  Remove-TempFile $clientCChecklistPayloadPath
  $clientCChecklistItemId = [string]$clientCChecklistItem.id
  if (-not $clientCChecklistItemId) { throw "Firm C checklist item creation did not return an id." }

  $crossFirmMatchBody = @{ action = "match_checklist"; checklistItemId = $clientCChecklistItemId } | ConvertTo-Json -Compress
  $crossFirmMatchStatus = Get-HttpStatusForPatch "$BaseUrl/api/documents/review/$clientBDocId" $cookieJar $crossFirmMatchBody
  if ($crossFirmMatchStatus -ne "404") { throw "Firm A must not be able to match its document to Firm C's checklist item, got HTTP $crossFirmMatchStatus." }

  $crossFirmDuplicateBody = @{ action = "mark_duplicate"; duplicateOfDocumentId = $clientCDocId } | ConvertTo-Json -Compress
  $crossFirmDuplicateStatus = Get-HttpStatusForPatch "$BaseUrl/api/documents/review/$clientBDocId" $cookieJar $crossFirmDuplicateBody
  if ($crossFirmDuplicateStatus -ne "404") { throw "Firm A must not be able to mark its document a duplicate of Firm C's document, got HTTP $crossFirmDuplicateStatus." }

  $clientBReadinessForChecklist = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientBId/tax-readiness/2026")
  $clientBChecklistItemId = [string](@($clientBReadinessForChecklist.checklist) | Select-Object -First 1).id
  if (-not $clientBChecklistItemId) { throw "Client B has no checklist item to use for the cross-client isolation check." }
  $sameFirmCrossClientBody = @{ action = "match_checklist"; checklistItemId = $clientBChecklistItemId } | ConvertTo-Json -Compress
  $sameFirmCrossClientStatus = Get-HttpStatusForPatch "$BaseUrl/api/documents/review/$clientADocId" $cookieJar $sameFirmCrossClientBody
  if ($sameFirmCrossClientStatus -ne "404") { throw "Client A's document must not be matchable to Client B's checklist item within the same firm, got HTTP $sameFirmCrossClientStatus." }

  Write-Host "Verifying a reassigned document does not carry a stale checklist relationship..."
  $reassignBody = @{ action = "assign_client"; targetClientId = $clientBId } | ConvertTo-Json -Compress
  $reassignPayloadPath = New-JsonPayloadFile $reassignBody
  $null = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "-X", "PATCH", "--data-binary", "@$reassignPayloadPath", "$BaseUrl/api/documents/review/$clientADocId")
  Remove-TempFile $reassignPayloadPath
  $clientBDocsAfterReassign = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientBId/documents")
  $reassignedDoc = @($clientBDocsAfterReassign.documents) | Where-Object { $_.id -eq $clientADocId } | Select-Object -First 1
  if (-not $reassignedDoc) { throw "Reassigned document did not appear under its new client." }
  if ($reassignedDoc.checklist_item_id) { throw "A reassigned document must not retain its old client's checklist relationship, found '$($reassignedDoc.checklist_item_id)'." }

  Write-Host "Exercising the exact document-review deep link against the real resolution endpoint..."
  $dashboardForDeepLink = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/dashboard")
  $liveReviewAction = @($dashboardForDeepLink.actions) | Where-Object { $_.type -eq "document_review" } | Select-Object -First 1
  if ($liveReviewAction) {
    if ($liveReviewAction.deepLink -notmatch '^/documents/review\?focus=(?<id>.+)$') {
      throw "document_review deep link '$($liveReviewAction.deepLink)' is not the expected cross-client review destination."
    }
    $focusedId = $Matches['id']
    $liveReviewQueue = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/documents/review")
    $focusedDoc = @($liveReviewQueue.documents) | Where-Object { $_.id -eq $focusedId } | Select-Object -First 1
    if (-not $focusedDoc) { throw "The document_review deep link's focus id '$focusedId' does not resolve to a real, actionable document in the review queue." }
  }

  Write-Host "Exercising the Practice OS: engagement, exception-to-request automation, portal, and evidence upload..."

  $posEngagementBody = @{ serviceType = "bookkeeping"; title = "Practice OS smoke engagement" } | ConvertTo-Json -Compress
  $posEngagementPayloadPath = New-JsonPayloadFile $posEngagementBody
  $posEngagement = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "--data-binary", "@$posEngagementPayloadPath", "$BaseUrl/api/clients/$clientId/engagements")
  Remove-TempFile $posEngagementPayloadPath
  $posEngagementId = [string]$posEngagement.engagement.id
  if (-not $posEngagementId) { throw "Engagement creation did not return an id." }

  $posEngagementList = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/engagements")
  $posEngagementRow = @($posEngagementList.engagements) | Where-Object { $_.id -eq $posEngagementId } | Select-Object -First 1
  if (-not $posEngagementRow -or [int]$posEngagementRow.total_work_items -ne 8) {
    throw "Bookkeeping service template must produce exactly 8 work items, got $([int]$posEngagementRow.total_work_items)."
  }
  Write-Host "Confirmed: bookkeeping service template produced its 8 work items automatically."

  $posCsvPath = Join-Path $env:TEMP "folio-smoke-pos-bank-$([guid]::NewGuid().ToString('N')).csv"
  $posCsv = "Date,Description,Amount`n2026-02-01,Practice OS Smoke Unknown Vendor,-88.40`n"
  [System.IO.File]::WriteAllText($posCsvPath, $posCsv, $utf8)
  $posMappingBody = @{ date = "Date"; description = "Description"; amount = "Amount" } | ConvertTo-Json -Compress
  $posMappingPayloadPath = New-JsonPayloadFile $posMappingBody
  $posBankImport = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-F", "file=@$posCsvPath", "-F", "mapping=<$posMappingPayloadPath", "$BaseUrl/api/clients/$clientId/bank-transactions/import")
  Remove-TempFile $posCsvPath
  Remove-TempFile $posMappingPayloadPath
  if ($posBankImport.insertedCount -ne 1) { throw "Practice OS smoke bank import did not insert exactly one transaction." }
  $posQueue = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/bank-transactions")
  $posTxn = @($posQueue.transactions) | Where-Object { $_.description -eq "Practice OS Smoke Unknown Vendor" } | Select-Object -First 1
  $posTxnId = [string]$posTxn.id
  if (-not $posTxnId) { throw "Could not find the Practice OS smoke bank transaction after import." }

  $posPrepareBody = @{ bankTransactionId = $posTxnId } | ConvertTo-Json -Compress
  $posPreparePayloadPath = New-JsonPayloadFile $posPrepareBody
  $posDraft = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "--data-binary", "@$posPreparePayloadPath", "$BaseUrl/api/clients/$clientId/requests/prepare-missing-receipt")
  $posRequestId = [string]$posDraft.request.id
  if (-not $posRequestId -or $posDraft.request.status -ne "draft") { throw "Exception-to-request preparation did not create a draft request." }

  Write-Host "Verifying the exception-request idempotency slot is race-safe: repeating the same preparation call returns the SAME request, not a duplicate..."
  $posDraftAgain = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "--data-binary", "@$posPreparePayloadPath", "$BaseUrl/api/clients/$clientId/requests/prepare-missing-receipt")
  Remove-TempFile $posPreparePayloadPath
  if ([string]$posDraftAgain.request.id -ne $posRequestId) { throw "A second exception-request preparation call for the same transaction created a duplicate request instead of returning the existing one." }

  $posApproved = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-X", "POST", "$BaseUrl/api/clients/$clientId/requests/$posRequestId/approve")
  if ($posApproved.request.status -ne "requested") { throw "Approving the draft request did not move it to requested." }

  Write-Host "Verifying Firm A cannot approve/satisfy a request through Firm C's client path (cross-firm)..."
  $crossFirmRequestStatus = Get-HttpStatus "$BaseUrl/api/clients/$clientCId/requests/$posRequestId/messages" $cookieJarC
  if ($crossFirmRequestStatus -ne "404") { throw "Firm C must not be able to read Firm A's request via its own client path, got HTTP $crossFirmRequestStatus." }

  Write-Host "Issuing a client portal link and verifying portal-only access..."
  $posLinkPayloadPath = New-JsonPayloadFile "{}"
  $posLinkResult = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "--data-binary", "@$posLinkPayloadPath", "$BaseUrl/api/clients/$clientId/portal-links")
  Remove-TempFile $posLinkPayloadPath
  $posPortalToken = [string]$posLinkResult.link.token
  if (-not $posPortalToken) { throw "Portal link issuance did not return a token." }

  $posHome = Invoke-CurlJson @("-H", "Authorization: Bearer $posPortalToken", "$BaseUrl/api/portal/home")
  if (-not $posHome.client.id -or [int]$posHome.outstandingRequestCount -lt 1) {
    throw "Portal home did not report the expected client and outstanding-request count."
  }

  $posPortalRequests = Invoke-CurlJson @("-H", "Authorization: Bearer $posPortalToken", "$BaseUrl/api/portal/requests")
  $posPortalRequestRow = @($posPortalRequests.requests) | Where-Object { $_.id -eq $posRequestId } | Select-Object -First 1
  if (-not $posPortalRequestRow) { throw "The approved request did not appear in the client portal's request list." }

  $null = Invoke-CurlJson @("-H", "Authorization: Bearer $posPortalToken", "$BaseUrl/api/portal/requests/$posRequestId")
  $posAfterView = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/requests")
  $posAfterViewRow = @($posAfterView.requests) | Where-Object { $_.id -eq $posRequestId } | Select-Object -First 1
  if ($posAfterViewRow.status -ne "viewed") { throw "Opening the request in the portal must move it to viewed, got '$($posAfterViewRow.status)'." }

  Write-Host "Verifying a portal token cannot access a different client's data (same firm)..."
  $posOtherLinkPayloadPath = New-JsonPayloadFile "{}"
  $posOtherClientLinkResult = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "--data-binary", "@$posOtherLinkPayloadPath", "$BaseUrl/api/clients/$clientBId/portal-links")
  Remove-TempFile $posOtherLinkPayloadPath
  $posOtherClientToken = [string]$posOtherClientLinkResult.link.token
  $crossClientPortalStatus = (& curl.exe --silent --output NUL --write-out "%{http_code}" -H "Authorization: Bearer $posOtherClientToken" "$BaseUrl/api/portal/requests/$posRequestId")
  if ($crossClientPortalStatus -ne "404") { throw "A different client's portal token must not be able to open Client A's request, got HTTP $crossClientPortalStatus." }

  Write-Host "Verifying a revoked portal link is rejected..."
  $posRevokeStatus = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-X", "POST", "$BaseUrl/api/clients/$clientBId/portal-links/$([string]$posOtherClientLinkResult.link.id)/revoke")
  if (-not $posRevokeStatus.revoked) { throw "Portal link revocation did not report success." }
  $revokedTokenStatus = (& curl.exe --silent --output NUL --write-out "%{http_code}" -H "Authorization: Bearer $posOtherClientToken" "$BaseUrl/api/portal/home")
  if ($revokedTokenStatus -ne "401") { throw "A revoked portal token must return 401, got HTTP $revokedTokenStatus." }
  Write-Host "Verifying a genuinely expired portal link is rejected (not just an explicitly revoked one)..."
  $posExpiryLinkPayloadPath = New-JsonPayloadFile "{}"
  $posExpiryLinkResult = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "--data-binary", "@$posExpiryLinkPayloadPath", "$BaseUrl/api/clients/$clientId/portal-links")
  Remove-TempFile $posExpiryLinkPayloadPath
  $posExpiryLinkId = [string]$posExpiryLinkResult.link.id
  $posExpiryToken = [string]$posExpiryLinkResult.link.token
  if (-not $posExpiryLinkId -or -not $posExpiryToken) { throw "Could not issue the portal link used for the expiry smoke check." }

  $expireResultRaw = & node (Join-Path $PSScriptRoot "smoke-admin.mjs") expire-portal-link $posExpiryLinkId
  if ($LASTEXITCODE -ne 0) { throw "smoke-admin.mjs expire-portal-link failed: $expireResultRaw" }
  $expireResult = ($expireResultRaw | Select-Object -Last 1) | ConvertFrom-Json
  if (-not $expireResult.expired) { throw "smoke-admin.mjs did not report the portal link as expired." }

  $expiredTokenStatus = (& curl.exe --silent --output NUL --write-out "%{http_code}" -H "Authorization: Bearer $posExpiryToken" "$BaseUrl/api/portal/home")
  if ($expiredTokenStatus -ne "401") { throw "A genuinely expired portal token must return 401, got HTTP $expiredTokenStatus." }
  Write-Host "Confirmed: an expired portal link (backdated via the narrowly-scoped, synthetic-context-only smoke-admin operation, not a production API weakening) is rejected exactly like a revoked one. Its containing firm is removed by the existing end-of-run cleanup below, same as every other synthetic object."

  Write-Host "Uploading receipt evidence through the client portal for the still-valid request token..."
  $posReceiptPath = Join-Path $env:TEMP "folio-smoke-pos-receipt-$([guid]::NewGuid().ToString('N')).png"
  New-SampleReceiptPng $posReceiptPath
  $posUpload = Invoke-CurlJson @("-H", "Authorization: Bearer $posPortalToken", "-F", "file=@$posReceiptPath;type=image/png", "$BaseUrl/api/portal/requests/$posRequestId/evidence")
  Remove-TempFile $posReceiptPath
  $posUploadedReceiptId = [string]$posUpload.receiptId
  if (-not $posUploadedReceiptId) { throw "Portal evidence upload did not return a receiptId." }

  Write-Host "Verifying the client-uploaded evidence flowed through the SAME receipt pipeline and linked to the originating transaction..."
  $posQueueAfterUpload = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/bank-transactions")
  $posTxnAfterUpload = @($posQueueAfterUpload.transactions) | Where-Object { $_.id -eq $posTxnId } | Select-Object -First 1
  if ($posTxnAfterUpload.triage -ne "receipt_pending" -or [string]$posTxnAfterUpload.pendingReceipt.id -ne $posUploadedReceiptId) {
    throw "Client-uploaded evidence did not enter pending-receipt review for its originating transaction."
  }

  Write-Host "Verifying evidence upload alone moved the request to responded (never satisfied, and never sets accounting treatment by itself)..."
  $posAfterUploadRequest = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/requests")
  $posAfterUploadRow = @($posAfterUploadRequest.requests) | Where-Object { $_.id -eq $posRequestId } | Select-Object -First 1
  if ($posAfterUploadRow.status -ne "responded") { throw "Evidence upload must move the request to responded, got '$($posAfterUploadRow.status)'." }

  Write-Host "Professional reviews and files the client-uploaded receipt through the existing receipt-approval workflow, which auto-resolves its pending bank transaction, then the request is closed..."
  $posApproveBody = @{ confirmOverride = $true } | ConvertTo-Json -Compress
  $posApprovePayloadPath = New-JsonPayloadFile $posApproveBody
  $posReceiptApproval = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-H", "Content-Type: application/json", "--data-binary", "@$posApprovePayloadPath", "$BaseUrl/api/clients/$clientId/receipts/$posUploadedReceiptId/approve")
  Remove-TempFile $posApprovePayloadPath
  if (@($posReceiptApproval.resolvedBankTransactions) -notcontains $posTxnId) { throw "Filing the client-uploaded receipt did not auto-resolve its originating pending bank transaction." }
  $posSatisfied = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "-X", "POST", "$BaseUrl/api/clients/$clientId/requests/$posRequestId/satisfy")
  if ($posSatisfied.request.status -ne "satisfied") { throw "Satisfying the request did not report status satisfied." }

  Write-Host "Verifying the linked work item completed and the work queue / dashboard counts reflect it..."
  $posWorkQueueClosed = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/work-queue?clientId=$clientId&status=complete")
  $posCompletedItem = @($posWorkQueueClosed.items) | Where-Object { $_.source_id -eq $posRequestId } | Select-Object -First 1
  if (-not $posCompletedItem) { throw "The work item linked to the satisfied request did not appear as complete in the work queue." }
  $posDashboardAfter = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/dashboard")
  if (-not $posDashboardAfter.operationsCommandCenter) { throw "Dashboard response is missing operationsCommandCenter after Practice OS activity." }
  Write-Host "Confirmed: exception -> draft request -> approval -> portal -> client upload -> professional review -> satisfied -> work item complete -> Operations Command Center all connect end to end."

  Write-Host "Note: true concurrent-request race coverage (two simultaneous prepare-missing-receipt calls) is not exercised by this sequential script; it is covered instead by the deterministic race-safe-claim unit tests in services/exception-automation.test.ts, which assert the DB-level ON CONFLICT DO NOTHING behavior directly."

  if ($env:SMOKE_CLEANUP_TOKEN) {
    Write-Host "Cleaning up the second synthetic tenant $firmCId..."
    $cleanupCBody = @{ firmId = $firmCId } | ConvertTo-Json -Compress
    $cleanupCPayloadPath = New-JsonPayloadFile $cleanupCBody
    $cleanupCResult = Invoke-CurlJson @("-H", "Content-Type: application/json", "-H", "X-Internal-Token: $($env:SMOKE_CLEANUP_TOKEN)", "--data-binary", "@$cleanupCPayloadPath", "$BaseUrl/api/internal/smoke-cleanup")
    Remove-TempFile $cleanupCPayloadPath
    if (-not $cleanupCResult.removed) { throw "Cleanup endpoint did not report removal for second-tenant firm $firmCId." }
    $cleanupCProps = $cleanupCResult.PSObject.Properties.Name
    if (($cleanupCProps -contains "r2Failures") -and @($cleanupCResult.r2Failures).Count -gt 0) { throw "Second-tenant cleanup could not remove R2 object(s): $($cleanupCResult.r2Failures -join ', ')" }
    if (($cleanupCProps -contains "authFailures") -and @($cleanupCResult.authFailures).Count -gt 0) { throw "Second-tenant cleanup could not remove the synthetic auth account: $($cleanupCResult.authFailures -join ', ')" }
    if (($cleanupCProps -contains "betaMetadataFailures") -and @($cleanupCResult.betaMetadataFailures).Count -gt 0) { throw "Second-tenant cleanup could not remove beta security metadata: $($cleanupCResult.betaMetadataFailures -join ', ')" }
    $firmCId = $null

  }
  Remove-TempFile $cookieJarC


  Write-Host "Verifying a revoked beta entitlement blocks protected business APIs (403 BETA_REVOKED)..."
  $revokeResultRaw = & node (Join-Path $PSScriptRoot "smoke-admin.mjs") revoke-by-email $email
  if ($LASTEXITCODE -ne 0) { throw "Failed to revoke the smoke entitlement for coverage: $revokeResultRaw" }

  $revokedStatus = ""
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $revokedStatus = (& curl.exe --silent --output NUL --write-out "%{http_code}" -c $cookieJar -b $cookieJar "$BaseUrl/api/clients")
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($revokedStatus -ne "403") {
    throw "A revoked beta entitlement must block a protected business endpoint with HTTP 403, got $revokedStatus."
  }
  $revokedBetaStatus = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/beta/status")
  if ($revokedBetaStatus.allowed -or $revokedBetaStatus.reason -ne "BETA_REVOKED") {
    throw "The access-status endpoint must remain available after revocation and report BETA_REVOKED."
  }

  Write-Host "Verifying /api/me is beta-gated: a revoked entitlement blocks it exactly like other business endpoints..."
  $revokedMeStatus = ""
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $revokedMeStatus = (& curl.exe --silent --output NUL --write-out "%{http_code}" -c $cookieJar -b $cookieJar "$BaseUrl/api/me")
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($revokedMeStatus -ne "403") {
    throw "/api/me must be beta-gated: a revoked entitlement should return HTTP 403, got $revokedMeStatus."
  }

  Write-Host ""
  Write-Host "END-TO-END PAID-ALPHA SMOKE TEST PASSED" -ForegroundColor Green
  Write-Host "BANK EXCEPTION WORKFLOW PRODUCTION VERIFICATION PASSED" -ForegroundColor Green
  Write-Host "BOOKKEEPING CORE AUDIT CORRECTION VERIFICATION PASSED" -ForegroundColor Green
  Write-Host "Receipt -> R2 -> Workers AI -> line items -> validation -> review -> filed ledger -> P&L -> source drill-down -> CSV -> duplicate protection -> suggested match -> explicit confirmation -> exception inbox -> missing receipt upload -> receipt review -> resolved match -> documented no-receipt resolution -> audit"
  Write-Host "Signed accounting refund/reversal netting -> receipt/bank disposition conflict exclusion -> uncategorized completeness -> invalid date rejection -> accrual guardrail"
  Write-Host "Income drilldown -> foreign-currency completeness -> currency normalization -> duplicate category name rejection"
  Write-Host "One-receipt-to-one-bank-transaction protection (409) -> already-matched receipt excluded from suggestions"
  Write-Host "Public registration closed -> invitation-only activation -> active entitlement -> revoked entitlement blocks business APIs -> self-cleaning tenant removal"
  Write-Host "Test account: $email"
  Write-Host "Test password: $password"
  Write-Host "Test client:  $clientId"
  Write-Host "P&L expenses before exception receipt: $pnlExpenses"
  Write-Host "Matched bank transaction: $bankTransactionId"
  Write-Host "Resolved missing receipt transaction: $missingTransactionId"
  Write-Host "No-receipt-required transaction: $noReceiptTransactionId"
} finally {
  Remove-TempFile $cookieJar
  Remove-TempFile $clientPayloadPath
  Remove-TempFile $approvePayloadPath
  Remove-TempFile $bankDecisionPayloadPath
  Remove-TempFile $bankMappingPayloadPath
  Remove-TempFile $noReceiptDecisionPayloadPath
  Remove-TempFile $bankCsvPath
  Remove-TempFile $bankExceptionCsvPath
  if ($generatedReceipt) {
    Remove-TempFile $ReceiptPath
  }

  # The second tenant is normally removed immediately after the isolation
  # checks. Keep a finally-path cleanup as well: an assertion failure in the
  # Practice OS portion must not strand it or conceal the original failure
  # behind a later global-residue error.
  if ($firmCId -and $env:SMOKE_CLEANUP_TOKEN) {
    try {
      Write-Host "Cleaning up interrupted second synthetic tenant $firmCId..."
      $cleanupCBody = @{ firmId = $firmCId } | ConvertTo-Json -Compress
      $cleanupCPayloadPath = New-JsonPayloadFile $cleanupCBody
      $cleanupCResult = Invoke-CurlJson @(
        "-H", "Content-Type: application/json",
        "-H", "X-Internal-Token: $($env:SMOKE_CLEANUP_TOKEN)",
        "--data-binary", "@$cleanupCPayloadPath",
        "$BaseUrl/api/internal/smoke-cleanup"
      )
      if (-not $cleanupCResult.removed) { throw "Cleanup endpoint did not report removal for second-tenant firm $firmCId." }
      $firmCId = $null
    } finally {
      Remove-TempFile $cleanupCPayloadPath
    }
  }

  if ($firmId) {
    if ($env:SMOKE_CLEANUP_TOKEN) {
      Write-Host "Cleaning up synthetic smoke-test tenant $firmId..."
      $cleanupBody = @{ firmId = $firmId } | ConvertTo-Json -Compress
      $cleanupPayloadPath = New-JsonPayloadFile $cleanupBody
      try {
        $cleanupResult = Invoke-CurlJson @(
          "-H", "Content-Type: application/json",
          "-H", "X-Internal-Token: $($env:SMOKE_CLEANUP_TOKEN)",
          "--data-binary", "@$cleanupPayloadPath",
          "$BaseUrl/api/internal/smoke-cleanup"
        )
        if (-not $cleanupResult.removed) {
          throw "Cleanup endpoint did not report removal for firm $firmId."
        }
        Write-Host "Cleanup removed firm $firmId ($($cleanupResult.clientCount) client(s), $($cleanupResult.r2ObjectsRemoved) R2 object(s) removed)."
        $resultProps = $cleanupResult.PSObject.Properties.Name
        if (($resultProps -contains "r2Failures") -and @($cleanupResult.r2Failures).Count -gt 0) {
          throw "Cleanup could not remove R2 object(s): $($cleanupResult.r2Failures -join ', ')"
        }
        if (($resultProps -contains "authFailures") -and @($cleanupResult.authFailures).Count -gt 0) {
          throw "Cleanup could not remove the synthetic auth account: $($cleanupResult.authFailures -join ', ')"
        }
        if (($resultProps -contains "betaMetadataFailures") -and @($cleanupResult.betaMetadataFailures).Count -gt 0) {
          throw "Cleanup could not remove beta security metadata: $($cleanupResult.betaMetadataFailures -join ', ')"
        }

        if ($ownerUserId) {
          Write-Host "Independently verifying zero production residue for this smoke run..."
          $verifyRaw = & node (Join-Path $PSScriptRoot "smoke-admin.mjs") verify-clean $firmId $ownerUserId
          $verifyExit = $LASTEXITCODE
          $verifyResult = ($verifyRaw | Select-Object -Last 1) | ConvertFrom-Json
          Write-Host "Residue check: $($verifyRaw | Select-Object -Last 1)"
          if ($verifyExit -ne 0 -or -not $verifyResult.clean) {
            throw "Final residue check found leftover production data: $($verifyRaw | Select-Object -Last 1)"
          }
        }
      } catch {
        Write-Host "SMOKE CLEANUP FAILURE for firm $firmId : $($_.Exception.Message)" -ForegroundColor Red
        throw
      } finally {
        Remove-TempFile $cleanupPayloadPath
      }
    } else {
      Write-Host "WARNING: SMOKE_CLEANUP_TOKEN is not set in this environment; synthetic tenant $firmId was NOT cleaned up." -ForegroundColor Yellow
    }
  }
}
