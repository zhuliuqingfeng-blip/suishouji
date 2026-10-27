$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'identity.ps1')
try {
  $destination=[IO.Path]::GetFullPath($env:MEMO_INSTALLER_DIR).TrimEnd('\')
  $data=[IO.Path]::GetFullPath($env:MEMO_INSTALLER_DATA).TrimEnd('\')
  $registered=$env:MEMO_INSTALLED_DIR;$default=$env:MEMO_DEFAULT_DIR
  $initialized=Test-MemoInitialized $data;$source='';$legacyExe='';$reason='exact'
  $identity=Find-MemoIdentity $destination
  if(-not $identity-and (Test-Path -LiteralPath (Join-Path $destination 'notes.sqlite'))){
    $parent=Get-MemoIdentity ([IO.Path]::GetDirectoryName($destination))
    if($parent-and $parent.kind-eq 'portable'-and $parent.data-eq $destination){$identity=$parent}
  }
  if($identity-and $identity.kind-eq 'installed'){$destination=$identity.root}
  if($identity-and $identity.kind-eq 'portable'){
    $reason='portable'
    if(-not $initialized-and (Test-Path -LiteralPath (Join-Path $identity.data 'notes.sqlite'))){if(-not (Test-MemoDatabase $identity.data)){exit 22};$source=$identity.data;$legacyExe=$identity.exe}
    if($registered){$destination=$registered}else{$destination=$default}
  }
  if(-not $initialized-and -not $source){
    if($env:MEMO_SETUP_DIR){$found=Find-MemoIdentity $env:MEMO_SETUP_DIR;if($found-and $found.kind-eq 'portable'-and (Test-Path -LiteralPath (Join-Path $found.data 'notes.sqlite'))){if(-not (Test-MemoDatabase $found.data)){exit 22};$source=$found.data;$legacyExe=$found.exe}}
    if(-not $source-and $env:MEMO_SHORTCUT-and (Test-Path -LiteralPath $env:MEMO_SHORTCUT)){
      $shortcut=(New-Object -ComObject WScript.Shell).CreateShortcut($env:MEMO_SHORTCUT)
      if($shortcut.TargetPath){$found=Get-MemoIdentity ([IO.Path]::GetDirectoryName($shortcut.TargetPath));if($found-and $found.kind-eq 'portable'-and (Test-Path -LiteralPath (Join-Path $found.data 'notes.sqlite'))){if(-not (Test-MemoDatabase $found.data)){exit 22};$source=$found.data;$legacyExe=$found.exe}}
    }
  }
  $destination=[IO.Path]::GetFullPath($destination).TrimEnd('\')
  if($destination-eq $data-or $destination.StartsWith($data+'\',[StringComparison]::OrdinalIgnoreCase)-or $data.StartsWith($destination+'\',[StringComparison]::OrdinalIgnoreCase)){exit 11}
  $ancestor=$destination
  while($ancestor){if(Test-Path -LiteralPath $ancestor){$item=Get-Item -LiteralPath $ancestor -Force;if(-not $item.PSIsContainer-or ($item.Attributes-band [IO.FileAttributes]::ReparsePoint)){exit 11}};$ancestor=[IO.Path]::GetDirectoryName($ancestor)}
  $targetIdentity=Get-MemoIdentity $destination
  if((Test-Path -LiteralPath (Join-Path $destination 'notes.sqlite'))-or (Test-Path -LiteralPath (Join-Path $destination '我的数据\notes.sqlite'))){exit 11}
  $owned=$registered-and $destination-eq [IO.Path]::GetFullPath($registered).TrimEnd('\')
  if($targetIdentity-and $targetIdentity.kind-eq 'installed'){$owned=$true}
  $receipt=Join-Path $data '安装记录.json'
  if(-not $owned-and (Test-Path -LiteralPath $receipt)){$old=Get-Content -LiteralPath $receipt -Raw -Encoding UTF8|ConvertFrom-Json;if($old.appId-eq $env:MEMO_APP_ID-and $old.guid-eq $env:MEMO_APP_GUID-and $old.programDir-eq $destination){$owned=$true}}
  # A selected software container is not itself owned by the installer. Always use
  # an application child, even for an empty container; preserve exact owned paths.
  $leaf=[IO.Path]::GetFileName($destination)
  if(-not $owned-and $reason-ne 'portable'-and $leaf-notin @('随手记','suishouji')){
    $destination=Join-Path ($destination+'\') '随手记';$reason='subfolder'
  }
  if($destination-eq [IO.Path]::GetPathRoot($destination).TrimEnd('\')){exit 11}
  if($destination-eq $data-or $destination.StartsWith($data+'\',[StringComparison]::OrdinalIgnoreCase)-or $data.StartsWith($destination+'\',[StringComparison]::OrdinalIgnoreCase)){exit 11}
  if(Test-Path -LiteralPath $destination){
    $item=Get-Item -LiteralPath $destination -Force
    if(-not $item.PSIsContainer-or ($item.Attributes-band [IO.FileAttributes]::ReparsePoint)){exit 11}
    if(-not $owned-and @(Get-ChildItem -LiteralPath $destination -Force).Count-gt 0){exit 12}
  }
  if($env:MEMO_LOCATION_PREVIEW-ne '1'){
    [IO.Directory]::CreateDirectory($destination)|Out-Null
    $probe=Join-Path $destination ('.suishouji-write-check-'+[guid]::NewGuid());$s=[IO.File]::Open($probe,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write);$s.Dispose();[IO.File]::Delete($probe)
  }
  if($initialized){$source='';$legacyExe=''}
  $content="[plan]`r`nprogram=$destination`r`nsource=$source`r`nlegacyExe=$legacyExe`r`nreason=$reason`r`n"
  [IO.File]::WriteAllText($env:MEMO_PLAN_FILE,$content,[Text.Encoding]::Unicode)
  exit 0
}catch{exit 13}
