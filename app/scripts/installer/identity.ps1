function Read-MemoPackage([string]$archive) {
  $stream=[IO.File]::Open($archive,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
  try {
    $reader=[IO.BinaryReader]::new($stream);$prefix=$reader.ReadBytes(8)
    if($prefix.Length-ne 8){return $null};$size=[BitConverter]::ToUInt32($prefix,4)
    if($size-lt 8-or $size-gt 16777216){return $null};$header=$reader.ReadBytes($size)
    if($header.Length-ne $size){return $null};$length=[BitConverter]::ToUInt32($header,4)
    if($length-gt $size-8){return $null}
    $tree=[Text.Encoding]::UTF8.GetString($header,8,$length)|ConvertFrom-Json;$entry=$tree.files.'package.json'
    if(-not $entry-or $entry.unpacked-or $entry.link-or $entry.size-gt 1048576){return $null}
    $offset=8+[long]$size+[long]$entry.offset
    if($offset-lt 8-or $offset+$entry.size-gt $stream.Length){return $null}
    $stream.Position=$offset
    return ([Text.Encoding]::UTF8.GetString($reader.ReadBytes($entry.size))|ConvertFrom-Json)
  }finally{$stream.Dispose()}
}
function Get-MemoIdentity([string]$folder) {
  try {
    $exe=Join-Path $folder '随手记.exe';$archive=Join-Path $folder 'resources\app.asar'
    if(-not (Test-Path -LiteralPath $exe)-or -not (Test-Path -LiteralPath $archive)){return $null}
    $version=[Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
    if($version.ProductName-ne '随手记'-or $version.ProductVersion-notmatch '^\d+\.\d+\.\d+'){return $null}
    $package=Read-MemoPackage $archive
    if($package.name-ne 'suishouji'-or $package.main-ne 'dist-electron/main.js'-or $package.version-notmatch '^\d+\.\d+\.\d+'){return $null}
    $data=Join-Path $folder '我的数据';$kind='installed'
    if($package.distribution-ne 'installed'-or (Test-Path -LiteralPath (Join-Path $data 'notes.sqlite'))){$kind='portable'}
    return @{kind=$kind;root=$folder;exe=$exe;data=$data;version=$package.version}
  }catch{return $null}
}
function Test-MemoDatabase([string]$root) {
  $file=Join-Path $root 'notes.sqlite';if(-not (Test-Path -LiteralPath $file)){return $false}
  $s=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
  try{$b=New-Object byte[] 16;return $s.Read($b,0,16)-eq 16-and [Text.Encoding]::ASCII.GetString($b)-eq "SQLite format 3`0"}finally{$s.Dispose()}
}
function Test-MemoInitialized([string]$root) {
  foreach($name in @('.安装引导完成','安装迁移状态.json','迁移记录.json')){if(Test-Path -LiteralPath (Join-Path $root $name)){return $true}};return $false
}
function Write-MemoJson([string]$file,$value) {
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file))|Out-Null
  $temp=$file+'.tmp';$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($value|ConvertTo-Json -Depth 12))
  $s=[IO.File]::Open($temp,[IO.FileMode]::Create,[IO.FileAccess]::Write)
  try{$s.Write($bytes,0,$bytes.Length);$s.Flush($true)}finally{$s.Dispose()}
  if(Test-Path -LiteralPath $file){[IO.File]::Replace($temp,$file,$null)}else{[IO.File]::Move($temp,$file)}
}

function Get-MemoFileHash([string]$file) {
  $long=$file
  if(-not $long.StartsWith('\\?\')){
    if($long.StartsWith('\\')){$long='\\?\UNC\'+$long.Substring(2)}else{$long='\\?\'+[IO.Path]::GetFullPath($long)}
  }
  $stream=[IO.File]::OpenRead($long);$algorithm=[Security.Cryptography.SHA256]::Create()
  try{return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$algorithm.Dispose()}
}

function Find-MemoIdentity([string]$folder) {
  $found=Get-MemoIdentity $folder
  if($found){return $found}
  foreach($relative in @('随手记','suishouji','release\随手记')){
    $found=Get-MemoIdentity (Join-Path $folder $relative)
    if($found){return $found}
  }
  return $null
}
