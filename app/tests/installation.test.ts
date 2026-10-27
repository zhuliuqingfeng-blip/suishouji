import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {testRoot,appRoot} from '../scripts/paths.mjs';
import {Store,sha256} from '../electron/store.js';
import {storageLocation} from '../electron/storage-location.js';
import {emptyData,legacyRoot,importLegacyData,importWorkDir,recoverLegacyImport,requestLegacyImport,pendingLegacyImport} from '../electron/legacy-import.js';
import {backupBeforeVersion,rememberVersion} from '../electron/version-backup.js';
import {validateBackup} from '../electron/archive.js';
await fs.mkdir(testRoot,{recursive:true});
const closed=async()=>{};
async function fixture(){
  const root=await fs.mkdtemp(path.join(testRoot,'installation-')),source=path.join(root,'旧版','我的数据'),target=path.join(root,'用户资料','随手记');
  const store=new Store(source),first=store.create().note,trash=store.create().note;
  store.save({...first,title:'一段值得留下的文字',tags:['生活'],document:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'图片和文件也要带过来'}]}]}});
  store.pin(first.id,true);store.trash(trash.id);
  const original=path.join(root,'附件.txt');await fs.writeFile(original,'独立的附件副本');store.addFile(first.id,original);
  const day=store.saveImportantDay({name:'农历生日',calendar:'lunar',year:2000,month:8,day:15,isLeapMonth:false,yearly:true,reminderDays:14,note:'家庭纪念'});
  store.close();
  await fs.mkdir(path.join(source,'.运行缓存','Local Storage','leveldb'),{recursive:true});
  await fs.writeFile(path.join(source,'.运行缓存','window-state.json'),'原来的窗口位置');
  await fs.writeFile(path.join(source,'.运行缓存','Local Storage','leveldb','settings'),'排序与布局');
  await fs.mkdir(path.join(source,'.运行缓存','GPUCache'),{recursive:true});await fs.writeFile(path.join(source,'.运行缓存','GPUCache','volatile'),'不迁移缓存');
  await fs.mkdir(path.join(source,'自动备份'),{recursive:true});await fs.writeFile(path.join(source,'自动备份','以前的备份.zip'),'历史备份原样保留');
  return {root,source,target,first,day};
}
test('安装版资料目录与版本及安装路径无关，Portable、开发与隔离测试各自独立',()=>{
  const base={packaged:true,distribution:'installed',exe:path.resolve('程序1/随手记.exe'),localAppData:path.resolve('用户/AppData/Local'),developmentRoot:appRoot};
  const location=storageLocation(base);assert.equal(location.dataDir,path.join(base.localAppData,'随手记'));
  assert.deepEqual(storageLocation({...base,exe:path.resolve('程序2/随手记.exe')}),location);
  assert.equal(storageLocation({...base,distribution:'portable'}).dataDir,path.resolve('程序1/我的数据'));
  assert.equal(storageLocation({...base,packaged:false}).distribution,'development');
  assert.equal(storageLocation({...base,testMode:true,testData:path.resolve('测试资料')}).distribution,'test');
  assert.deepEqual(storageLocation({...base,testMode:false,testData:path.resolve('误设环境变量')}),location);
});
test('旧版导入保留手记、回收站、附件、农历日子、设置及备份，原件哈希不变',async()=>{
  const f=await fixture(),hash=await sha256(path.join(f.source,'notes.sqlite'));
  assert.equal(legacyRoot(path.dirname(f.source),f.target).root,f.source);
  const imported=await importLegacyData(f.target,f.source,{ensureClosed:closed});
  const next=new Store(f.target);assert.equal(next.list().length,1);assert.equal(next.list({trash:true}).length,1);assert.equal(next.get(f.first.id).note.pinned,true);assert.deepEqual(next.listImportantDays(),[f.day]);assert.equal(await fs.readFile(next.assetPath(next.allAssets()[0]),'utf8'),'独立的附件副本');next.close();
  assert.equal(await sha256(path.join(f.source,'notes.sqlite')),hash);
  for(const relative of ['.运行缓存/window-state.json','.运行缓存/Local Storage/leveldb/settings','自动备份/以前的备份.zip'])assert.equal(await fs.readFile(path.join(f.target,relative),'utf8'),await fs.readFile(path.join(f.source,relative),'utf8'));
  await assert.rejects(fs.access(path.join(f.target,'.运行缓存','GPUCache')));
  const backup=await validateBackup(path.join(imported.backupRoot,'迁移前完整数据.zip'));assert.equal(backup.count,2);assert.equal(backup.dayCount,1);
});
test('已有手记、重要日子或遗留附件时拒绝覆盖，原目标与源数据均保留',async()=>{
  for(const kind of ['notes','days','assets']){
    const f=await fixture();
    if(kind==='assets'){await fs.mkdir(path.join(f.target,'attachments'),{recursive:true});await fs.writeFile(path.join(f.target,'attachments','遗留资料'),'保留');}
    else {const store=new Store(f.target);if(kind==='notes')store.create();else store.saveImportantDay({...f.day,id:undefined});store.close();}
    assert.equal(emptyData(f.target),false);await assert.rejects(importLegacyData(f.target,f.source,{ensureClosed:closed}),/已有资料/);assert.throws(()=>requestLegacyImport(f.target,f.source),/已有手记/);
  }
});
test('迁移拒绝重叠目录、无效数据库和缺失附件，不删除原件',async()=>{
  const f=await fixture();assert.throws(()=>legacyRoot(f.source,f.source),/当前资料|独立/);assert.throws(()=>legacyRoot(f.root,f.target),/上级目录|独立/);
  const store=new Store(f.source),asset=store.allAssets()[0];store.close();await fs.unlink(path.join(f.source,asset.relativePath));
  await assert.rejects(importLegacyData(f.target,f.source,{ensureClosed:closed}));assert.equal(emptyData(f.target),true);await fs.access(path.join(f.source,'notes.sqlite'));
  await fs.writeFile(path.join(f.root,'损坏.sqlite'),'broken');await fs.mkdir(path.join(f.root,'损坏'),{recursive:true});await fs.copyFile(path.join(f.root,'损坏.sqlite'),path.join(f.root,'损坏','notes.sqlite'));assert.throws(()=>legacyRoot(path.join(f.root,'损坏'),f.target));
});
test('旧版仍运行或复制期间变化时中止，目标仍为空',async()=>{
  const f=await fixture();await assert.rejects(importLegacyData(f.target,f.source,{ensureClosed:async()=>{throw new Error('旧版仍运行');}}),/仍运行/);
  let calls=0;await assert.rejects(importLegacyData(f.target,f.source,{ensureClosed:async()=>{if(++calls===2)await fs.writeFile(path.join(f.source,'自动备份','以前的备份.zip'),'已经变化');}}),/发生变化/);assert.equal(emptyData(f.target),true);
});
test('迁移发布时发生IO错误，会恢复原空资料及原设置，可再次导入',async()=>{
  const f=await fixture(),empty=new Store(f.target);empty.close();await fs.mkdir(path.join(f.target,'.运行缓存'),{recursive:true});await fs.writeFile(path.join(f.target,'.运行缓存','window-state.json'),'安装版原设置');
  const hash=await sha256(path.join(f.target,'notes.sqlite'));
  await assert.rejects(importLegacyData(f.target,f.source,{ensureClosed:closed,checkpoint:step=>{if(step==='installed:notes.sqlite')throw new Error('模拟写入失败');}}),/模拟写入失败/);
  assert.equal(await sha256(path.join(f.target,'notes.sqlite')),hash);assert.equal(await fs.readFile(path.join(f.target,'.运行缓存','window-state.json'),'utf8'),'安装版原设置');
  await importLegacyData(f.target,f.source,{ensureClosed:closed});assert.equal(emptyData(f.target),false);
});
test('进程在迁移中断电式退出，启动恢复按日志回退；提交后退出保留完整新资料',async()=>{
  for(const step of ['prepared','old-moved:notes.sqlite','installed:notes.sqlite','committed']){
    const f=await fixture(),empty=new Store(f.target);empty.close();const before=await sha256(path.join(f.target,'notes.sqlite'));requestLegacyImport(f.target,f.source);
    const module=pathToFileURL(path.join(appRoot,'electron','legacy-import.ts')).href;
    const script=`import {importLegacyData} from ${JSON.stringify(module)}; await importLegacyData(process.argv[1],process.argv[2],{ensureClosed:async()=>{},checkpoint:s=>{if(s===process.argv[3])process.exit(86);}});`;
    const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script,f.target,f.source,step],{cwd:appRoot,encoding:'utf8'});
    assert.equal(child.status,86,child.stderr);recoverLegacyImport(f.target);recoverLegacyImport(f.target);
    if(step==='committed'){assert.equal(emptyData(f.target),false);assert.equal(pendingLegacyImport(f.target),null);}else{assert.equal(await sha256(path.join(f.target,'notes.sqlite')),before);assert.equal(emptyData(f.target),true);}
    await fs.access(path.join(f.source,'notes.sqlite'));
  }
});
test('迁移日志不允许引用目标目录之外的文件',async()=>{
  const f=await fixture(),work=importWorkDir(f.target);await fs.mkdir(work,{recursive:true});await fs.writeFile(path.join(work,'journal.json'),JSON.stringify({id:'42be8a92-8942-4f4c-9e2c-90bd703acc4c',committed:false,items:[{relative:'../不能操作',existed:false}]}));assert.throws(()=>recoverLegacyImport(f.target),/路径无效/);
});
test('版本改变先做可校验完整备份；相同版本与重新安装不重复改写个人资料',async()=>{
  const f=await fixture(),hash=await sha256(path.join(f.source,'notes.sqlite'));rememberVersion(f.source,'1.7.2');await backupBeforeVersion(f.source,'1.8.0');
  const folder=path.join(f.source,'升级前备份'),files=await fs.readdir(folder);assert.equal(files.length,1);const checked=await validateBackup(path.join(folder,files[0]));assert.equal(checked.count,2);assert.equal(checked.dayCount,1);
  rememberVersion(f.source,'1.8.0');await backupBeforeVersion(f.source,'1.8.0');assert.deepEqual(await fs.readdir(folder),files);assert.equal(await sha256(path.join(f.source,'notes.sqlite')),hash);
});
