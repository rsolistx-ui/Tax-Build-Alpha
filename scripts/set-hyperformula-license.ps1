param()

$licenseKey = Read-Host "Paste the HyperFormula commercial license key"
if ([string]::IsNullOrWhiteSpace($licenseKey)) {
  throw "No license key was supplied. Nothing was written."
}

$target = Join-Path $PSScriptRoot "..\apps\web\.env.production.local"
Set-Content -LiteralPath $target -Value "VITE_HYPERFORMULA_LICENSE_KEY=$licenseKey" -NoNewline
Write-Host "HyperFormula production license configuration saved locally. Run npm run deploy:api to build and deploy it."
