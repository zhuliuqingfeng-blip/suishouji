$ErrorActionPreference = 'Stop'
# Validate before uninstalling the previous copy. Return codes map to installer messages.
try {
  $memoDestination = [IO.Path]::GetFullPath($env:MEMO_INSTALLER_DIR).TrimEnd('\')
  $memoData = [IO.Path]::GetFullPath($env:MEMO_INSTALLER_DATA).TrimEnd('\')
  if ($memoDestination -eq [IO.Path]::GetPathRoot($memoDestination).TrimEnd('\')) { exit 11 }
  if ($memoDestination -eq $memoData -or $memoDestination.StartsWith($memoData+'\',[StringComparison]::OrdinalIgnoreCase) -or $memoData.StartsWith($memoDestination+'\',[StringComparison]::OrdinalIgnoreCase)) { exit 11 }
  $memoAncestor = $memoDestination
  while ($memoAncestor) {
    if (Test-Path -LiteralPath $memoAncestor) {
      $memoItem = Get-Item -LiteralPath $memoAncestor -Force
      if (-not $memoItem.PSIsContainer -or ($memoItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { exit 11 }
    }
    $memoAncestor = [IO.Path]::GetDirectoryName($memoAncestor)
  }
  if ((Test-Path -LiteralPath (Join-Path $memoDestination 'notes.sqlite')) -or (Test-Path -LiteralPath (Join-Path $memoDestination '我的数据\notes.sqlite'))) { exit 11 }
  $memoRegistered = $env:MEMO_INSTALLED_DIR
  $memoOwned = $false
  if ($memoRegistered) { $memoOwned = $memoDestination -eq [IO.Path]::GetFullPath($memoRegistered).TrimEnd('\') }
  $memoMarker = Join-Path $memoDestination '.suishouji-install-root.json'
  if (Test-Path -LiteralPath $memoMarker) {
    $memoIdentity = Get-Content -LiteralPath $memoMarker -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($memoIdentity.format -eq 'suishouji-install-root' -and $memoIdentity.version -eq 1) { $memoOwned = $true }
  }
  if (-not $memoOwned -and (Test-Path -LiteralPath $memoDestination) -and @(Get-ChildItem -LiteralPath $memoDestination -Force).Count -gt 0) { exit 12 }
  [IO.Directory]::CreateDirectory($memoDestination) | Out-Null
  $memoProbe = Join-Path $memoDestination ('.suishouji-write-check-'+[guid]::NewGuid().ToString())
  $memoStream = [IO.File]::Open($memoProbe,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
  $memoStream.Dispose()
  [IO.File]::Delete($memoProbe)
  exit 0
} catch { exit 13 }
