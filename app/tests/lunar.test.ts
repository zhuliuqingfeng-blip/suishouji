import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store,sha256} from '../electron/store.js';
import {createBackup,createClosedBackup,validateBackup,applyRestore} from '../electron/archive.js';
import {lunarMonths,lunarToSolar,solarToLunar,lunarMonthOptions,LUNAR_MIN_YEAR,LUNAR_MAX_YEAR} from '../electron/lunar-calendar.js';
import {civilNumber,validateImportantDay,occurrence,orderedDays,upcomingDays,reminderFor,originalDate,dayDistance} from '../electron/important-days.js';
import type {ImportantDay,ImportantDayInput} from '../electron/shared.js';
import {testRoot} from '../scripts/paths.mjs';

const input:ImportantDayInput={name:'农历生日',calendar:'lunar',year:null,month:5,day:6,isLeapMonth:false,yearly:true,reminderDays:14,note:'原始农历日期'};
const entry=(changes:Partial<ImportantDay>={}):ImportantDay=>({...input,id:'lunar',createdAt:'',updatedAt:'',...changes});
async function fixture(){await fs.mkdir(testRoot,{recursive:true});const root=await fs.mkdtemp(path.join(testRoot,'lunar-'));return {root,store:new Store(root)};}

test('香港天文台独立对照：春节、普通/闰六月、2033闰冬月及跨年日期',()=>{
  // Source: https://www.hko.gov.hk/tc/gts/time/calendar/text/files/T{solarYear}c.txt
  // Each tuple is [lunar year, month (negative = leap), day, Gregorian y,m,d].
  const references=[
    [1900,12,30,1901,2,18],[1901,1,1,1901,2,19],
    [2024,12,6,2025,1,5],[2024,12,29,2025,1,28],[2025,1,1,2025,1,29],
    [2025,5,6,2025,6,1],[2025,6,1,2025,6,25],[2025,6,30,2025,7,24],
    [2025,-6,1,2025,7,25],[2025,-6,29,2025,8,22],[2025,7,1,2025,8,23],
    [2025,12,29,2026,2,16],[2026,1,1,2026,2,17],[2026,5,6,2026,6,20],[2026,11,30,2027,1,7],
    [2027,5,6,2027,6,10],[2033,11,30,2033,12,21],[2033,-11,1,2033,12,22],
    [2033,-11,29,2034,1,19],[2033,12,1,2034,1,20],[2100,1,1,2100,2,9],[2100,12,1,2100,12,31],
  ];
  for(const [year,signedMonth,day,sy,month,sd] of references){
    const expected={year:sy,month,day:sd};
    assert.deepEqual(lunarToSolar(year,Math.abs(signedMonth),day,signedMonth<0),expected);
    assert.deepEqual(solarToLunar(sy,month,sd),{year,month:Math.abs(signedMonth),day,isLeapMonth:signedMonth<0});
  }
});
test('农历1900—2100年逐日连续，所有月份首尾双向转换，范围端点明确',()=>{
  let previous:number|undefined,total=0,months=0;
  for(let year=LUNAR_MIN_YEAR;year<=LUNAR_MAX_YEAR;year++){
    for(const m of lunarMonths(year)){
      months++;assert.ok(m.days===29||m.days===30);
      for(let day=1;day<=m.days;day++){
        const solar=lunarToSolar(year,m.month,day,m.isLeapMonth)!;
        const serial=civilNumber(solar.year,solar.month,solar.day);
        if(previous!==undefined)assert.equal(serial,previous+1,`${year}/${m.month}/${day}`);
        previous=serial;total++;
        if(day===1||day===m.days)assert.deepEqual(solarToLunar(solar.year,solar.month,solar.day),{year,month:m.month,day,isLeapMonth:m.isLeapMonth});
      }
      assert.equal(lunarToSolar(year,m.month,m.days+1,m.isLeapMonth),null);
    }
  }
  assert.ok(total>73000&&months>2400);
  assert.deepEqual(lunarToSolar(1900,1,1),{year:1900,month:1,day:31});
  assert.deepEqual(lunarToSolar(2100,12,29),{year:2101,month:1,day:28});
  assert.equal(solarToLunar(1900,1,30),null);assert.equal(solarToLunar(2101,1,29),null);
  assert.equal(solarToLunar(2026,2,30),null);assert.equal(lunarToSolar(1899,1,1),null);assert.equal(lunarToSolar(2101,1,1),null);
});
test('农历名称、年份可选及真实闰月校验，不接受不存在的原始日期',()=>{
  assert.equal(originalDate(input),'农历五月初六 · 每年');
  assert.equal(originalDate({...input,year:2025,month:6,isLeapMonth:true}),'农历2025年闰六月初六 · 每年');
  assert.equal(validateImportantDay({...input,year:2025,month:6,isLeapMonth:true}).isLeapMonth,true);
  for(const changes of [{year:1899},{year:2101},{day:31},{year:2025,month:12,day:30},{year:2026,month:6,isLeapMonth:true},{yearly:false},{month:1,isLeapMonth:true},{isLeapMonth:'true'}])assert.throws(()=>validateImportantDay({...input,...changes} as ImportantDayInput));
  assert.ok(lunarMonthOptions(2025).some(m=>m.month===6&&m.isLeapMonth));assert.ok(!lunarMonthOptions(2026).some(m=>m.isLeapMonth));
  assert.ok(lunarMonthOptions(null).some(m=>m.month===5&&m.isLeapMonth));
  assert.equal(validateImportantDay({...input,calendar:'solar',isLeapMonth:undefined} as unknown as ImportantDayInput).isLeapMonth,false);
  assert.throws(()=>validateImportantDay({...input,calendar:'solar',isLeapMonth:true}),/没有闰月/);
});
test('每年按农历重算，经过当天后切换下一农历年，原始年份及月日不改变',()=>{
  const day=entry({year:2001}),before=JSON.stringify(day);
  assert.equal(occurrence(day,new Date(2025,5,1)).days,0);
  assert.equal(occurrence(day,new Date(2025,5,2)).date,'2026-06-20');
  assert.equal(occurrence(day,new Date(2027,5,10)).date,'2027-06-10');
  assert.equal(occurrence(entry({year:2028}),new Date(2025,0,1)).year,2028);
  assert.equal(JSON.stringify(day),before);
});
test('闰月严格匹配；没有闰六月的年份跳过，不退回普通六月',()=>{
  const leap=entry({month:6,day:1,isLeapMonth:true});
  assert.equal(occurrence(entry({month:6,day:1}),new Date(2025,5,1)).date,'2025-06-25');
  assert.equal(occurrence(leap,new Date(2025,5,1)).date,'2025-07-25');
  assert.equal(occurrence(leap,new Date(2025,6,26)).date,'2036-07-23');
  assert.equal(occurrence(leap,new Date(2036,6,23)).days,0);
});
test('农历三十跳过小月年份，不静默改成二十九，也不影响二十九',()=>{
  const thirty=entry({month:12,day:30}),before=JSON.stringify(thirty);
  assert.equal(occurrence(thirty,new Date(2024,1,9)).days,0);
  assert.equal(occurrence(thirty,new Date(2024,1,10)).date,'2030-02-02');
  assert.equal(occurrence(entry({month:12,day:29}),new Date(2026,1,16)).days,0);
  assert.equal(reminderFor(thirty,new Date(2026,1,16)),null);
  assert.equal(JSON.stringify(thirty),before);
});
test('春节前仍属于上一农历年；跨公历年14天提前提醒与当天提醒独立去重',async()=>{
  const {store}=await fixture();const day=store.saveImportantDay({...input,month:12,day:6});
  const early=new Date(2024,11,22),today=new Date(2025,0,5),later=new Date(2025,0,6);
  assert.equal(occurrence(day,early).date,'2025-01-05');assert.equal(occurrence(day,early).days,14);assert.equal(occurrence(day,early).year,2024);
  assert.equal(upcomingDays([day],early).length,1);assert.equal(upcomingDays([day],new Date(2024,11,21)).length,0);
  const advance=store.pendingDayReminders(early);assert.equal(advance[0].stage,'advance');store.acknowledgeDayReminders(advance.map(r=>r.key),early);
  assert.equal(store.pendingDayReminders(new Date(2025,0,4)).length,0);
  const sameDay=store.pendingDayReminders(today);assert.equal(sameDay[0].stage,'today');assert.notEqual(sameDay[0].key,advance[0].key);
  store.acknowledgeDayReminders(sameDay.map(r=>r.key),today);assert.equal(store.pendingDayReminders(today).length,0);
  assert.equal(store.pendingDayReminders(later).length,0);assert.equal(occurrence(day,later).date,'2026-01-24');store.close();
});
test('公历与农历统一排序、首页窗口及一次性历史日子；末年之后不虚构日期',()=>{
  const lunar=entry({id:'lunar'}),solar=entry({id:'solar',calendar:'solar',month:6,day:21}),now=new Date(2026,5,19);
  assert.deepEqual(orderedDays([solar,lunar],now).map(o=>o.entry.id),['lunar','solar']);assert.equal(occurrence(lunar,now).days,1);
  const past=entry({yearly:false,year:2025,month:12,day:29});assert.equal(occurrence(past,new Date(2026,1,17)).days,-1);assert.equal(reminderFor(past,new Date(2027,1,17)),null);
  const exhausted=entry({month:11,day:1,isLeapMonth:true});const next=occurrence(exhausted,new Date(2034,0,20));
  assert.equal(next.date,null);assert.equal(dayDistance(next.days),'暂无下次日期');assert.equal(reminderFor(exhausted,new Date(2034,0,20)),null);assert.deepEqual(upcomingDays([exhausted],new Date(2034,0,20)),[]);
  assert.equal(occurrence(entry({month:12,day:29}),new Date(2101,0,28)).days,0);assert.equal(occurrence(entry({month:12,day:29}),new Date(2101,0,29)).date,null);
});
test('农历按原始年月日与闰月持久化，修改闰月后提醒节点重新计算',async()=>{
  const {root,store}=await fixture();const day=store.saveImportantDay({...input,month:6,day:1,year:2025});const now=new Date(2025,5,25);
  store.acknowledgeDayReminders(store.pendingDayReminders(now).map(r=>r.key),now);assert.equal(store.pendingDayReminders(now).length,0);
  store.saveImportantDay({...day,isLeapMonth:true});assert.equal(store.db.prepare('SELECT * FROM day_reminders').all().length,0);store.close();
  const reopened=new Store(root),saved=reopened.listImportantDays()[0];assert.equal(saved.calendar,'lunar');assert.equal(saved.isLeapMonth,true);assert.equal(saved.year,2025);assert.equal(saved.month,6);assert.equal(saved.day,1);reopened.close();
});
test('1.6数据库和备份升级保留手记、附件、公历日子和已提醒状态，不先修改旧数据',async()=>{
  const {root,store}=await fixture();const note=store.create().note;store.save({...note,title:'已有公历资料'});
  const source=path.join(root,'original.txt');await fs.writeFile(source,'已有附件');store.addFile(note.id,source);
  const solar=store.saveImportantDay({...input,calendar:'solar',year:2000,month:11,day:5});
  const now=new Date(2026,9,23);store.acknowledgeDayReminders(store.pendingDayReminders(now).map(r=>r.key),now);
  const notes=store.db.prepare('SELECT * FROM notes').all(),assets=store.db.prepare('SELECT * FROM attachments').all(),seen=store.db.prepare('SELECT * FROM day_reminders').all();
  store.db.exec('ALTER TABLE important_days DROP COLUMN isLeapMonth; PRAGMA user_version=2;');store.close();
  const file=path.join(root,'notes.sqlite'),before=await sha256(file),backup=path.join(root,'v1.6.zip');await createClosedBackup(root,backup);assert.equal(await sha256(file),before);
  const raw=new DatabaseSync(file,{readOnly:true});assert.equal(raw.prepare('PRAGMA user_version').get()!.user_version,2);raw.close();
  const migrated=new Store(root);assert.equal(migrated.db.prepare('PRAGMA user_version').get()!.user_version,3);
  assert.deepEqual(migrated.db.prepare('SELECT * FROM notes').all(),notes);assert.deepEqual(migrated.db.prepare('SELECT * FROM attachments').all(),assets);assert.deepEqual(migrated.db.prepare('SELECT * FROM day_reminders').all(),seen);
  assert.deepEqual(migrated.listImportantDays(),[solar]);assert.equal(migrated.pendingDayReminders(now).length,0);
  const checked=await validateBackup(backup);applyRestore(migrated,checked.stage);await fs.rm(checked.stage,{recursive:true,force:true});assert.deepEqual(migrated.listImportantDays(),[solar]);assert.equal(migrated.pendingDayReminders(now).length,0);migrated.close();
});
test('农历和已提醒状态完整备份、恢复、搬迁；损坏农历备份不覆盖现有资料',async()=>{
  const {root,store}=await fixture();const day=store.saveImportantDay({...input,month:6,day:1,year:2025,isLeapMonth:true});const now=new Date(2025,6,25);
  store.acknowledgeDayReminders(store.pendingDayReminders(now).map(r=>r.key),now);const backup=path.join(root,'lunar.zip');await createBackup(store,backup);store.removeImportantDay(day.id);
  const checked=await validateBackup(backup);applyRestore(store,checked.stage);await fs.rm(checked.stage,{recursive:true,force:true});assert.deepEqual(store.listImportantDays(),[day]);assert.equal(store.pendingDayReminders(now).length,0);
  store.db.exec('UPDATE important_days SET year=2026');const corrupt=path.join(root,'invalid-lunar.zip');await createBackup(store,corrupt);store.db.exec('UPDATE important_days SET year=2025');
  await assert.rejects(validateBackup(corrupt),/没有闰六月/);assert.deepEqual(store.listImportantDays(),[day]);
  store.close();await fs.rename(root,root+'-moved');const moved=new Store(root+'-moved');assert.deepEqual(moved.listImportantDays(),[day]);moved.close();
});
