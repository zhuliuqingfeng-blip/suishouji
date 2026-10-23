import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../electron/store.js';
import {createBackup,createClosedBackup,validateBackup,applyRestore} from '../electron/archive.js';
import {civilNumber,localDay,validateImportantDay,occurrence,orderedDays,upcomingDays,reminderFor,dayDistance} from '../electron/important-days.js';
import type {ImportantDay,ImportantDayInput} from '../electron/shared.js';
import {testRoot} from '../scripts/paths.mjs';

const now=new Date(2026,9,23,12),input:ImportantDayInput={name:'妈妈生日',calendar:'solar',year:null,month:11,day:5,yearly:true,reminderDays:14,note:''};
const entry=(changes:Partial<ImportantDay>={}):ImportantDay=>({...input,id:'one',createdAt:'',updatedAt:'',...changes});
async function fixture(){await fs.mkdir(testRoot,{recursive:true});const root=await fs.mkdtemp(path.join(testRoot,'days-'));return {root,store:new Store(root)};}

test('日期按自然日计算，今天、明天、14天和跨年边界正确',()=>{
  assert.equal(occurrence(entry(),now).days,13);
  assert.equal(occurrence(entry({month:10,day:23}),now).days,0);
  assert.equal(occurrence(entry({month:10,day:24}),now).days,1);
  assert.equal(occurrence(entry({month:10,day:22}),now).date,'2027-10-22');
  assert.equal(occurrence(entry({month:1,day:1}),new Date(2026,11,31,23,59)).days,1);
  assert.equal(localDay(new Date(2026,9,23,23,59))-localDay(new Date(2026,9,23,0,1)),0);
  assert.equal(civilNumber(2026,3,9)-civilNumber(2026,3,7),2);
  assert.equal(dayDistance(0),'今天');assert.equal(dayDistance(1),'明天');assert.equal(dayDistance(3),'还有3天');
});
test('年份可选，不重复必须有年份；无效日期、空名称和提醒范围被拒绝',()=>{
  assert.equal(validateImportantDay({...input,name:'  妈妈生日  ',year:2001}).name,'妈妈生日');
  for(const change of [{yearly:false},{name:' '},{month:4,day:31},{month:2,day:29,year:2001},{month:0},{day:1.2},{year:0},{reminderDays:-1},{reminderDays:366},{reminderDays:NaN},{note:'字'.repeat(3001)},{calendar:'lunar'}])assert.throws(()=>validateImportantDay({...input,...change} as ImportantDayInput));
  assert.equal(validateImportantDay({...input,month:2,day:29,year:null}).day,29);
});
test('2月29日平年按最后一天，闰年恢复29日；低年份不会被JS映射为1900年代',()=>{
  const leap=entry({month:2,day:29,year:2000});
  assert.equal(occurrence(leap,new Date(2027,1,28)).days,0);assert.equal(occurrence(leap,new Date(2027,1,28)).adjusted,true);
  assert.equal(occurrence(leap,new Date(2027,2,1)).date,'2028-02-29');
  assert.equal(occurrence(entry({yearly:false,year:25,month:1,day:1}),now).date,'0025-01-01');
});
test('原始年份不会丢失，未来起始年份之前不会出现重复日期',()=>{
  assert.equal(occurrence(entry({year:2001}),now).year,2026);
  assert.equal(occurrence(entry({year:2028}),now).year,2028);
  const once=entry({yearly:false,year:2026,month:10,day:22});assert.equal(occurrence(once,now).days,-1);
});
test('按下次日期排序：首页14天含边界，更早提醒按自己的窗口展示',()=>{
  const entries=[entry({id:'far',month:11,day:20}),entry({id:'today',month:10,day:23}),entry({id:'14',month:11,day:6,reminderDays:0}),entry({id:'30',month:11,day:22,reminderDays:30}),entry({id:'past',yearly:false,year:2026,month:10,day:22})];
  assert.deepEqual(orderedDays(entries,now).map(o=>o.entry.id),['past','today','14','far','30']);
  assert.deepEqual(upcomingDays(entries,now).map(o=>o.entry.id),['today','14','30']);
  assert.equal(reminderFor(entries[2],now),null);
});
test('持久化新增修改删除，改名称不重发；改变日期或提醒规则允许新的提醒',async()=>{
  const {root,store}=await fixture();let day=store.saveImportantDay(input);assert.ok(day.id);assert.equal(store.overview().active,0);
  const reminders=store.pendingDayReminders(now);assert.equal(reminders.length,1);store.acknowledgeDayReminders(reminders.map(r=>r.key),now);assert.equal(store.pendingDayReminders(now).length,0);
  day=store.saveImportantDay({...day,name:'家人生日',year:2001});assert.equal(store.pendingDayReminders(now).length,1);
  store.acknowledgeDayReminders(store.pendingDayReminders(now).map(r=>r.key),now);day=store.saveImportantDay({...day,name:'改个名称'});assert.equal(store.pendingDayReminders(now).length,0);
  store.close();const reopened=new Store(root);assert.equal(reopened.listImportantDays()[0].year,2001);assert.equal(reopened.pendingDayReminders(now).length,0);
  reopened.removeImportantDay(day.id);assert.equal(reopened.listImportantDays().length,0);assert.equal(reopened.db.prepare('SELECT * FROM day_reminders').all().length,0);reopened.close();
});
test('提前节点补提醒一次、当天单独提醒，经过当天转向下一年；不重复日期过去不补发',async()=>{
  const {store}=await fixture();const day=store.saveImportantDay(input),advance=store.pendingDayReminders(new Date(2026,9,25));assert.equal(advance.length,1);assert.equal(advance[0].stage,'advance');
  store.acknowledgeDayReminders([advance[0].key],new Date(2026,9,25));assert.equal(store.pendingDayReminders(new Date(2026,10,4)).length,0);
  const today=store.pendingDayReminders(new Date(2026,10,5));assert.equal(today[0].stage,'today');store.acknowledgeDayReminders([today[0].key],new Date(2026,10,5));assert.equal(store.pendingDayReminders(new Date(2026,10,5,23)).length,0);
  assert.equal(store.pendingDayReminders(new Date(2026,10,6)).length,0);assert.equal(store.pendingDayReminders(new Date(2027,9,23)).length,1);
  store.saveImportantDay({...day,yearly:false,year:2026});assert.equal(store.pendingDayReminders(new Date(2027,9,23)).length,0);store.close();
});
test('提醒只接受当前有效编号，伪造或过去节点不会污染已提醒状态',async()=>{
  const {store}=await fixture();store.saveImportantDay(input);store.acknowledgeDayReminders(['forged'],now);assert.equal(store.db.prepare('SELECT * FROM day_reminders').all().length,0);
  assert.throws(()=>store.acknowledgeDayReminders([4] as unknown as string[],now));store.close();
});
test('同时进入提醒窗口时，今天的日子先于更远日期，不受创建顺序影响',async()=>{
  const {store}=await fixture();const later=store.saveImportantDay(input),today=store.saveImportantDay({...input,name:'今天的纪念日',month:10,day:23});assert.deepEqual(store.pendingDayReminders(now).map(r=>r.dayId),[today.id,later.id]);store.close();
});
test('保存失败事务回滚，原始日子与提醒状态仍保留',async()=>{
  const {store}=await fixture();const day=store.saveImportantDay(input);store.db.exec("CREATE TRIGGER reject_day BEFORE UPDATE ON important_days BEGIN SELECT RAISE(ABORT,'磁盘保存验收'); END;");
  assert.throws(()=>store.saveImportantDay({...day,name:'不会写入'}),/磁盘保存验收/);assert.equal(store.listImportantDays()[0].name,input.name);store.close();
});
test('1.5数据库升级保留原笔记和附件索引，旧备份可恢复为没有重要日子的数据',async()=>{
  const {root,store}=await fixture();const note=store.create().note;store.save({...note,title:'原来的手记'});store.db.exec('DROP TABLE day_reminders; DROP TABLE important_days; PRAGMA user_version=1;');store.close();
  const raw=new DatabaseSync(path.join(root,'notes.sqlite'));const {zipFiles}=await import('../electron/archive.js');const {sha256}=await import('../electron/store.js');
  const old=path.join(root,'old');await fs.mkdir(old);raw.prepare('VACUUM INTO ?').run(path.join(old,'notes.sqlite'));raw.close();
  const file=path.join(old,'notes.sqlite');await fs.writeFile(path.join(old,'manifest.json'),JSON.stringify({format:'suishouji-backup',version:1,createdAt:now.toISOString(),files:[{path:'notes.sqlite',size:(await fs.stat(file)).size,sha256:await sha256(file)}]}));
  const zip=path.join(root,'old.zip');await zipFiles([{source:file,name:'notes.sqlite'},{source:path.join(old,'manifest.json'),name:'manifest.json'}],zip);
  const next=new Store(root);assert.equal(next.get(note.id).note.title,'原来的手记');assert.equal(next.listImportantDays().length,0);next.saveImportantDay(input);
  const validated=await validateBackup(zip);assert.equal(validated.dayCount,0);applyRestore(next,validated.stage);await fs.rm(validated.stage,{recursive:true,force:true});assert.equal(next.listImportantDays().length,0);assert.equal(next.get(note.id).note.title,'原来的手记');next.close();
});
test('完整备份包含重要日子和已提醒状态，搬迁后保留；无效日子备份不会覆盖现有资料',async()=>{
  const {root,store}=await fixture();const day=store.saveImportantDay(input);store.acknowledgeDayReminders(store.pendingDayReminders(now).map(r=>r.key),now);
  const file=path.join(root,'all.zip');await createBackup(store,file);store.removeImportantDay(day.id);
  const validated=await validateBackup(file);assert.equal(validated.dayCount,1);applyRestore(store,validated.stage);await fs.rm(validated.stage,{recursive:true,force:true});assert.equal(store.listImportantDays()[0].name,input.name);assert.equal(store.pendingDayReminders(now).length,0);
  store.db.exec('UPDATE important_days SET month=13');const corrupt=path.join(root,'invalid-date.zip');await createBackup(store,corrupt);store.db.exec('UPDATE important_days SET month=11');await assert.rejects(validateBackup(corrupt),/有效的公历日期/);assert.equal(store.listImportantDays()[0].month,11);
  store.close();await fs.rename(root,root+'-moved');const moved=new Store(root+'-moved');assert.equal(moved.listImportantDays()[0].id,day.id);moved.close();
});
test('升级备份通过只读连接保留旧数据库版本，备份完成前不做迁移',async()=>{
  const {root,store}=await fixture();store.create();store.db.exec('DROP TABLE day_reminders; DROP TABLE important_days; PRAGMA user_version=1;');store.close();
  const {sha256}=await import('../electron/store.js'),file=path.join(root,'notes.sqlite'),before=await sha256(file);
  const counts=await createClosedBackup(root,path.join(root,'before-upgrade.zip'));assert.equal(counts.active,1);assert.equal(await sha256(file),before);
  const db=new DatabaseSync(file,{readOnly:true});assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,1);db.close();
  const checked=await validateBackup(path.join(root,'before-upgrade.zip'));assert.equal(checked.dayCount,0);await fs.rm(checked.stage,{recursive:true,force:true});
});
