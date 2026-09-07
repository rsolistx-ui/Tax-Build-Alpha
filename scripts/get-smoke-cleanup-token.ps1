# Loads SMOKE_CLEANUP_TOKEN into the current process scope.
#
# Resolution order:
#   1. $env:SMOKE_CLEANUP_TOKEN if already set (no-op).
#   2. The Windows DPAPI (CurrentUser)-protected credential at
#      %LOCALAPPDATA%\Folio\secrets\smoke_cleanup_token.dpapi, decrypted and
#      set into process scope only.
#
# Never echoes or logs the credential. Returns $true/$false; sets
# $env:SMOKE_CLEANUP_TOKEN as a side effect on success.

function Import-SmokeCleanupToken {
  if ($env:SMOKE_CLEANUP_TOKEN) {
    return $true
  }

  $secretPath = Join-Path $env:LOCALAPPDATA "Folio\secrets\smoke_cleanup_token.dpapi"
  if (-not (Test-Path $secretPath)) {
    return $false
  }

  try {
    Add-Type -AssemblyName System.Security -ErrorAction Stop
    $protected = [System.IO.File]::ReadAllBytes($secretPath)
    $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
      $protected,
      $null,
      [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $value = [System.Text.Encoding]::UTF8.GetString($bytes)
    if ([string]::IsNullOrWhiteSpace($value)) {
      return $false
    }
    $env:SMOKE_CLEANUP_TOKEN = $value
    return $true
  } catch {
    # Decryption fails if the file is missing, corrupt, or was protected
    # under a different Windows user account. Treat all failures the same:
    # no credential available, never surface the underlying error detail
    # since it could leak into logs.
    return $false
  }
}

# Allow direct invocation (pwsh scripts/get-smoke-cleanup-token.ps1) as a
# standalone preflight check, in addition to dot-sourcing the function.
if ($MyInvocation.InvocationName -ne '.') {
  if (Import-SmokeCleanupToken) {
    Write-Host "SMOKE_CLEANUP_TOKEN is available in this process."
    exit 0
  } else {
    Write-Host "SMOKE_CLEANUP_TOKEN is not available (not in env, no usable DPAPI credential)."
    exit 1
  }
}
