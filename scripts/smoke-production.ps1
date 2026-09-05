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
$bankCsvPath = ""

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

  $bankMapping = '{"date":"Date","description":"Description","amount":"Amount"}'
  $bankImport = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-F", "file=@$bankCsvPath",
    "-F", "mapping=$bankMapping",
    "$BaseUrl/api/clients/$clientId/bank-transactions/import"
  )
  if ($bankImport.insertedCount -ne 1 -or $bankImport.duplicateCount -ne 0) {
    throw "Initial bank CSV import did not insert exactly one normalized transaction."
  }

  $duplicateImport = Invoke-CurlJson @(
    "-c", $cookieJar,
    "-b", $cookieJar,
    "-F", "file=@$bankCsvPath",
    "-F", "mapping=$bankMapping",
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

  Write-Host ""
  Write-Host "END-TO-END PAID-ALPHA SMOKE TEST PASSED" -ForegroundColor Green
  Write-Host "Receipt -> R2 -> Workers AI -> line items -> validation -> review -> filed ledger -> P&L -> source drill-down -> CSV -> normalized bank transaction -> duplicate protection -> suggested match -> explicit confirmation -> audit"
  Write-Host "Test account: $email"
  Write-Host "Test password: $password"
  Write-Host "Test client:  $clientId"
  Write-Host "P&L expenses: $pnlExpenses"
  Write-Host "Bank transaction: $bankTransactionId"
} finally {
  Remove-TempFile $cookieJar
  Remove-TempFile $signupPayloadPath
  Remove-TempFile $clientPayloadPath
  Remove-TempFile $approvePayloadPath
  Remove-TempFile $bankDecisionPayloadPath
  Remove-TempFile $bankCsvPath
  if ($generatedReceipt) {
    Remove-TempFile $ReceiptPath
  }
}
