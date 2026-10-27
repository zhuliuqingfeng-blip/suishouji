import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute = promisify(execFile);
export async function ensureLegacyClosed(root: string) {
  if (process.platform !== 'win32') return;
  const script = "$ErrorActionPreference='Stop'; $folder=$env:MEMO_LEGACY_FOLDER; $found=@(Get-Process | Where-Object { $_.Path -and [IO.Path]::GetDirectoryName($_.Path) -eq $folder }); if($found.Count -gt 0){exit 3}";
  try { await execute('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',script],{
    windowsHide:true,timeout:15000,env:{...process.env,MEMO_LEGACY_FOLDER:path.dirname(root)}
  }); } catch (error) {
    if ((error as {code?: number}).code === 3) throw new Error('旧版随手记还在运行。请先等待保存完成，关闭旧版窗口，再重新导入');
    throw new Error('暂时无法确认旧版是否已退出，已停止导入。请关闭旧版后重试');
  }
}
