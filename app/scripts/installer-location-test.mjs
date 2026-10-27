import {appRoot,repoRoot,testRoot} from './paths.mjs';
import {_electron as electron} from 'playwright';
import {DatabaseSync} from 'node:sqlite';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const execute=promisify(execFile),guid='8f0de495-bfe9-43aa-bb9f-e7ce5277c862';
const root=path.join(testRoot,'installer-location-'+Date.now()),first=path.join(root,'中文 软件','随手记'),second=path.join(root,'另一个 位置','我的随手记');
const local=path.join(root,'user-local'),data=path.join(local,'随手记'),name='随手记（安装验收）';
const older=path.join(repoRoot,'.artifacts/installer-location-qa/1.8.0/suishouji-1.8.0-setup-x64.exe');
const version=JSON.parse(await fs.readFile(path.join(appRoot,'package.json'),'utf8')).version;
const newer=path.join(repoRoot,`.artifacts/installer-location-qa/${version}/suishouji-${version}-setup-x64.exe`);
const desktop=path.join(process.env.USERPROFILE,'Desktop',name+'.lnk'),menu=path.join(process.env.APPDATA,'Microsoft/Windows/Start Menu/Programs',name+'.lnk');
const protectedData=path.join(process.env.LOCALAPPDATA,'随手记');
await fs.mkdir(root,{recursive:true});let app,page;const checks=[];
async function exists(file){try{await fs.access(file);return true;}catch{return false;}}
const hash=async file=>crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
async function ps(code,env={}){return (await execute('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command','[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); '+code],{windowsHide:true,env:{...process.env,...env}})).stdout.trim();}
async function registry(){const text=await ps(`if(Test-Path 'HKCU:\\Software\\${guid}'){$r=Get-ItemProperty 'HKCU:\\Software\\${guid}';@{path=$r.InstallLocation}|ConvertTo-Json -Compress};exit 0`);return text?JSON.parse(text):null;}
async function shortcut(file){return ps('$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:MEMO_LINK);$s.TargetPath',{MEMO_LINK:file});}
async function run(file,args=[]){return new Promise((resolve,reject)=>{const child=spawn(file,args,{windowsHide:true,windowsVerbatimArguments:true,stdio:'ignore'});child.once('error',reject);child.once('exit',resolve);});}
async function until(fn,label){for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error(label+'超时');}
async function install(file,destination){return run(file,['/S',...(destination?['/D='+destination]:[])]);}
async function launch(folder){app=await electron.launch({executablePath:path.join(folder,'随手记.exe'),args:[],env:{...process.env,LOCALAPPDATA:local,NOTES_TEST_MODE:'0',NOTES_DATA_DIR:''}});page=await app.firstWindow();await page.waitForFunction(()=>{const b=document.querySelector('[aria-label="数据与设置"]');return b&&!b.disabled;});}
async function close(){if(app){const end=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await end;app=null;}}
function snapshot(){const db=new DatabaseSync(path.join(data,'notes.sqlite'),{readOnly:true});try{return {notes:db.prepare('SELECT * FROM notes ORDER BY id').all(),assets:db.prepare('SELECT * FROM attachments ORDER BY id').all(),days:db.prepare('SELECT * FROM important_days ORDER BY id').all()};}finally{db.close();}}
async function uninstall(){const reg=await registry();if(!reg)return;assert.ok([first,second].includes(reg.path),'禁止卸载隔离目录以外的程序');assert.equal(await run(path.join(reg.path,'Uninstall 随手记.exe'),['/S']),0);await until(async()=>!await registry(),'卸载注册项');}
function passed(message){checks.push(message);console.log('通过：'+message);}
try{
  assert.equal(await registry(),null);assert.equal(await exists(desktop),false);assert.equal(await exists(menu),false);
  assert.equal(await install(older,first),0);assert.equal((await registry()).path,first);assert.equal(await shortcut(desktop),path.join(first,'随手记.exe'));
  await launch(first);await page.getByRole('button',{name:'直接开始',exact:true}).click();
  const id=await page.evaluate(async file=>{const {note}=await window.notes.create();await window.notes.save({...note,title:'自选目录中的手记',document:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'程序换位置，资料留在原来的用户目录。'}]}]}});await window.notes.importPaths(note.id,[file]);await window.notes.saveImportantDay({name:'农历生日',calendar:'lunar',year:null,month:8,day:15,isLeapMonth:false,yearly:true,reminderDays:14,note:''});localStorage.setItem('suishouji:sort','created');return note.id;},path.join(appRoot,'assets/icon.png'));
  await page.reload();await page.waitForFunction(()=>{const b=document.querySelector('[aria-label="数据与设置"]');return b&&!b.disabled;});await close();
  const before=snapshot();passed('中文及空格目录精确安装，开始菜单和桌面入口正确');

  const foreign=path.join(root,'已有其他文件的目录');await fs.mkdir(foreign);await fs.writeFile(path.join(foreign,'不能删除.txt'),'这些资料不能被程序覆盖或卸载');
  assert.equal(await install(newer,foreign),3);assert.equal(await fs.readFile(path.join(foreign,'不能删除.txt'),'utf8'),'这些资料不能被程序覆盖或卸载');assert.equal((await registry()).path,first);
  const originalDb=path.join(protectedData,'notes.sqlite'),originalHash=await exists(originalDb)?await hash(originalDb):null;
  assert.equal(await install(newer,protectedData),3);if(originalHash)assert.equal(await hash(originalDb),originalHash);assert.equal((await registry()).path,first);
  const linked=path.join(root,'目录链接');await fs.symlink(path.join(root,'中文 软件'),linked,'junction');assert.equal(await install(newer,path.join(linked,'另一个程序')),3);assert.equal((await registry()).path,first);
  passed('拒绝资料目录、已有其他文件的目录和链接目录，旧安装与资料不变');

  assert.equal(await install(newer),0);assert.equal((await registry()).path,first);assert.deepEqual(snapshot(),before);
  await launch(first);assert.equal((await page.evaluate(()=>window.notes.info())).version,version);assert.equal((await page.evaluate(()=>window.notes.info())).dataDir,data);assert.equal(await page.evaluate(()=>localStorage.getItem('suishouji:sort')),'created');
  passed('新版不指定目录时自动沿用旧位置，原内容和设置保留');
  await page.getByRole('button',{name:'全部记录',exact:true}).click();await page.locator('.note-card').filter({hasText:'自选目录中的手记'}).click();await page.getByLabel('记录标题',{exact:true}).fill('换位置之前刚刚输入');
  const end=app.waitForEvent('close');assert.equal(await install(newer,second),0);await end;app=null;
  assert.equal((await registry()).path,second);assert.equal(await exists(path.join(first,'随手记.exe')),false);assert.equal(await shortcut(desktop),path.join(second,'随手记.exe'));assert.equal(await shortcut(menu),path.join(second,'随手记.exe'));
  await launch(second);const detail=await page.evaluate(id=>window.notes.get(id),id);assert.equal(detail.note.title,'换位置之前刚刚输入');assert.equal(detail.note.plainText,'程序换位置，资料留在原来的用户目录。');assert.deepEqual(snapshot().days,before.days);assert.deepEqual(snapshot().assets,before.assets);assert.equal((await page.evaluate(()=>window.notes.info())).dataDir,data);assert.equal(await page.evaluate(()=>localStorage.getItem('suishouji:sort')),'created');await close();
  passed('已运行的程序更换位置时正常保存退出，手记、农历、附件、设置和快捷方式继续可用');
  const moved=snapshot();await uninstall();assert.deepEqual(snapshot(),moved);assert.equal(await install(newer,second),0);await launch(second);assert.deepEqual(snapshot(),moved);await close();await uninstall();passed('自选目录卸载与重装保留个人资料');
  const result={passed:true,checks,root};await fs.writeFile(path.join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{if(app)await app.close().catch(()=>{});await uninstall();}
