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

function Invoke-CurlExpectStatus([string[]]$CurlArgs, [int]$ExpectedStatus) {
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
  if ($exitCode -ne 0) {
    throw "curl failed with exit code $exitCode. Response: $body"
  }
  if ($statusCode -ne $ExpectedStatus) {
    $responseText = if ([string]::IsNullOrWhiteSpace($body)) { "<empty response body>" } else { $body }
    throw "Expected HTTP $ExpectedStatus but received HTTP $statusCode. Response: $responseText"
  }
  return $statusCode
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
$signupPayloadPath = ""
$clientPayloadPath = ""
$approvePayloadPath = ""
$bankDecisionPayloadPath = ""
$bankMappingPayloadPath = ""
$noReceiptDecisionPayloadPath = ""
$bankCsvPath = ""
$bankExceptionCsvPath = ""
$categoryPayloadPath = ""
$classifyCsvPath = ""
$closedClassifyPayloadPath = ""
$reopenPayloadPath = ""

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
  $email = "folio-smoke-$([guid]::NewGuid().ToString('N'))@example.com"
  $password = "Smoke!$([guid]::NewGuid().ToString('N').Substring(0, 18))"
  $signupBody = @{ name = "Folio Smoke Test"; email = $email; password = $password } | ConvertTo-Json -Compress
  $signupPayloadPath = New-JsonPayloadFile $signupBody

  Write-Host "Creating an isolated smoke-test firm..."
  $null = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "-H", "Origin: $BaseUrl",
    "--data-binary", "@$signupPayloadPath",
    "$BaseUrl/api/auth/sign-up/email"
  )

  Write-Host "Verifying the Better Auth production session..."
  $me = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/me")
  if (-not $me.user.id) {
    throw "Better Auth did not establish a usable production session."
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

  $firstCategory = @($pnl.byCategory) | Select-Object -First 1
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

  Write-Host ""
  Write-Host "Milestone 4: canonical ledger, explicit classification, and auditable periods" -ForegroundColor Cyan

  Write-Host "Creating a deterministic smoke-test category..."
  $categoryBody = @{ name = "Smoke Supplies"; slug = "smoke-supplies" } | ConvertTo-Json -Compress
  $categoryPayloadPath = New-JsonPayloadFile $categoryBody
  $categoryResponse = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "--data-binary", "@$categoryPayloadPath",
    "$BaseUrl/api/clients/$clientId/categories"
  )
  $categoryId = [string]$categoryResponse.category.id
  if (-not $categoryId) {
    throw "Category creation did not return an id."
  }

  # 4. Reconciled bank + receipt produces exactly one ledger expense, not two.
  #    Receipt A was filed before the bank CSV, so its receipt-only entry must
  #    have absorbed the confirmed bank transaction instead of duplicating it.
  Write-Host "Verifying reconciled bank + receipt produced one merged ledger entry..."
  $ledgerT1 = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/ledger?period=2026-09")
  $t1Entries = @($ledgerT1.entries) | Where-Object { $_.source.bankTransaction -and $_.source.bankTransaction.id -eq $bankTransactionId }
  if (@($t1Entries).Count -ne 1) {
    throw "Reconciled bank + receipt did not produce exactly one ledger entry. Found $(@($t1Entries).Count)."
  }
  $t1Entry = $t1Entries[0]
  if (-not $t1Entry.source.receipt -or $t1Entry.source.receipt.id -ne $receiptId) {
    throw "The merged ledger entry does not trace to the matched receipt evidence."
  }
  if ([Math]::Abs([double]$t1Entry.amount - $approvedTotal) -gt 0.02) {
    throw "The merged ledger entry amount does not match the receipt total."
  }

  # Introduce two more exceptions in 2026-08 for classification coverage.
  Write-Host "Importing personal and transfer smoke transactions for period 2026-08..."
  $classifyCsvPath = Join-Path $env:TEMP "folio-smoke-classify-$([guid]::NewGuid().ToString('N')).csv"
  $classifyCsv = "Date,Description,Amount`r`n2026-08-03,FOLIO PERSONAL SMOKE,-25.25`r`n2026-08-04,FOLIO TRANSFER SMOKE,-50.50`r`n"
  [System.IO.File]::WriteAllText($classifyCsvPath, $classifyCsv, $utf8)

  $classifyImport = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-F", "file=@$classifyCsvPath",
    "-F", "mapping=<$bankMappingPayloadPath",
    "$BaseUrl/api/clients/$clientId/bank-transactions/import"
  )
  if ($classifyImport.insertedCount -ne 2 -or $classifyImport.duplicateCount -ne 0) {
    throw "Classification CSV did not insert exactly two new transactions."
  }

  $classifyQueue = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/bank-transactions")
  $personalTransaction = @($classifyQueue.transactions) | Where-Object { $_.description -eq "FOLIO PERSONAL SMOKE" } | Select-Object -First 1
  $transferTransaction = @($classifyQueue.transactions) | Where-Object { $_.description -eq "FOLIO TRANSFER SMOKE" } | Select-Object -First 1
  if (-not $personalTransaction -or $personalTransaction.triage -ne "unmatched") {
    throw "Personal smoke transaction did not enter the unmatched queue."
  }
  if (-not $transferTransaction -or $transferTransaction.triage -ne "unmatched") {
    throw "Transfer smoke transaction did not enter the unmatched queue."
  }
  $personalTransactionId = [string]$personalTransaction.id
  $transferTransactionId = [string]$transferTransaction.id

  # 7. An open period reports deterministic close blockers when unresolved work exists.
  Write-Host "Verifying the open period reports blockers for unresolved work..."
  $blockedSummary = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/periods/2026-08/summary")
  if ($blockedSummary.state -ne "open" -or $blockedSummary.canClose) {
    throw "A period with unresolved exceptions must report canClose=false and state=open."
  }
  $exceptionBlocker = @($blockedSummary.blockers) | Where-Object { $_ -match "unresolved bank exception" } | Select-Object -First 1
  if (-not $exceptionBlocker) {
    throw "Period summary did not report unresolved bank exceptions as a blocker."
  }

  # Document no-receipt resolutions for the two new classification transactions.
  foreach ($pair in @(
    @{ id = $personalTransactionId; description = "FOLIO PERSONAL SMOKE" },
    @{ id = $transferTransactionId; description = "FOLIO TRANSFER SMOKE" }
  )) {
    $reason = "Smoke test documented non-receipt resolution for $($pair.description)"
    $decisionBody = @{ action = "no_receipt_required"; reason = $reason } | ConvertTo-Json -Compress
    $decisionPayloadPath = New-JsonPayloadFile $decisionBody
    $null = Invoke-CurlJson @(
      "-c", $cookieJar,
      "-b", $cookieJar,
      "-H", "Content-Type: application/json",
      "--data-binary", "@$decisionPayloadPath",
      "$BaseUrl/api/clients/$clientId/bank-transactions/$($pair.id)/decision"
    )
    Remove-TempFile $decisionPayloadPath
  }

  # Explicit professional classification for every smoke transaction.
  Write-Host "Applying explicit professional classification to every transaction..."
  foreach ($classification in @(
    @{ id = $bankTransactionId;      accountingClass = "expense";  treatment = "business"; categoryId = $categoryId },
    @{ id = $missingTransactionId;   accountingClass = "expense";  treatment = "business"; categoryId = $categoryId },
    @{ id = $noReceiptTransactionId; accountingClass = "expense";  treatment = "business"; categoryId = $categoryId },
    @{ id = $personalTransactionId;  accountingClass = "expense";  treatment = "personal"; categoryId = $null },
    @{ id = $transferTransactionId;  accountingClass = "transfer"; treatment = "business"; categoryId = $null }
  )) {
    $classifyBody = @{
      accountingClass = $classification.accountingClass
      treatment = $classification.treatment
      categoryId = $classification.categoryId
    } | ConvertTo-Json -Compress
    $classifyPayloadPath = New-JsonPayloadFile $classifyBody
    $null = Invoke-CurlJson @(
      "-c", $cookieJar,
      "-b", $cookieJar,
      "-H", "Content-Type: application/json",
      "--data-binary", "@$classifyPayloadPath",
      "$BaseUrl/api/clients/$clientId/bank-transactions/$($classification.id)/classify"
    )
    Remove-TempFile $classifyPayloadPath
  }

  # 5 + 6. Personal and transfer classifications must stay out of ledger P&L.
  Write-Host "Verifying personal and transfer rows are excluded from ledger-backed P&L..."
  $pnlAug = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/pnl/ledger?period=2026-08")
  $expectedAugExpenses = [double]$approvedTotal + 11.11
  if ([Math]::Abs([double]$pnlAug.expenses - $expectedAugExpenses) -gt 0.02) {
    throw "Ledger P&L for 2026-08 is $($pnlAug.expenses); expected $expectedAugExpenses (personal and transfer excluded)."
  }
  $augCategorySum = 0
  foreach ($row in @($pnlAug.byCategory.expense)) {
    $augCategorySum += [double]$row.total
  }
  if ([Math]::Abs($augCategorySum - $expectedAugExpenses) -gt 0.02) {
    throw "Ledger P&L category drill-down for 2026-08 does not reconcile to $expectedAugExpenses."
  }

  # 11. Ledger-backed P&L reconciles to the expected business expense total overall.
  Write-Host "Verifying ledger-backed P&L reconciles across all periods..."
  $pnlLedger = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/pnl/ledger")
  $expectedAllExpenses = (2 * [double]$approvedTotal) + 11.11
  if ([Math]::Abs([double]$pnlLedger.expenses - $expectedAllExpenses) -gt 0.02) {
    throw "Ledger-backed P&L expenses are $($pnlLedger.expenses); expected $expectedAllExpenses."
  }
  $pnlSept = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/pnl/ledger?period=2026-09")
  if ([Math]::Abs([double]$pnlSept.expenses - [double]$approvedTotal) -gt 0.02) {
    throw "Ledger-backed P&L for 2026-09 is $($pnlSept.expenses); expected $approvedTotal."
  }

  # 8. A clean period can close.
  Write-Host "Verifying the clean period can close..."
  $cleanSummary = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/periods/2026-08/summary")
  if (-not $cleanSummary.canClose) {
    throw "Period 2026-08 should be clean: $($cleanSummary.blockers -join '; ')"
  }
  $closed = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "-X", "POST",
    "--data-binary", "{}",
    "$BaseUrl/api/clients/$clientId/periods/2026-08/close"
  )
  if ($closed.state -ne "closed") {
    throw "Period close did not transition the period to closed."
  }
  $auditAfterClose = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/periods/2026-08/audit")
  if (-not (@($auditAfterClose.events) | Where-Object { $_.action -eq "period_closed" } | Select-Object -First 1)) {
    throw "Period close did not create a period_closed audit event."
  }

  # 9. Accounting mutations against a closed period are rejected.
  Write-Host "Verifying closed-period accounting mutations are rejected..."
  $closedClassifyBody = @{ accountingClass = "expense"; treatment = "business"; categoryId = $categoryId } | ConvertTo-Json -Compress
  $closedClassifyPayloadPath = New-JsonPayloadFile $closedClassifyBody
  $bankClassifyRejected = Invoke-CurlExpectStatus @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "--data-binary", "@$closedClassifyPayloadPath",
    "$BaseUrl/api/clients/$clientId/bank-transactions/$noReceiptTransactionId/classify"
  ) 409
  if ($bankClassifyRejected -ne 409) {
    throw "Bank classify against a closed period must be rejected with HTTP 409."
  }

  $t3Search = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "$BaseUrl/api/clients/$clientId/ledger?period=2026-08&search=FOLIO%20NO%20RECEIPT%20SMOKE"
  )
  $t3LedgerEntry = @($t3Search.entries) | Select-Object -First 1
  if (-not $t3LedgerEntry) {
    throw "Could not locate the no-receipt ledger entry for the closed-period mutation test."
  }
  $ledgerClassifyRejected = Invoke-CurlExpectStatus @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "-X", "PATCH",
    "--data-binary", "@$closedClassifyPayloadPath",
    "$BaseUrl/api/clients/$clientId/ledger/$($t3LedgerEntry.id)/classify"
  ) 409
  if ($ledgerClassifyRejected -ne 409) {
    throw "Ledger classify against a closed period must be rejected with HTTP 409."
  }

  $closeAgainRejected = Invoke-CurlExpectStatus @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "-X", "POST",
    "--data-binary", "{}",
    "$BaseUrl/api/clients/$clientId/periods/2026-08/close"
  ) 409
  if ($closeAgainRejected -ne 409) {
    throw "Closing an already-closed period must be rejected with HTTP 409."
  }

  # 10. Explicit reopen succeeds and preserves audit history.
  Write-Host "Verifying explicit period reopen creates audit history..."
  $reopenReason = "Smoke test reopening 2026-08 to verify auditable reopen behavior"
  $reopenBody = @{ reason = $reopenReason } | ConvertTo-Json -Compress
  $reopenPayloadPath = New-JsonPayloadFile $reopenBody
  $reopened = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-H", "Content-Type: application/json",
    "--data-binary", "@$reopenPayloadPath",
    "$BaseUrl/api/clients/$clientId/periods/2026-08/reopen"
  )
  if ($reopened.state -ne "open" -or $reopened.reason -ne $reopenReason) {
    throw "Period reopen did not transition the period back to open with its reason."
  }
  $auditAfterReopen = Invoke-CurlJson @("-c", $cookieJar, "-b", $cookieJar, "$BaseUrl/api/clients/$clientId/periods/2026-08/audit")
  if (-not (@($auditAfterReopen.events) | Where-Object { $_.action -eq "period_reopened" } | Select-Object -First 1)) {
    throw "Period reopen did not create a period_reopened audit event."
  }

  Write-Host ""
  Write-Host "END-TO-END PAID-ALPHA SMOKE TEST PASSED" -ForegroundColor Green
  Write-Host "BANK EXCEPTION WORKFLOW PRODUCTION VERIFICATION PASSED" -ForegroundColor Green
  Write-Host "CANONICAL LEDGER + CLASSIFICATION + PERIOD CLOSE PRODUCTION VERIFICATION PASSED" -ForegroundColor Green
  Write-Host "Receipt -> R2 -> Workers AI -> line items -> validation -> review -> filed -> canonical ledger -> merged bank+receipt -> single expense -> explicit classification -> personal/transfer excluded from P&L -> deterministic blockers -> clean period close -> closed-period mutation rejection -> explicit reopen -> audit history"
  Write-Host "Test account: $email"
  Write-Host "Test password: $password"
  Write-Host "Test client:  $clientId"
  Write-Host "P&L expenses before exception receipt: $pnlExpenses"
  Write-Host "Matched bank transaction: $bankTransactionId"
  Write-Host "Resolved missing receipt transaction: $missingTransactionId"
  Write-Host "No-receipt-required transaction: $noReceiptTransactionId"
  Write-Host "Smoke Supplies category: $categoryId"
  Write-Host "Ledger-backed P&L total business expenses: $($pnlLedger.expenses)"
  Write-Host "Period 2026-08 close -> reopen verified"
} finally {
  Remove-TempFile $cookieJar
  Remove-TempFile $signupPayloadPath
  Remove-TempFile $clientPayloadPath
  Remove-TempFile $approvePayloadPath
  Remove-TempFile $bankDecisionPayloadPath
  Remove-TempFile $bankMappingPayloadPath
  Remove-TempFile $noReceiptDecisionPayloadPath
  Remove-TempFile $bankCsvPath
  Remove-TempFile $bankExceptionCsvPath
  Remove-TempFile $categoryPayloadPath
  Remove-TempFile $classifyCsvPath
  Remove-TempFile $closedClassifyPayloadPath
  Remove-TempFile $reopenPayloadPath
  if ($generatedReceipt) {
    Remove-TempFile $ReceiptPath
  }
}
