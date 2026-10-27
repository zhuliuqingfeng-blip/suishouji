$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'identity.ps1')
function List-MemoFiles([string]$root,[string]$directory){
  foreach($item in Get-ChildItem -LiteralPath $directory -Force){
    if($item.Attributes-band [IO.FileAttributes]::ReparsePoint){throw 'Links are not supported'}
    if($item.PSIsContainer){List-MemoFiles $root $item.FullName}else{$item.FullName.Substring($root.Length+1)}
  }
}
try{
  $data=$env:MEMO_INSTALLER_DATA;if(Test-MemoInitialized $data){exit 0}
  $work=Join-Path ([IO.Path]::GetDirectoryName($data)) ('.'+[IO.Path]::GetFileName($data)+'-迁移');$pending=Join-Path $work 'installer-pending.json'
  if(Test-Path -LiteralPath $pending){exit 0}
  $source=$env:MEMO_LEGACY_SOURCE;if(-not $source){exit 0}
  if(-not (Test-MemoDatabase $source)){throw 'Invalid legacy database'}
  if((Test-Path -LiteralPath (Join-Path $source 'notes.sqlite-journal'))-or (Test-Path -LiteralPath (Join-Path $source 'notes.sqlite-wal'))){throw 'Legacy database has not closed'}
  $operation=Join-Path (Join-Path $work 'prepared') ([guid]::NewGuid().ToString());$backup=Join-Path $operation 'source';[IO.Directory]::CreateDirectory($backup)|Out-Null
  $files=@(List-MemoFiles $source $source|Sort-Object);$manifest=@()
  foreach($relative in $files){
    $from=Join-Path $source $relative;$to=Join-Path $backup $relative;[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($to))|Out-Null;[IO.File]::Copy($from,$to,$false)
    $hash=(Get-MemoFileHash $from)
    if($hash-ne (Get-MemoFileHash $to)){throw 'Copy validation failed'}
    $manifest+=@{file=$relative;sha256=$hash}
  }
  if(($files-join "`n")-ne (@(List-MemoFiles $source $source|Sort-Object)-join "`n")){throw 'Legacy files changed'}
  foreach($entry in $manifest){if((Get-MemoFileHash (Join-Path $source $entry.file))-ne $entry.sha256){throw 'Legacy data changed'}}
  Write-MemoJson (Join-Path $operation 'manifest.json') @{source=$source;files=$manifest;at=[DateTime]::UtcNow.ToString('o')}
  Write-MemoJson $pending @{source=$source;backup=$backup;program=$env:MEMO_INSTALLER_DIR;at=[DateTime]::UtcNow.ToString('o')}
  exit 0
}catch{try{Write-MemoJson (Join-Path $work 'prepare-error.json') @{error=$_.Exception.Message;position=$_.InvocationInfo.PositionMessage}}catch{};exit 21}
