import {appRoot,testRoot} from './paths.mjs';
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
process.chdir(appRoot);
const version=JSON.parse(await fs.readFile(path.join(appRoot,'package.json'),'utf8')).version;
const root=path.join(testRoot,'days-transfer-'+Date.now()),shots=path.join(testRoot,'days-transfer-'+version);
const exported=path.join(root,'导出的重要日子','随手记重要日子.json');
await fs.mkdir(path.dirname(exported),{recursive:true});await fs.mkdir(shots,{recursive:true});
let app,page;const errors=[],checks=[];
// A parent shell may export ELECTRON_RUN_AS_NODE (some editors do); Electron
// would then boot as plain Node and never open a window.
const env={...process.env,NOTES_TEST_MODE:'1',NOTES_DATA_DIR:root};
delete env.ELECTRON_RUN_AS_NODE;
// Restricted sessions (automation hosts with a limited job object) cannot create
// the Chromium sandbox and abort with STATUS_BREAKPOINT before the first window.
// The flag only affects this test launch, not the application.
const sandbox=process.env.NOTES_ELECTRON_SANDBOX==='1'?[]:['--no-sandbox'];
async function launch(){
 const executable=process.env.NOTES_PACKAGED_EXE;
 app=await electron.launch({executablePath:executable||electronPath,args:executable?sandbox:[appRoot,...sandbox],env});
 page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 // 不打扰正在使用电脑的人：窗口移到屏幕外、不进任务栏（NOTES_VISIBLE_WINDOW=1 可保留在原位）。
 if(process.env.NOTES_VISIBLE_WINDOW!=='1')await app.evaluate(({BrowserWindow})=>{try{const win=BrowserWindow.getAllWindows()[0];if(!win)return;win.setSkipTaskbar?.(true);const bounds=win.getBounds();win.setBounds({x:-32000,y:-32000,width:bounds.width,height:bounds.height});}catch{}});
 await page.locator('.home-mode').waitFor();await ready();
}
async function ready(){await page.waitForFunction(()=>!document.querySelector('.space-tabs button')?.disabled);}
async function close(){const end=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await end;app=null;}
async function nav(name){await page.getByRole('button',{name,exact:true}).click();await ready();}
async function dates(){await nav('重要日子');await page.locator('.days-mode').waitFor();}
async function idle(){await page.waitForFunction(()=>{const add=document.querySelector('.days-mode .day-add');return add&&!add.disabled;});}
async function addDay({name,calendar='solar',year=null,month,day,yearly=true,reminder='14',days=null,note=''}){
 await page.getByRole('button',{name:'添加重要日子',exact:true}).click();await page.getByRole('dialog',{name:'添加重要日子',exact:true}).waitFor();
 await page.getByLabel('日子名称',{exact:true}).fill(name);
 if(calendar==='lunar')await page.getByRole('button',{name:'农历',exact:true}).click();
 if(year!==null)await page.getByLabel('年份',{exact:true}).fill(String(year));
 await page.getByLabel('月份',{exact:true}).selectOption(String(month));
 await page.getByLabel('日期',{exact:true}).selectOption(String(day));
 if(!yearly)await page.getByLabel('每年重复',{exact:true}).uncheck();
 if(days!==null){await page.getByLabel('提前提醒',{exact:true}).selectOption('custom');await page.getByLabel('提前天数',{exact:true}).fill(String(days));}
 else await page.getByLabel('提前提醒',{exact:true}).selectOption(reminder);
 if(note)await page.getByLabel('日子备注',{exact:true}).fill(note);
 await page.getByRole('button',{name:'保存',exact:true}).click();await page.locator('.day-dialog').waitFor({state:'detached'});await idle();
}
async function entries(){return page.evaluate(()=>window.notes.listImportantDays());}
async function rowTexts(){return (await page.locator('.important-day-row .day-row-copy').allInnerTexts()).filter(Boolean);}
async function more(){await page.getByRole('button',{name:'更多重要日子操作',exact:true}).click();}
async function resize(width,height){await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),{width,height});await page.waitForFunction(({width,height})=>Math.abs(innerWidth-width)<=2&&Math.abs(innerHeight-height)<=2,{width,height});}
async function shot(name){await page.mouse.move(1,1);await page.screenshot({path:path.join(shots,name+'.png')});}
async function geometry(label){
 assert.deepEqual(await page.evaluate(()=>{
  const failures=[];
  if(document.documentElement.scrollWidth>innerWidth)failures.push('页面横向溢出');
  const root=document.querySelector('.day-transfer-dialog')||document.querySelector('.important-days-page');
  if(root.scrollWidth>root.clientWidth+1)failures.push('内容横向溢出');
  for(const el of root.querySelectorAll('button,input,select,textarea')){if(!el.checkVisibility())continue;const b=el.getBoundingClientRect();if(b.left<0||b.right>innerWidth+1)failures.push('控件超出窗口');if(b.top>=0&&b.bottom<=innerHeight){const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);if(hit!==el&&!el.contains(hit))failures.push('控件被遮挡：'+(el.getAttribute('aria-label')||el.textContent));}}
  return failures;
 }),[],label);
}
async function saveTo(file){await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);}
async function openFrom(file){await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);}
async function toast(){return page.locator('.toast').innerText();}
async function clearToast(){if(await page.locator('.toast').count())await page.getByRole('button',{name:'关闭提示',exact:true}).click();}
async function removeByName(name){
 const row=page.locator('.important-day-row').filter({hasText:name}).first();
 // 一次性过去的日子折叠在“过去的日子”里。
 if(!await row.isVisible())await page.locator('.past-days summary').click();
 await row.click();
 await page.getByRole('dialog',{name:'重要日子详情',exact:true}).waitFor();
 await page.getByRole('button',{name:'删除这个日子',exact:true}).click();
 await page.getByRole('button',{name:'确认删除',exact:true}).click();
 await page.locator('.day-dialog').waitFor({state:'detached'});await idle();
}
const importDialog=()=>page.getByRole('dialog',{name:'导入重要日子'}),exportDialog=()=>page.getByRole('dialog',{name:'导出重要日子'});
try{
 await launch();await resize(1260,820);await dates();
 assert.equal(await page.locator('.day-more').count(),1);
 await addDay({name:'妈妈生日',month:new Date().getMonth()+1,day:new Date().getDate(),reminder:'14',note:'记得打个电话'});
 await addDay({name:'外婆生日',calendar:'lunar',year:2025,month:-6,day:12,reminder:'7',note:'闰六月的生日'});
 await addDay({name:'腊八',calendar:'lunar',year:null,month:12,day:8,reminder:'0'});
 await addDay({name:'四年一次',month:2,day:29,year:2000,reminder:'3'});
 await addDay({name:'一次旅行',year:2026,month:10,day:22,yearly:false,note:'已经过去了'});
 await page.waitForFunction(()=>window.notes.pendingDayReminders().then(list=>list.length===0));
 const before=await entries(),beforeRows=await rowTexts();
 assert.equal(before.length,5);assert.equal(beforeRows.length,4);
 checks.push('准备5条日子：公历当天、农历闰六月、农历普通月、2月29日、一次性过去日期');
 await more();assert.equal(await page.getByRole('menuitem').count(),2);await geometry('menu');await shot('01-更多操作');
 await saveTo(exported);await page.getByRole('menuitem',{name:'导出重要日子'}).click();
 await exportDialog().waitFor();
 assert.equal(await page.locator('.day-transfer-lead').innerText(),'已导出 5 条重要日子');
 assert.equal(await page.locator('.day-transfer-path').innerText(),exported);
 await geometry('export');await shot('02-导出完成');
 await page.getByRole('button',{name:'完成',exact:true}).click();await exportDialog().waitFor({state:'detached'});
 const file=JSON.parse(await fs.readFile(exported,'utf8'));
 assert.equal(file.format,'suishouji-important-days');assert.equal(file.version,1);assert.equal(file.count,5);assert.equal(file.days.length,5);
 assert.ok(Number.isFinite(Date.parse(file.exportedAt)));
 const leap=file.days.find(day=>day.name==='外婆生日');
 assert.deepEqual(Object.keys(leap).sort(),['calendar','createdAt','day','id','isLeapMonth','month','name','note','reminded','reminderDays','updatedAt','year','yearly'].sort());
 assert.deepEqual({calendar:leap.calendar,year:leap.year,month:leap.month,day:leap.day,isLeapMonth:leap.isLeapMonth,yearly:leap.yearly,reminderDays:leap.reminderDays,note:leap.note},
  {calendar:'lunar',year:2025,month:6,day:12,isLeapMonth:true,yearly:true,reminderDays:7,note:'闰六月的生日'});
 assert.equal(file.days.find(day=>day.name==='一次旅行').yearly,false);
 assert.ok(file.days.find(day=>day.name==='妈妈生日').reminded.some(item=>item.stage==='today'));
 checks.push('导出独立JSON：格式标识、版本、数量、农历原始月日与闰月、已提醒节点，不含换算后的公历字段');
 await removeByName('外婆生日');await removeByName('一次旅行');
 assert.equal((await entries()).length,3);await clearToast();
 await openFrom(exported);await more();await page.getByRole('menuitem',{name:'导入重要日子'}).click();
 await importDialog().waitFor();
 assert.equal(await page.locator('.day-transfer-lead').innerText(),'即将导入：2 条新增 · 3 条重复');
 assert.match(await page.locator('.day-transfer-file').innerText(),/随手记重要日子\.json/);
 await geometry('import');await shot('03-导入预览');
 await page.getByRole('button',{name:'确认导入',exact:true}).click();await importDialog().waitFor({state:'detached'});
 assert.match(await toast(),/新增 2 条/);
 await page.waitForFunction(()=>document.querySelectorAll('.important-day-row').length===5);
 assert.equal(JSON.stringify(await entries()),JSON.stringify(before));
 assert.deepEqual(await rowTexts(),beforeRows);
 assert.equal((await page.evaluate(()=>window.notes.pendingDayReminders())).length,0);
 checks.push('删除2条后单独导入同一文件，5条全部恢复且逐字段一致，农历下次公历日期与导入前相同，已提醒节点不重放');
 await clearToast();
 await addDay({name:'新设备上补记的日子',month:5,day:1,reminder:'1',note:'本地新增'});
 assert.equal((await entries()).length,6);
 await openFrom(exported);await more();await page.getByRole('menuitem',{name:'导入重要日子'}).click();await importDialog().waitFor();
 assert.equal(await page.locator('.day-transfer-lead').innerText(),'即将导入：0 条新增 · 5 条重复');
 assert.equal(await page.locator('.day-conflict').count(),0);
 assert.match(await page.locator('.day-transfer-body').innerText(),/都已经存在，没有需要导入的内容/);
 await geometry('duplicate');await shot('04-合并重复预览');
 await page.getByRole('button',{name:'知道了',exact:true}).click();await importDialog().waitFor({state:'detached'});
 assert.equal((await entries()).length,6);assert.ok((await entries()).some(day=>day.name==='新设备上补记的日子'));
 checks.push('已有日子的环境中再次导入同一文件：本地记录不删除，全部识别为重复，不产生任何新记录');
 await removeByName('腊八');assert.equal((await entries()).length,5);await clearToast();
 await openFrom(exported);await more();await page.getByRole('menuitem',{name:'导入重要日子'}).click();await importDialog().waitFor();
 assert.equal(await page.locator('.day-transfer-lead').innerText(),'即将导入：1 条新增 · 4 条重复');
 await page.getByRole('button',{name:'确认导入',exact:true}).click();await importDialog().waitFor({state:'detached'});
 assert.match(await toast(),/新增 1 条，跳过 4 条重复记录/);
 assert.equal((await entries()).length,6);
 assert.equal(new Set((await entries()).map(day=>day.name)).size,6);
 checks.push('合并导入只补回缺失的1条，已有4条跳过，本地新增的日子保留');
 await clearToast();
 await openFrom(exported);await more();await page.getByRole('menuitem',{name:'导入重要日子'}).click();await importDialog().waitFor();
 assert.equal(await page.locator('.day-transfer-lead').innerText(),'即将导入：0 条新增 · 5 条重复');
 await page.getByRole('button',{name:'知道了',exact:true}).click();await importDialog().waitFor({state:'detached'});
 assert.equal((await entries()).length,6);
 checks.push('重复导入同一个文件不产生任何重复记录');
 await page.locator('.important-day-row').filter({hasText:'外婆生日'}).first().click();
 await page.getByRole('button',{name:'编辑',exact:true}).click();
 await page.getByLabel('提前提醒',{exact:true}).selectOption('30');
 await page.getByRole('button',{name:'保存',exact:true}).click();await page.locator('.day-dialog').waitFor({state:'detached'});await idle();
 await openFrom(exported);await more();await page.getByRole('menuitem',{name:'导入重要日子'}).click();await importDialog().waitFor();
 assert.equal(await page.locator('.day-transfer-lead').innerText(),'即将导入：0 条新增 · 4 条重复 · 1 条冲突');
 assert.match(await page.locator('.day-conflict-list').innerText(),/外婆生日[\s\S]*提前提醒[\s\S]*本地 提前30天 · 导入 提前7天/);
 await geometry('conflict');await shot('05-冲突提示');
 await page.getByRole('button',{name:'确认导入',exact:true}).click();await importDialog().waitFor({state:'detached'});
 assert.equal((await entries()).find(day=>day.name==='外婆生日').reminderDays,30);
 checks.push('同一条日子内容不同时明确提示差异，默认保留本地版本，不静默覆盖');
 await clearToast();
 await openFrom(exported);await more();await page.getByRole('menuitem',{name:'导入重要日子'}).click();await importDialog().waitFor();
 await page.getByRole('button',{name:'采用导入版本',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'采用导入版本',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'确认导入',exact:true}).click();await importDialog().waitFor({state:'detached'});
 const adopted=(await entries()).find(day=>day.name==='外婆生日');
 assert.deepEqual({calendar:adopted.calendar,year:adopted.year,month:adopted.month,day:adopted.day,isLeapMonth:adopted.isLeapMonth,yearly:adopted.yearly,reminderDays:adopted.reminderDays,note:adopted.note},
  {calendar:'lunar',year:2025,month:6,day:12,isLeapMonth:true,yearly:true,reminderDays:7,note:'闰六月的生日'});
 assert.equal((await entries()).length,6);
 checks.push('选择采用导入版本后只更新这一条，不新增记录，农历闰月、提醒与备注完整还原');
 await clearToast();
 await nav('首页');await page.locator('.home-day').first().waitFor();
 assert.match(await page.locator('.home-days').innerText(),/妈妈生日/);
 await page.locator('.home-day').first().click();await page.getByRole('dialog',{name:'重要日子详情',exact:true}).waitFor();
 assert.match(await page.locator('.day-detail').innerText(),/提前14天和当天提醒/);
 assert.equal(await page.locator('.day-detail-note').innerText(),'记得打个电话');
 await page.getByRole('button',{name:'关闭重要日子',exact:true}).click();await page.locator('.day-dialog').waitFor({state:'detached'});
 checks.push('首页临近日子提示与详情中的提醒设置、备注在导入后保持正常');
 const bad=path.join(root,'不是日子.json'),future=path.join(root,'更新版本.json'),invalid=path.join(root,'日期无效.json');
 await fs.writeFile(bad,JSON.stringify({format:'other',version:1,days:[]}));
 await fs.writeFile(future,JSON.stringify({format:'suishouji-important-days',version:2,days:[]}));
 await fs.writeFile(invalid,JSON.stringify({format:'suishouji-important-days',version:1,exportedAt:new Date().toISOString(),count:1,days:[{name:'错的农历',calendar:'lunar',year:2025,month:5,day:1,isLeapMonth:true,yearly:true,reminderDays:0,note:''}]}));
 await dates();
 for(const [file,pattern] of [[bad,/不是随手记的重要日子导出文件/],[future,/更新版本的随手记/],[invalid,/第 1 条：.*2025年没有闰五月/]]){
  await openFrom(file);await more();await page.getByRole('menuitem',{name:'导入重要日子'}).click();
  await page.locator('.toast').filter({hasText:pattern}).waitFor();await clearToast();
 }
 assert.equal((await entries()).length,6);
 checks.push('非本软件文件、过高版本和非法农历日期都被拒绝，已有日子不变');
 await resize(920,650);await openFrom(exported);await more();await page.getByRole('menuitem',{name:'导入重要日子'}).click();await importDialog().waitFor();
 await geometry('narrow import');await shot('06-窄窗口导入预览');
 await page.getByRole('button',{name:'取消',exact:true}).click();await importDialog().waitFor({state:'detached'});
 await resize(1600,960);await saveTo(exported);await more();await page.getByRole('menuitem',{name:'导出重要日子'}).click();await exportDialog().waitFor();
 await geometry('wide export');await shot('07-大窗口导出完成');
 await page.getByRole('button',{name:'完成',exact:true}).click();
 checks.push('920×650与1600×960下导入预览、导出完成弹窗不溢出，按钮可达');
 assert.deepEqual(errors,[]);await close();
 console.log(JSON.stringify({passed:true,checks,screenshots:shots,exported},null,2));
}catch(error){if(page&&!page.isClosed())await shot('failure').catch(()=>{});throw error;}finally{if(app)await app.close();}
