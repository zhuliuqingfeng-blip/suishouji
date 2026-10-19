import {appRoot,repoRoot,installedApp,stagedApp,backupsRoot} from './paths.mjs';
process.chdir(appRoot);
import fs from 'node:fs/promises';
import path from 'node:path';
import {Store,sha256} from '../dist-electron/store.js';
import {createBackup} from '../dist-electron/archive.js';
const workspace=repoRoot,installed=installedApp,staged=stagedApp;
const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
const backupRoot=path.join(backupsRoot,new Date().toISOString().replace(/[:.]/g,'-'));
const previous=path.join(backupRoot,'旧程序'),data=path.join(installed,'我的数据');
for(const target of [installed,staged,backupRoot]){const relative=path.relative(workspace,target);if(relative.startsWith('..')||path.isAbsolute(relative)||!relative)throw new Error('升级路径不在当前工作目录内');}
await fs.access(path.join(staged,'resources','app.asar'));await fs.access(path.join(installed,'随手记.exe'));
await fs.mkdir(backupRoot,{recursive:true});
const store=new Store(data);let counts;
try{counts=store.overview();await createBackup(store,path.join(backupRoot,'升级前完整数据.zip'));}finally{store.close();}
async function fingerprint(root){const files=['notes.sqlite'];for(const name of await fs.readdir(path.join(root,'attachments')))files.push(`attachments/${name}`);const hashes=[];for(const file of files.sort())hashes.push([file,await sha256(path.join(root,file))]);return JSON.stringify(hashes);}
const before=await fingerprint(data);
async function move(from,to){for(let i=0;;i++){try{return await fs.rename(from,to);}catch(error){if(i>=50)throw error;await new Promise(r=>setTimeout(r,200));}}}
let oldMoved=false,newInstalled=false,dataMoved=false;
try{
 await move(installed,previous);oldMoved=true;
 await move(staged,installed);newInstalled=true;
 const targetData=path.join(installed,'我的数据');
 try{await fs.rmdir(targetData);}catch(error){if(error.code!=='ENOENT')throw error;}
 await move(path.join(previous,'我的数据'),targetData);dataMoved=true;
 if(await fingerprint(targetData)!==before)throw new Error('升级后的数据库或附件校验不一致');
 const report={version,upgradedAt:new Date().toISOString(),activeNotes:counts.active,trashNotes:counts.trash,dataPreserved:true,backupRoot};
 await fs.writeFile(path.join(backupRoot,'升级校验.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){
 if(dataMoved)await move(path.join(installed,'我的数据'),path.join(previous,'我的数据'));
 if(newInstalled)await move(installed,staged);
 if(oldMoved)await move(previous,installed);
 throw error;
}
