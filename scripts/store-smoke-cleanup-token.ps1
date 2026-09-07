# One-time (or occasional) store: encrypts the value currently in
# $env:SMOKE_CLEANUP_TOKEN with Windows DPAPI (CurrentUser) and writes only
# the encrypted blob to %LOCALAPPDATA%\Folio\secrets\smoke_cleanup_token.dpapi.
#
# Usage: set $env:SMOKE_CLEANUP_TOKEN in the current shell first, then run
# this script. The token is never accepted as a command-line argument (that
# would leak it into shell history) and is never printed.
#
# Windows-only by design: fails outright on other platforms rather than
# falling back to plaintext storage.

if ($PSVersionTable.PSVersion -and -not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') {
  Write-Error "store-smoke-cleanup-token.ps1 requires Windows (DPAPI is Windows-only). Refusing to fall back to plaintext storage."
  exit 1
}

if (-not $env:SMOKE_CLEANUP_TOKEN) {
  Write-Error "SMOKE_CLEANUP_TOKEN must already be set in the current process environment before running this script. It is never accepted as a command-line argument."
  exit 1
}

try {
  $secretDir = Join-Path $env:LOCALAPPDATA "Folio\secrets"
  New-Item -ItemType Directory -Force -Path $secretDir -ErrorAction Stop | Out-Null

  Add-Type -AssemblyName System.Security -ErrorAction Stop
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($env:SMOKE_CLEANUP_TOKEN)
  $protected = [System.Security.Cryptography.ProtectedData]::Protect(
    $bytes,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )

  $destPath = Join-Path $secretDir "smoke_cleanup_token.dpapi"
  [System.IO.File]::WriteAllBytes($destPath, $protected)

  Write-Host "SMOKE_CLEANUP_TOKEN persisted (encrypted, CurrentUser DPAPI) to $destPath"
  exit 0
} catch {
  Write-Error "Failed to persist SMOKE_CLEANUP_TOKEN via DPAPI: $($_.Exception.GetType().Name)"
  exit 1
}
