import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store,sha256} from '../electron/store.js';
import {importWorkDir,importLegacyData,emptyData} from '../electron/legacy-import.js';
import {completeInstallerMaintenance,dataFingerprint} from '../electron/installer-maintenance.js';
import {testRoot} from '../scripts/paths.mjs';
await fs.mkdir(testRoot,{recursive:true});
async function tree(root:string,dir=root):Promise<string[]>{const result:string[]=[];for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())result.push(...await tree(root,file));else result.push(path.relative(root,file));}return result;}
async function fixture(){
  const root=await fs.mkdtemp(path.join(testRoot,'automatic-install-')),source=path.join(root,'旧版','我的数据'),target=path.join(root,'local','随手记');
  const store=new Store(source),note=store.create().note;store.save({...note,title:'应该自动迁移的手记',document:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'不用导出和恢复'}]}]}});
  store.saveImportantDay({name:'农历生日',calendar:'lunar',year:2000,month:8,day:15,isLeapMonth:false,yearly:true,reminderDays:14,note:''});
  const file=path.join(root,'附件.txt');await fs.writeFile(file,'独立副本');store.addFile(note.id,file);store.close();
  const prepared=path.join(importWorkDir(target),'prepared',randomUUID()),backup=path.join(prepared,'source');await fs.cp(source,backup,{recursive:true});
  const files=await Promise.all((await tree(backup)).map(async file=>({file,sha256:await sha256(path.join(backup,file))})));await fs.writeFile(path.join(prepared,'manifest.json'),JSON.stringify({files}));
  await fs.writeFile(path.join(importWorkDir(target),'installer-pending.json'),JSON.stringify({source,backup,program:path.join(root,'program')}));
  const options={dataDir:target,programDir:path.join(root,'program'),version:'1.8.2',appId:'local.suishouji.desktop',guid:'42be8a92-8942-4f4c-9e2c-90bd703acc4c'};
  return {root,source,target,backup,options};
}
test('安装结束自动校验并迁移备份，一次完成，原件不改动',async()=>{
  const f=await fixture(),original=await sha256(path.join(f.source,'notes.sqlite')),expected=await dataFingerprint(f.source);
  const result=await completeInstallerMaintenance(f.options);assert.equal(result.status,'migrated');assert.equal(await dataFingerprint(f.target),expected);assert.equal(await sha256(path.join(f.source,'notes.sqlite')),original);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.target,'迁移记录.json'),'utf8')).from,f.source);
  await assert.rejects(fs.access(path.join(importWorkDir(f.target),'installer-pending.json')));
  const operations=await fs.readdir(importWorkDir(f.target));
  const old=new Store(f.source);old.create();old.close();
  assert.equal((await completeInstallerMaintenance({...f.options,version:'1.9.0'})).status,'existing');assert.equal(await dataFingerprint(f.target),expected);assert.deepEqual(await fs.readdir(importWorkDir(f.target)),operations);
});
test('已有正式资料或用户选择过全新开始时，不允许Portable请求覆盖',async()=>{
  for(const populated of [false,true]){
    const f=await fixture(),store=new Store(f.target);if(populated)store.create();store.close();await fs.writeFile(path.join(f.target,'.安装引导完成'),'1');
    const before=await dataFingerprint(f.target);assert.equal((await completeInstallerMaintenance(f.options)).status,'kept-existing');assert.equal(await dataFingerprint(f.target),before);
  }
});
test('准备备份在安装中损坏时停止迁移并保留请求，原始资料仍可读取',async()=>{
  const f=await fixture(),original=await dataFingerprint(f.source);await fs.appendFile(path.join(f.backup,'notes.sqlite'),'损坏');
  await assert.rejects(completeInstallerMaintenance(f.options),/备份校验失败/);assert.equal(emptyData(f.target),true);assert.equal(await dataFingerprint(f.source),original);await fs.access(path.join(importWorkDir(f.target),'installer-pending.json'));
});
test('发布后校验失败在提交前回退，可重试，原始数据保持',async()=>{
  const f=await fixture(),store=new Store(f.target);store.close();const original=await sha256(path.join(f.target,'notes.sqlite'));
  await assert.rejects(importLegacyData(f.target,f.source,{ensureClosed:async()=>{},verify:async()=>{throw new Error('模拟最终校验失败');}}),/最终校验失败/);
  assert.equal(await sha256(path.join(f.target,'notes.sqlite')),original);assert.equal(emptyData(f.target),true);
  await completeInstallerMaintenance(f.options);assert.equal(await dataFingerprint(f.target),await dataFingerprint(f.source));
});
