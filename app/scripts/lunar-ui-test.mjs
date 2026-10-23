import {appRoot,testRoot} from './paths.mjs';
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
process.chdir(appRoot);
const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
const root=path.join(testRoot,'lunar-'+Date.now()),shots=path.join(testRoot,'lunar-'+version);
await fs.mkdir(root,{recursive:true});await fs.mkdir(shots,{recursive:true});
let app,page,clock=new Date(2025,4,26,12).getTime();const errors=[],checks=[];
function fakeDate(time){const Original=globalThis.__nativeTestDate??Date;globalThis.__nativeTestDate=Original;globalThis.Date=class extends Original{constructor(...args){if(args.length)super(...args);else super(time);}static now(){return time;}};}
function mainFakeDate(_electron,time){const Original=globalThis.__nativeTestDate??Date;globalThis.__nativeTestDate=Original;globalThis.Date=class extends Original{constructor(...args){if(args.length)super(...args);else super(time);}static now(){return time;}};}
async function launch(){
  app=await electron.launch({executablePath:process.env.NOTES_PACKAGED_EXE||electronPath,args:process.env.NOTES_PACKAGED_EXE?[]:[appRoot],env:{...process.env,NOTES_TEST_MODE:'1',NOTES_DATA_DIR:root}});
  await app.evaluate(mainFakeDate,clock);
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await page.locator('.home-mode').waitFor();await ready();
  await page.context().route(/^https?:\/\//,route=>route.abort());
  await page.addInitScript(fakeDate,clock);
  await page.reload();await page.locator('.home-mode').waitFor();await ready();
}
async function ready(){await page.waitForFunction(()=>!document.querySelector('.space-tabs button')?.disabled);}
async function close(){const end=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await end;app=null;}
async function nav(name){await page.getByRole('button',{name,exact:true}).click();await ready();}
async function dates(){await nav('重要日子');await page.waitForFunction(()=>!document.querySelector('.day-add')?.disabled);}
async function setClock(time){clock=time;await app.evaluate(mainFakeDate,time);await page.evaluate(fakeDate,time);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));}
async function entries(){return page.evaluate(()=>window.notes.listImportantDays());}
async function add(name,{year='',month='5',day='6',yearly=true,note=''}={}){
  await page.getByRole('button',{name:'添加重要日子',exact:true}).click();await page.getByLabel('日子名称',{exact:true}).fill(name);await page.getByRole('button',{name:'农历',exact:true}).click();
  if(year)await page.getByLabel('年份',{exact:true}).fill(year);
  await page.getByLabel('月份',{exact:true}).selectOption(month);await page.getByLabel('日期',{exact:true}).selectOption(day);
  if(!yearly)await page.getByLabel('每年重复',{exact:true}).uncheck();if(note)await page.getByLabel('日子备注',{exact:true}).fill(note);
}
async function save(){await page.getByRole('button',{name:'保存',exact:true}).click();await page.locator('.day-dialog').waitFor({state:'detached'});}
async function shot(name){await page.mouse.move(1,1);await page.screenshot({path:path.join(shots,name+'.png')});}
async function geometry(){assert.deepEqual(await page.evaluate(()=>{
  const failures=[],root=document.querySelector('.day-dialog')||document.querySelector('.important-days-page,.home-page');
  if(document.documentElement.scrollWidth>innerWidth||root.scrollWidth>root.clientWidth+1)failures.push('横向溢出');
  for(const el of root.querySelectorAll('button,input,select,textarea')){
    if(!el.checkVisibility())continue;const r=el.getBoundingClientRect();if(r.left<0||r.right>innerWidth+1)failures.push('控件超出窗口');
    const body=el.closest('.day-form,.day-detail');if(body){const bounds=body.getBoundingClientRect();if(r.top<bounds.top||r.bottom>bounds.bottom)continue;}
    if(r.top>=0&&r.bottom<=innerHeight){const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(hit!==el&&!el.contains(hit))failures.push('控件被遮挡');}
  }
  for(const button of root.querySelectorAll('.day-dialog-actions button')){const r=button.getBoundingClientRect();if(r.top<0||r.bottom>innerHeight)failures.push('固定操作按钮不可见');}
  return failures;
}),[]);}
try{
  await launch();await page.evaluate(()=>window.notes.saveImportantDay({name:'公历纪念日',calendar:'solar',year:null,month:5,day:30,yearly:true,reminderDays:14,note:''}));
  await dates();await add('妈妈生日（农历）',{note:'去年提到想去看海。'});assert.equal(await page.getByRole('button',{name:'农历',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await page.getByLabel('年份',{exact:true}).inputValue(),'');await geometry();await shot('01-农历录入');await save();
  let lunar=(await entries()).find(d=>d.calendar==='lunar');assert.deepEqual([lunar.year,lunar.month,lunar.day,lunar.isLeapMonth],[null,5,6,false]);
  let row=page.locator('.important-day-row').filter({hasText:'妈妈生日（农历）'});assert.match(await row.innerText(),/农历五月初六 · 每年/);assert.match(await row.innerText(),/下次：2025年6月1日/);assert.match(await row.innerText(),/还有6天/);assert.doesNotMatch(await row.innerText(),/看海/);await shot('02-公历农历列表');checks.push('公历农历并列，中文农历录入、可选年份、列表主次日期与备注边界');
  await row.click();await page.getByText('下次对应公历：2025年6月1日',{exact:true}).waitFor();await page.getByText('去年提到想去看海。',{exact:true}).waitFor();await shot('03-农历详情');
  await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByLabel('年份',{exact:true}).fill('2001');await save();lunar=(await entries()).find(d=>d.id===lunar.id);assert.equal(lunar.year,2001);assert.equal(lunar.month,5);assert.equal(lunar.day,6);checks.push('详情同时显示日期体系，编辑保存原始农历年份和月日');
  await add('闰六月生日',{year:'2025',month:'-6',day:'1'});assert.ok((await page.getByLabel('月份',{exact:true}).locator('option').allTextContents()).includes('六月'));assert.ok((await page.getByLabel('月份',{exact:true}).locator('option').allTextContents()).includes('闰六月'));await save();
  const leap=(await entries()).find(d=>d.isLeapMonth);assert.equal(leap.calendar,'lunar');assert.deepEqual([leap.year,leap.month,leap.day],[2025,6,1]);await page.locator('.important-day-row').filter({hasText:'闰六月生日'}).click();await page.getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByLabel('年份',{exact:true}).fill('2026');assert.equal(await page.getByLabel('月份',{exact:true}).inputValue(),'-6');await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('alert').filter({hasText:'没有闰六月'}).waitFor();assert.equal((await entries()).find(d=>d.id===leap.id).year,2025);assert.equal(await page.getByLabel('月份',{exact:true}).inputValue(),'-6');
  await page.getByLabel('年份',{exact:true}).fill('2025');await page.getByLabel('日期',{exact:true}).selectOption('30');await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('alert').filter({hasText:'只有29天'}).waitFor();assert.equal(await page.getByLabel('日期',{exact:true}).inputValue(),'30');await page.getByLabel('日期',{exact:true}).selectOption('29');await save();checks.push('闰月独立选择，切换到无闰月年份或小月三十均阻止保存并保留输入');
  await add('一次性农历日子',{yearly:false});await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('alert').filter({hasText:'需要填写年份'}).waitFor();await page.getByLabel('年份',{exact:true}).fill('1899');await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('alert').filter({hasText:'1900—2100'}).waitFor();await page.getByLabel('年份',{exact:true}).fill('2025');await save();checks.push('一次性农历年份必填，支持范围校验，不替换原日期');
  await nav('首页');await page.locator('.home-day').filter({hasText:'妈妈生日（农历）'}).waitFor();assert.match(await page.locator('.home-day').filter({hasText:'妈妈生日（农历）'}).innerText(),/还有6天/);await shot('04-首页轻提示');
  await setClock(new Date(2025,5,1,12).getTime());await page.waitForFunction(()=>[...document.querySelectorAll('.home-day')].some(el=>el.textContent.includes('妈妈生日（农历）')&&el.textContent.includes('今天')));assert.doesNotMatch(await page.locator('.home-days').innerText(),/还有0天/);
  await setClock(new Date(2025,5,2,12).getTime());await dates();await page.getByText('下次：2026年6月20日',{exact:true}).waitFor();await page.locator('.past-days summary').click();await page.locator('.past-days .important-day-row').filter({hasText:'一次性农历日子'}).waitFor();checks.push('首页沿用临近轻提示和今天表达，经过当天后重复日期换年，一次性日期进入过去');
  const beforeBackup=await entries(),backup=path.join(root,'农历完整备份.zip');
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},backup);await page.getByRole('button',{name:'数据与设置',exact:true}).click();await page.getByRole('button',{name:'备份全部数据',exact:true}).click();await page.getByRole('status').filter({hasText:'备份已保存'}).waitFor();await ready();await fs.access(backup);
  await page.evaluate(id=>window.notes.removeImportantDay(id),leap.id);
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:1});},backup);await page.getByRole('button',{name:'数据与设置',exact:true}).click();await page.getByRole('button',{name:'从备份恢复',exact:true}).click();await page.getByRole('status').filter({hasText:'备份已恢复'}).waitFor();await ready();assert.deepEqual(await entries(),beforeBackup);checks.push('实际窗口的完整备份恢复保留农历、闰月和公历记录');
  await close();await launch();assert.deepEqual(await entries(),beforeBackup);await dates();checks.push('关闭重开仍保留原始日期体系，断开外部网络后转换可用');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(920,650));await page.waitForFunction(()=>innerWidth===920);await add('窄窗口里的农历日期',{year:'2028',month:'-5',day:'6'});await geometry();await shot('05-窄窗口农历表单');await page.getByRole('button',{name:'保存',exact:true}).scrollIntoViewIfNeeded();await geometry();await save();await geometry();await shot('06-窄窗口农历列表');checks.push('920×650窗口内日期切换、闰月选项、表单滚动和保存按钮均可达');
  await page.evaluate(()=>window.notes.saveImportantDay({name:'闰冬月纪念日',calendar:'lunar',year:null,month:11,day:1,isLeapMonth:true,yearly:true,reminderDays:14,note:''}));await setClock(new Date(2034,0,20,12).getTime());await dates();
  row=page.locator('.important-day-row').filter({hasText:'闰冬月纪念日'});await row.waitFor();assert.match(await row.innerText(),/暂无下次日期/);await row.click();await page.getByText(/原始日期仍保留，可继续编辑/).waitFor();await page.getByRole('button',{name:'关闭重要日子',exact:true}).click();await nav('首页');assert.equal(await page.locator('.home-day').filter({hasText:'闰冬月纪念日'}).count(),0);checks.push('支持范围内无下次日期时保留记录和编辑入口，不虚构倒计时或首页提醒');
  assert.deepEqual(errors,[]);await close();console.log(JSON.stringify({passed:true,checks,screenshots:shots},null,2));
}catch(error){if(page&&!page.isClosed())await shot('failure').catch(()=>{});throw error;}finally{if(app)await app.close();}
