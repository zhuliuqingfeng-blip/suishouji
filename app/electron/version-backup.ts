import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createClosedBackup,validateBackup} from './archive.js';

// Run before Store can upgrade a schema. A failed backup must stop startup.
export async function backupBeforeVersion(root: string, version: string) {
  const marker = path.join(root,'程序版本.json');
  let previous: string | null = null;
  try { previous = JSON.parse(await fsp.readFile(marker,'utf8')).version; } catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT') throw new Error('无法读取资料版本记录，请保留数据文件夹并重试'); }
  if(previous===version || !fs.existsSync(path.join(root,'notes.sqlite'))) return;
  const directory = path.join(root,'升级前备份');await fsp.mkdir(directory,{recursive:true});
  const safe=(value:string)=>value.replace(/[^a-zA-Z\d.-]/g,'_');
  const destination=path.join(directory,`${safe(previous||'首次安装')}-至-${safe(version)}-${Date.now()}.zip`);
  await createClosedBackup(root,destination);
  const checked=await validateBackup(destination);await fsp.rm(checked.stage,{recursive:true,force:true});
}
export function rememberVersion(root: string,version: string) {
  const file=path.join(root,'程序版本.json'),temp=file+'.tmp';
  fs.writeFileSync(temp,JSON.stringify({version},null,2));fs.renameSync(temp,file);
}
