[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$BaseUrl,
  [string]$ReceiptPath = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$BaseUrl = $BaseUrl.TrimEnd("/")

function Invoke-CurlJson([string[]]$CurlArgs) {
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
  $uploadedAudit = @($missingAudit.events) | Where-Object { $_.action -eq "bank_receipt_uploaded" } | Select-Object -First 1
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

  Write-Host "Verifying Wave source/import-batch isolation: distinct CSV uploads remain distinct batches..."
  $waveBatches = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/export/wave-batches")
  $batchList = @($waveBatches.batches)
  if ($batchList.Count -lt 2) { throw "Expected at least two distinct Wave import-batch groupings, found $($batchList.Count)." }

  $usdBatches = @($batchList | Where-Object { $_.currency -eq "USD" })
  if ($usdBatches.Count -lt 2) { throw "Expected at least two distinct USD import batches from the smoke run's separate CSV uploads." }

  $singleBatch = $usdBatches[0]
  $encodedBatchId = [Uri]::EscapeDataString([string]$singleBatch.importBatchId)
  $waveCsvPath = Join-Path $env:TEMP "folio-smoke-wave-$([guid]::NewGuid().ToString('N')).csv"
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $waveCsvStatus = (& curl.exe --silent --output $waveCsvPath --write-out "%{http_code}" -c $cookieJar -b $cookieJar "$BaseUrl/api/clients/$clientId/export/wave-statement?importBatchId=$encodedBatchId&currency=USD")
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($waveCsvStatus -ne "200") { throw "Single-batch Wave statement CSV download returned HTTP $waveCsvStatus." }
  $waveCsvLines = @(Get-Content $waveCsvPath)
  if ($waveCsvLines[0] -ne "Date,Description,Amount") {
    throw "Wave statement CSV header must be exactly 'Date,Description,Amount', got '$($waveCsvLines[0])'."
  }
  $expectedRowCount = [int]$singleBatch.transactionCount
  $actualRowCount = $waveCsvLines.Count - 1
  if ($actualRowCount -ne $expectedRowCount) {
    throw "Wave statement CSV row count $actualRowCount does not reconcile to the selected batch's $expectedRowCount transactions."
  }
  Remove-TempFile $waveCsvPath

  Write-Host "Verifying the Wave statement CSV refuses to silently merge two distinct USD import batches..."
  $mixedBatchStatus = ""
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $mixedBatchStatus = (& curl.exe --silent --output NUL --write-out "%{http_code}" -c $cookieJar -b $cookieJar "$BaseUrl/api/clients/$clientId/export/wave-statement?currency=USD")
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($mixedBatchStatus -ne "400") {
    throw "Requesting a Wave statement across multiple USD import batches without selecting one must return HTTP 400, got $mixedBatchStatus."
  }

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
