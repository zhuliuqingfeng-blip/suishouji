import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../electron/store.js';
import {occurrence} from '../electron/important-days.js';
import {buildDaysFile,serializeDaysFile,parseDaysFile,planDayImport,dayImportConflict,dayDateLabel,writeDaysFile,isLiveDataPath,DAYS_FORMAT,DAYS_VERSION,MAX_DAYS_ROWS} from '../electron/important-days-transfer.js';
import type {DayFileRecord,DayImportPlan} from '../electron/important-days-transfer.js';
import type {ImportantDay,ImportantDayInput} from '../electron/shared.js';
import {testRoot} from '../scripts/paths.mjs';

const now=new Date(2026,9,23,12);
const solarDay:ImportantDayInput={name:'妈妈生日',calendar:'solar',year:null,month:11,day:5,isLeapMonth:false,yearly:true,reminderDays:14,note:'记得打个电话'};
const leapDay:ImportantDayInput={name:'外婆生日',calendar:'lunar',year:2025,month:6,day:12,isLeapMonth:true,yearly:true,reminderDays:7,note:'闰六月生日'};
const lunarDay:ImportantDayInput={name:'腊八',calendar:'lunar',year:null,month:12,day:8,isLeapMonth:false,yearly:true,reminderDays:0,note:''};
const leapFebruary:ImportantDayInput={name:'四年一次',calendar:'solar',year:2000,month:2,day:29,isLeapMonth:false,yearly:true,reminderDays:3,note:''};
const onceDay:ImportantDayInput={name:'一次旅行',calendar:'solar',year:2026,month:10,day:22,isLeapMonth:false,yearly:false,reminderDays:0,note:''};

async function fixture(){await fs.mkdir(testRoot,{recursive:true});const root=await fs.mkdtemp(path.join(testRoot,'transfer-'));return {root,store:new Store(root)};}
function fileOf(store:Store){const entries=store.listImportantDays();return {entries,file:buildDaysFile(entries,new Map(entries.map(entry=>[entry.id,store.dayReminders(entry.id)])))};}
function rowsOf(store:Store){return parseDaysFile(serializeDaysFile(fileOf(store).file)).rows;}
const plan=(store:Store,rows:ReturnType<typeof rowsOf>):DayImportPlan=>planDayImport(store.listImportantDays(),rows);

test('导出文件带格式标识与版本，农历保留原始月日、闰月和提醒节点，不保存换算后的公历',async()=>{
  const {store}=await fixture();
  const mother=store.saveImportantDay(solarDay),leap=store.saveImportantDay(leapDay);
  store.saveImportantDay(lunarDay);
  store.acknowledgeDayReminders(store.pendingDayReminders(now).map(reminder=>reminder.key),now);
  const {entries,file}=fileOf(store);
  assert.equal(file.format,DAYS_FORMAT);assert.equal(file.version,DAYS_VERSION);assert.equal(file.count,3);
  assert.equal(file.application,'随手记');assert.ok(Number.isFinite(Date.parse(file.exportedAt)));
  const text=serializeDaysFile(file);
  assert.match(text,/"format": "suishouji-important-days"/);
  const parsed=JSON.parse(text) as typeof file;
  const leapRow=parsed.days.find(row=>row.id===leap.id)!;
  assert.deepEqual({calendar:leapRow.calendar,year:leapRow.year,month:leapRow.month,day:leapRow.day,isLeapMonth:leapRow.isLeapMonth},
    {calendar:'lunar',year:2025,month:6,day:12,isLeapMonth:true});
  assert.deepEqual(Object.keys(leapRow).sort(),['calendar','createdAt','day','id','isLeapMonth','month','name','note','reminded','reminderDays','updatedAt','year','yearly'].sort());
  assert.equal(leapRow.reminderDays,7);assert.equal(leapRow.note,'闰六月生日');assert.equal(leapRow.yearly,true);
  const motherRow=parsed.days.find(row=>row.id===mother.id)!;
  assert.deepEqual({title:dayDateLabel(motherRow),lunar:dayDateLabel(leapRow)}, {title:'11月5日',lunar:'农历2025年闰六月十二'});
  assert.deepEqual(entries.map(entry=>entry.id).sort(),[mother.id,leap.id,store.listImportantDays()[2].id].sort());
  // 已提醒节点随文件带走，恢复后不会把看过的日期再提示一次。
  assert.deepEqual(parsed.days.flatMap(row=>row.reminded).map(item=>({occurrence:item.occurrence,stage:item.stage})),[{occurrence:'2026-11-05',stage:'advance'}]);
  store.close();
});

test('解析拒绝不是本软件的文件、过高版本、结构缺失、非法日期和超量记录',async()=>{
  const empty=serializeDaysFile(buildDaysFile([],new Map()));
  // 应用不会导出 0 条的日子，空列表在预览前就拒绝，不能显示成“都已经存在”。
  assert.throws(()=>parseDaysFile(empty),/文件里没有可以导入的重要日子/);
  const minimal=JSON.stringify({format:DAYS_FORMAT,version:1,days:[{name:'某天',calendar:'solar',year:null,month:1,day:1,isLeapMonth:false,yearly:true,reminderDays:0,note:''}]});
  // 用记事本另存后可能带 BOM，不影响解析。
  assert.equal(parseDaysFile(`\uFEFF${minimal}`).rows.length,1);
  assert.throws(()=>parseDaysFile(''),/空的/);
  assert.throws(()=>parseDaysFile('不是JSON'),/有效的 JSON/);
  assert.throws(()=>parseDaysFile('[]'),/不是随手记的重要日子导出文件/);
  assert.throws(()=>parseDaysFile(JSON.stringify({format:'suishouji-backup',version:1,days:[]})),/不是随手记的重要日子导出文件/);
  assert.throws(()=>parseDaysFile(JSON.stringify({format:DAYS_FORMAT,version:2,days:[]})),/更新版本的随手记/);
  assert.throws(()=>parseDaysFile(JSON.stringify({format:DAYS_FORMAT,days:[]})),/版本信息/);
  assert.throws(()=>parseDaysFile(JSON.stringify({format:DAYS_FORMAT,version:1})),/找不到重要日子的列表/);
  const row=(changes:Record<string,unknown>)=>({format:DAYS_FORMAT,version:1,exportedAt:now.toISOString(),count:1,days:[{name:'某天',calendar:'solar',year:null,month:1,day:1,isLeapMonth:false,yearly:true,reminderDays:0,note:'',...changes}]});
  assert.throws(()=>parseDaysFile(JSON.stringify(row({month:13}))),/第 1 条：.*有效的公历日期/);
  assert.throws(()=>parseDaysFile(JSON.stringify(row({month:2,day:29,year:2001}))),/第 1 条：.*有效的公历日期/);
  assert.throws(()=>parseDaysFile(JSON.stringify(row({calendar:'lunar',month:5,day:1,isLeapMonth:true,year:2025}))),/第 1 条：.*2025年没有闰五月/);
  assert.throws(()=>parseDaysFile(JSON.stringify(row({yearly:undefined}))),/缺少是否每年重复/);
  assert.throws(()=>parseDaysFile(JSON.stringify(row({reminderDays:400}))),/第 1 条：.*0至365/);
  assert.throws(()=>parseDaysFile(JSON.stringify(row({year:1899,calendar:'lunar'}))),/第 1 条：.*农历年份支持/);
  assert.throws(()=>parseDaysFile(JSON.stringify(row({reminded:[{occurrence:'昨天',stage:'advance',seenAt:now.toISOString()}]}))),/提醒记录格式无效/);
  const many=JSON.stringify({format:DAYS_FORMAT,version:1,days:Array.from({length:MAX_DAYS_ROWS+1},()=>({name:'x',calendar:'solar',year:null,month:1,day:1,isLeapMonth:false,yearly:true,reminderDays:0,note:''}))});
  assert.throws(()=>parseDaysFile(many),/上限/);
});

test('合并导入只新增缺失记录，重复导入同一个文件不产生重复',async()=>{
  const source=await fixture(),target=await fixture();
  source.store.saveImportantDay(solarDay);source.store.saveImportantDay(leapDay);source.store.saveImportantDay(lunarDay);
  const rows=rowsOf(source.store);
  const local=target.store.saveImportantDay({...onceDay,name:'本地已有的日子'});
  const first=target.store.importImportantDays(rows,'local');
  assert.deepEqual(first,{added:3,updated:0,skipped:0,keptLocal:0});
  assert.equal(target.store.listImportantDays().length,4);
  assert.ok(target.store.listImportantDays().some(day=>day.id===local.id));
  const second=target.store.importImportantDays(rows,'local');
  assert.deepEqual(second,{added:0,updated:0,skipped:3,keptLocal:0});
  assert.equal(target.store.listImportantDays().length,4);
  // 再次解析同一份文件得到同样的计划：0 新增、3 重复、0 冲突。
  assert.deepEqual(plan(target.store,rows).added.length,0);
  assert.equal(plan(target.store,rows).duplicates,3);
  assert.equal(plan(target.store,rows).conflicts.length,0);
  source.store.close();target.store.close();
});

test('内容不同不静默覆盖：默认保留本地，选择导入才更新原记录并保留编号与创建时间',async()=>{
  const source=await fixture(),target=await fixture();
  const original=source.store.saveImportantDay({...leapDay,name:'外婆生日'});
  const rows=rowsOf(source.store);
  target.store.importImportantDays(rows,'local');
  const imported=target.store.listImportantDays()[0];
  assert.equal(imported.id,original.id);assert.equal(imported.createdAt,original.createdAt);

  target.store.saveImportantDay({...imported,reminderDays:30,note:'本机改过的备注'});
  const changed=target.store.listImportantDays()[0];
  const preview=plan(target.store,rows);
  assert.equal(preview.added.length,0);assert.equal(preview.duplicates,0);assert.equal(preview.conflicts.length,1);
  const conflict=dayImportConflict(preview.conflicts[0].local,preview.conflicts[0].incoming);
  assert.equal(conflict.title,'外婆生日');
  assert.deepEqual(conflict.differences.map(difference=>difference.field),['reminder','note']);
  assert.deepEqual({label:conflict.differences[0].label,local:conflict.differences[0].local,incoming:conflict.differences[0].incoming},{label:'提前提醒',local:'提前30天',incoming:'提前7天'});

  const keep=target.store.importImportantDays(rows,'local');
  assert.deepEqual(keep,{added:0,updated:0,skipped:0,keptLocal:1});
  assert.equal(target.store.listImportantDays()[0].reminderDays,30);
  assert.equal(target.store.listImportantDays().length,1);

  const replace=target.store.importImportantDays(rows,'incoming');
  assert.deepEqual(replace,{added:0,updated:1,skipped:0,keptLocal:0});
  const merged=target.store.listImportantDays();
  assert.equal(merged.length,1);assert.equal(merged[0].reminderDays,7);assert.equal(merged[0].note,'闰六月生日');
  assert.equal(merged[0].id,changed.id);assert.equal(merged[0].createdAt,changed.createdAt);
  source.store.close();target.store.close();
});

test('农历闰月、提醒设置、备注和已提醒节点在导入后保持一致，日期含义不变',async()=>{
  const source=await fixture(),target=await fixture();
  source.store.saveImportantDay(leapDay);source.store.saveImportantDay(lunarDay);source.store.saveImportantDay(leapFebruary);
  source.store.acknowledgeDayReminders(source.store.pendingDayReminders(now).map(reminder=>reminder.key),now);
  const rows=rowsOf(source.store);
  const expected=source.store.listImportantDays().map(day=>occurrence(day,now));
  assert.equal(source.store.pendingDayReminders(now).length,0);
  target.store.importImportantDays(rows,'local');
  const actual=target.store.listImportantDays().map(day=>occurrence(day,now));
  assert.deepEqual(actual.map(item=>({name:item.entry.name,date:item.date,days:item.days,adjusted:item.adjusted})),expected.map(item=>({name:item.entry.name,date:item.date,days:item.days,adjusted:item.adjusted})));
  assert.deepEqual(target.store.listImportantDays().map(day=>({calendar:day.calendar,year:day.year,month:day.month,day:day.day,isLeapMonth:day.isLeapMonth,yearly:day.yearly,reminderDays:day.reminderDays,note:day.note})),
    rows.map(day=>({calendar:day.calendar,year:day.year,month:day.month,day:day.day,isLeapMonth:day.isLeapMonth,yearly:day.yearly,reminderDays:day.reminderDays,note:day.note})));
  // 已提醒节点随文件恢复，导入不会重新弹出同一节点。
  assert.equal(target.store.pendingDayReminders(now).length,0);
  // 导入后每个日期的提醒行为和原件完全一致，不重复也不遗漏。
  for(const at of [now,new Date(2026,10,1),new Date(2027,0,5),new Date(2027,5,1),new Date(2030,2,1)])
    assert.deepEqual(target.store.pendingDayReminders(at),source.store.pendingDayReminders(at));
  source.store.close();target.store.close();
});

test('导入失败整体回滚，已有日子和提醒状态不受影响',async()=>{
  const {store}=await fixture();
  const kept=store.saveImportantDay(solarDay);
  const rows=rowsOf(store);
  store.db.exec("CREATE TRIGGER reject_import BEFORE INSERT ON important_days BEGIN SELECT RAISE(ABORT,'导入验收失败'); END;");
  assert.throws(()=>store.importImportantDays([...rows,{...rows[0],id:undefined,name:'新日子'}],'local'),/导入验收失败/);
  assert.equal(store.listImportantDays().length,1);assert.equal(store.listImportantDays()[0].id,kept.id);
  store.db.exec('DROP TRIGGER reject_import');
  // 记录本身无效时同样整体拒绝，不会写入半条数据。
  assert.throws(()=>store.importImportantDays([{...rows[0],id:undefined,month:13}],'local'),/有效的公历日期/);
  assert.equal(store.listImportantDays().length,1);
  assert.equal(store.listImportantDays()[0].month,11);
  store.close();
});

test('同一份文件内的两条同名同日记录按内容区分，重复导入都能对上原记录',async()=>{
  const {store}=await fixture();
  const first=store.saveImportantDay({...solarDay,note:'第一条'});
  const second=store.saveImportantDay({...solarDay,note:'第二条'});
  const rows=rowsOf(store);
  const target=await fixture();
  assert.deepEqual(target.store.importImportantDays(rows,'local'),{added:2,updated:0,skipped:0,keptLocal:0});
  assert.deepEqual(target.store.importImportantDays(rows,'local'),{added:0,updated:0,skipped:2,keptLocal:0});
  const ids=target.store.listImportantDays().map(day=>day.id).sort();
  assert.deepEqual(ids,[first.id,second.id].sort());
  store.close();target.store.close();
});

test('写入文件先写临时文件再改名，覆盖保存后内容完整且没有残留',async()=>{
  const {root,store}=await fixture();
  store.saveImportantDay(solarDay);
  const destination=path.join(root,'导出','随手记重要日子.json');
  await fs.mkdir(path.dirname(destination),{recursive:true});
  await writeDaysFile(destination,serializeDaysFile(fileOf(store).file));
  assert.equal(JSON.parse(await fs.readFile(destination,'utf8')).count,1);
  const next=serializeDaysFile(buildDaysFile(store.listImportantDays(),new Map()));
  await writeDaysFile(destination,next);
  assert.equal(await fs.readFile(destination,'utf8'),next);
  assert.deepEqual((await fs.readdir(path.dirname(destination))).sort(),['随手记重要日子.json']);
  await assert.rejects(()=>writeDaysFile(path.join(root,'缺失目录','x.json'),'{}'),/无法保存重要日子文件/);
  store.close();
});

test('同一日期名称有多条本地记录时优先匹配内容完全相同的那条，不误改另一条',async()=>{
  const {store}=await fixture();
  const first=store.saveImportantDay({...solarDay,note:'备注A'});
  const second=store.saveImportantDay({...solarDay,note:'备注B'});
  const rows=rowsOf(store);
  // 没有可用编号的行（被手改过或来自更早的副本）只能靠内容识别。
  const orphan:DayFileRecord={...rows.find(row=>row.id===second.id)!,id:undefined};
  const planned=planDayImport(store.listImportantDays(),[orphan]);
  assert.equal(planned.added.length,0);assert.equal(planned.duplicates,1);assert.equal(planned.conflicts.length,0);
  const before=JSON.stringify(store.listImportantDays());
  assert.deepEqual(store.importImportantDays([orphan],'incoming'),{added:0,updated:0,skipped:1,keptLocal:0});
  assert.equal(JSON.stringify(store.listImportantDays()),before);
  assert.equal(store.listImportantDays().find(day=>day.id===first.id)!.note,'备注A');
  // 没有完全相同的候选时仍然只报冲突，写入前不改任何记录。
  const changed:DayFileRecord={...orphan,note:'备注C'};
  const conflictPlan=planDayImport(store.listImportantDays(),[changed]);
  assert.equal(conflictPlan.duplicates,0);assert.equal(conflictPlan.added.length,0);assert.equal(conflictPlan.conflicts.length,1);
  assert.equal(JSON.stringify(store.listImportantDays()),before);
  store.close();
});

test('单次上限内的合并计划是线性耗时，不会长时间卡住主进程',()=>{
  const rows:DayFileRecord[]=Array.from({length:MAX_DAYS_ROWS},(_,index)=>({name:`日子${index}`,calendar:'solar',year:null,month:1,day:1,isLeapMonth:false,yearly:true,reminderDays:0,note:'',createdAt:null,updatedAt:null,reminded:[]}));
  const started=Date.now(),planned=planDayImport([],rows),elapsed=Date.now()-started;
  assert.equal(planned.added.length,MAX_DAYS_ROWS);assert.equal(planned.duplicates,0);
  assert.ok(elapsed<5000,`${MAX_DAYS_ROWS} 条合并计划耗时 ${elapsed}ms，超过 5 秒`);
});

test('导出路径保护不区分大小写，数据目录里的文件不会被覆盖',()=>{
  const root=path.join('C:','数据');
  assert.equal(isLiveDataPath(root,path.join(root,'notes.sqlite')),true);
  assert.equal(isLiveDataPath(root,path.join(root,'NOTES.SQLITE')),true);
  assert.equal(isLiveDataPath(root,path.join(root,'attachments','a.json')),true);
  assert.equal(isLiveDataPath(root,path.join(root,'.运行缓存','x.json')),true);
  assert.equal(isLiveDataPath(root,path.join(root,'导出','随手记重要日子.json')),false);
  assert.equal(isLiveDataPath(root,path.join('C:','其他','notes.sqlite')),false);
});

test('备注只在可见部分相同、实际不同时，冲突列表会标出差异在后文',async()=>{
  const {store}=await fixture();
  const saved=store.saveImportantDay({...solarDay,note:`${'长'.repeat(100)}甲`});
  const incoming:DayFileRecord={...rowsOf(store)[0],note:`${'长'.repeat(100)}乙`};
  const conflict=dayImportConflict(saved,incoming);
  const note=conflict.differences.find(item=>item.field==='note')!;
  assert.match(note.local,/差异在后文/);assert.match(note.incoming,/差异在后文/);
  assert.ok(note.local.length<110);
  store.close();
});

test('采用导入版本时回填文件里的已提醒节点，改过提醒天数也不会重复弹出',async()=>{
  const source=await fixture(),target=await fixture();
  source.store.saveImportantDay(solarDay);
  source.store.acknowledgeDayReminders(source.store.pendingDayReminders(now).map(reminder=>reminder.key),now);
  assert.equal(source.store.pendingDayReminders(now).length,0);
  const rows=rowsOf(source.store);
  target.store.importImportantDays(rows,'local');
  const imported=target.store.listImportantDays()[0];
  // 本机把提前提醒改成 30 天：按表单规则清空该条提醒，于是今天会再次进入待提醒。
  target.store.saveImportantDay({...imported,reminderDays:30});
  assert.equal(target.store.pendingDayReminders(now).length,1);
  assert.deepEqual(target.store.importImportantDays(rows,'incoming'),{added:0,updated:1,skipped:0,keptLocal:0});
  assert.equal(target.store.listImportantDays()[0].reminderDays,14);
  // 文件里“今天已提醒过”的节点被写回，采纳导入版本后不再重复提示。
  assert.equal(target.store.pendingDayReminders(now).length,0);
  source.store.close();target.store.close();
});
