$ErrorActionPreference = 'Stop'
# Only close this installed copy. Never terminate a process or another Portable copy.
$memoTargetExe = $env:MEMO_INSTALLER_EXE
if (-not $memoTargetExe) { exit 2 }
$memoProcesses = @(Get-Process | Where-Object { $_.Path -eq $memoTargetExe })
foreach ($memoProcess in $memoProcesses) {
  if ($memoProcess.MainWindowHandle -ne 0) { $null = $memoProcess.CloseMainWindow() }
}
$memoWatch = [Diagnostics.Stopwatch]::StartNew()
while (@(Get-Process | Where-Object { $_.Path -eq $memoTargetExe }).Count -gt 0) {
  if ($memoWatch.Elapsed.TotalSeconds -gt 25) { exit 2 }
  Start-Sleep -Milliseconds 200
}
exit 0
