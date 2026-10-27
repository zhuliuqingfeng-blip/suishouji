import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {emptyData,importWorkDir,importLegacyData,legacyRoot,recoverLegacyImport} from './legacy-import.js';
import {sha256} from './store.js';

const stateName='安装迁移状态.json',pendingName='installer-pending.json';
function atomic(file:string,value:unknown){
  fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2));
  const fd=fs.openSync(temp,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);
}
export function installedDataInitialized(root:string){
  return ['.安装引导完成','迁移记录.json',stateName].some(name=>fs.existsSync(path.join(root,name)))||!emptyData(root);
}
export function pendingInstallerMigration(root:string){return fs.existsSync(path.join(importWorkDir(root),pendingName));}
function stable(value:unknown):unknown {
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)]));
  return value;
}
export async function dataFingerprint(root:string){
  const db=new DatabaseSync(path.join(root,'notes.sqlite'),{readOnly:true});
  try{
    const rows=(table:string,order='id')=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)?db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all():[];
    const notes=rows('notes'),assets=rows('attachments'),days=rows('important_days').map(row=>({...row,isLeapMonth:row.isLeapMonth??0})),reminders=rows('day_reminders','key');
    const files=[];
    for(const asset of assets){const relative=String(asset.relativePath);if(!/^attachments\/[a-f\d-]{36}\.[a-z0-9]{1,10}$/.test(relative))throw new Error('旧版附件路径无效');files.push([relative,await sha256(path.join(root,...relative.split('/')))]);}
    return createHash('sha256').update(JSON.stringify(stable({notes,assets,days,reminders,files}))).digest('hex');
  }finally{db.close();}
}
interface Pending {source:string;backup:string;program:string}
async function validatePrepared(backup:string){
  const manifest=JSON.parse(await fsp.readFile(path.join(path.dirname(backup),'manifest.json'),'utf8')) as {files:{file:string;sha256:string}[]};
  if(!Array.isArray(manifest.files)||!manifest.files.length)throw new Error('迁移前备份清单无效');
  const seen=new Set<string>();
  for(const entry of manifest.files){
    if(typeof entry.file!=='string'||!entry.file||!entry.sha256?.match(/^[a-f\d]{64}$/i))throw new Error('迁移前备份清单无效');
    const file=path.resolve(backup,entry.file),relative=path.relative(backup,file);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||seen.has(relative))throw new Error('迁移备份含有无效路径');
    seen.add(relative);if((await fsp.lstat(file)).isSymbolicLink()||await sha256(file)!==entry.sha256.toLowerCase())throw new Error('迁移前备份校验失败，旧版原件仍保留');
  }
  if(!seen.has('notes.sqlite'))throw new Error('迁移前备份缺少数据库');
  async function inspect(directory:string):Promise<number>{
    let count=0;
    for(const entry of await fsp.readdir(directory,{withFileTypes:true})){
      const file=path.join(directory,entry.name);
      if(entry.isSymbolicLink())throw new Error('迁移备份不支持链接');
      if(entry.isDirectory())count+=await inspect(file);
      else {if(!seen.has(path.relative(backup,file)))throw new Error('迁移备份与清单不一致');count++;}
    }
    return count;
  }
  if(await inspect(backup)!==seen.size)throw new Error('迁移备份不完整');
}
function readPending(root:string):Pending {
  const pending=JSON.parse(fs.readFileSync(path.join(importWorkDir(root),pendingName),'utf8')) as Pending;
  if(!pending||![pending.source,pending.backup,pending.program].every(value=>typeof value==='string'&&path.isAbsolute(value)))throw new Error('安装迁移记录无效，旧版资料仍保留');
  const prepared=path.join(importWorkDir(root),'prepared'),relative=path.relative(prepared,pending.backup);
  if(!/^[a-f\d-]{36}[\\/]source$/.test(relative))throw new Error('迁移备份路径无效');
  return pending;
}
export async function completeInstallerMaintenance(options:{dataDir:string;programDir:string;version:string;appId:string;guid:string}){
  const {dataDir,programDir,version,appId,guid}=options;
  fs.mkdirSync(dataDir,{recursive:true});recoverLegacyImport(dataDir);
  let result:{status:string;source?:string;backupRoot?:string;fingerprint?:string}={status:'fresh'};
  const pendingFile=path.join(importWorkDir(dataDir),pendingName);
  if(fs.existsSync(pendingFile)){
    const pending=readPending(dataDir);
    if(installedDataInitialized(dataDir)){
      // Existing installation data always wins, even when a Portable was discovered.
      result={status:'kept-existing',source:pending.source};
      try{const previous=JSON.parse(fs.readFileSync(path.join(dataDir,'迁移记录.json'),'utf8'));if(previous.from===pending.source)result={status:'migrated',source:pending.source,backupRoot:previous.backup};}catch{}
    }else{
      await validatePrepared(pending.backup);
      legacyRoot(pending.backup,dataDir);
      const expected=await dataFingerprint(pending.backup);
      const imported=await importLegacyData(dataDir,pending.backup,{
        origin:pending.source,ensureClosed:async()=>{},
        verify:async target=>{if(await dataFingerprint(target)!==expected)throw new Error('迁移结果与备份不一致，已回退，旧版原件仍保留');}
      });
      result={status:'migrated',source:pending.source,backupRoot:imported.backupRoot,fingerprint:expected};
    }
    atomic(path.join(dataDir,stateName),{...result,initialized:true,at:new Date().toISOString()});
    fs.writeFileSync(path.join(dataDir,'.安装引导完成'),'1');
    await fsp.rm(pendingFile,{force:true});
  }else if(installedDataInitialized(dataDir)){
    result={status:'existing'};
    if(!fs.existsSync(path.join(dataDir,stateName)))atomic(path.join(dataDir,stateName),{status:'existing',initialized:true,at:new Date().toISOString()});
    if(!fs.existsSync(path.join(dataDir,'.安装引导完成')))fs.writeFileSync(path.join(dataDir,'.安装引导完成'),'1');
  }
  atomic(path.join(dataDir,'安装记录.json'),{appId,guid,programDir,version,at:new Date().toISOString()});
  return result;
}
