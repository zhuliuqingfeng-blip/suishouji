import {appRoot,repoRoot,testRoot,installedApp} from './paths.mjs';
import {_electron as electron} from 'playwright';
import {DatabaseSync} from 'node:sqlite';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const execute=promisify(execFile),guid='42be8a92-8942-4f4c-9e2c-90bd703acc4c';
const root=path.join(testRoot,'windows-installer-'+Date.now()),program=path.join(root,'program');
const local=path.join(root,'local'),data=path.join(local,'随手记'),migratedLocal=path.join(root,'migrated-local'),migrated=path.join(migratedLocal,'随手记');
const previous=path.join(repoRoot,'.artifacts/installer-previous/suishouji-1.7.99-setup-x64.exe');
const setup=path.join(repoRoot,'.artifacts/installer/suishouji-1.8.0-setup-x64.exe');
const executable=path.join(program,'随手记.exe'),uninstaller=path.join(program,'Uninstall 随手记.exe');
const desktop=path.join(process.env.USERPROFILE,'Desktop','随手记.lnk'),menu=path.join(process.env.APPDATA,'Microsoft/Windows/Start Menu/Programs/随手记.lnk');
await fs.mkdir(root,{recursive:true});
let instance,page,legacy,legacyPage;const checks=[];const preserved=[];
const hash=async file=>crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
async function exists(file){try{await fs.access(file);return true;}catch{return false;}}
async function until(fn,label){for(let i=0;i<240;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error(label+'等待超时');}
async function ps(script,env={}){return (await execute('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command','[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); '+script],{windowsHide:true,env:{...process.env,...env},maxBuffer:1024*1024})).stdout.trim();}
async function registry(){const text=await ps(`if(Test-Path -LiteralPath 'HKCU:\\Software\\${guid}'){$r=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\${guid}'; @{path=$r.InstallLocation}|ConvertTo-Json -Compress}; exit 0`);return text?JSON.parse(text):null;}
async function shortcut(file){return ps('$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:MEMO_TEST_LINK); $s.TargetPath',{MEMO_TEST_LINK:file});}
async function run(file,args=[],env={}){const process=spawn(file,args,{windowsHide:true,env:{...globalThis.process.env,...env},stdio:['ignore','pipe','pipe']});let output='';process.stdout.on('data',b=>output+=b);process.stderr.on('data',b=>output+=b);return await new Promise((resolve,reject)=>{process.once('error',reject);process.once('exit',code=>resolve({code,output}));});}
async function install(file,first=false){const result=await run(file,['/S',...(first?['/D='+program]:[])]);assert.equal(result.code,0,result.output);await until(()=>exists(executable),'安装程序');assert.equal(path.normalize((await registry()).path),path.normalize(program));}
async function launch(localRoot=local){instance=await electron.launch({executablePath:executable,args:[],env:{...process.env,LOCALAPPDATA:localRoot,NOTES_TEST_MODE:'0',NOTES_DATA_DIR:''}});page=await instance.firstWindow();await page.getByRole('button',{name:'数据与设置',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('[aria-label="数据与设置"]').disabled);}
async function close(){if(instance){const end=instance.waitForEvent('close');await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await end;instance=null;}}
function snapshot(folder){const db=new DatabaseSync(path.join(folder,'notes.sqlite'),{readOnly:true});try{return {notes:db.prepare('SELECT * FROM notes ORDER BY id').all(),assets:db.prepare('SELECT * FROM attachments ORDER BY id').all(),days:db.prepare('SELECT * FROM important_days ORDER BY id').all(),reminders:db.prepare('SELECT * FROM day_reminders ORDER BY key').all()};}finally{db.close();}}
async function assetHashes(folder){const files=await fs.readdir(path.join(folder,'attachments'));return Promise.all(files.sort().map(async file=>[file,await hash(path.join(folder,'attachments',file))]));}
async function preferences(){return page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('suishouji:')).map(k=>{let value=localStorage.getItem(k);if(k==='suishouji:workspace:v2')value=JSON.stringify({...JSON.parse(value),view:'home',focused:false});return [k,value];})));}
async function configure(){await page.evaluate(()=>{localStorage.setItem('suishouji:sort','title');localStorage.setItem('suishouji:workspace:v2',JSON.stringify({view:'home',indexWidth:430,indexHidden:false,filtersCollapsed:true,focused:false,libraryHeaderHeight:120}));});await page.reload();await page.waitForFunction(()=>!document.querySelector('[aria-label="数据与设置"]').disabled);}
async function seed(currentPage){return currentPage.evaluate(async file=>{
  const first=(await window.notes.create()).note,trash=(await window.notes.create()).note;
  const attachments=await window.notes.importPaths(first.id,[file]);
  await window.notes.save({...first,title:'留给明天的灵感',tags:['生活'],document:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'安装升级后仍在的图文记录。'}]},{type:'image',attrs:{assetId:attachments[0].id,src:'app-asset://media/'+attachments[0].id,width:180}}]}});
  await window.notes.pin(first.id,true);await window.notes.trash(trash.id);
  await window.notes.saveImportantDay({name:'纪念日',calendar:'solar',year:2000,month:3,day:17,isLeapMonth:false,yearly:true,reminderDays:14,note:'保留原始年份'});
  await window.notes.saveImportantDay({name:'农历生日',calendar:'lunar',year:null,month:8,day:15,isLeapMonth:false,yearly:true,reminderDays:14,note:'农历始终作为原始日期保存'});
  return first.id;
},path.join(appRoot,'assets/icon.png'));}
async function uninstall(){
  const reg=await registry();if(!reg)return;
  assert.equal(path.normalize(reg.path),path.normalize(program),'仅允许卸载本次隔离验收目录');
  const result=await run(uninstaller,['/S']);assert.equal(result.code,0,result.output);await until(async()=>!await registry(),'卸载注册信息');await until(async()=>!await exists(executable),'卸载程序文件');
}
function pass(label){checks.push(label);console.log('通过：'+label);}
try{
  assert.equal(await registry(),null,'已有正式安装，不能使用首次安装验收脚本覆盖');
  for(const file of [desktop,menu])if(await exists(file)){const backup=path.join(root,preserved.length+'-original.lnk');await fs.copyFile(file,backup);preserved.push({file,backup});}
  await install(previous,true);assert.equal(await shortcut(menu),executable);assert.equal(await shortcut(desktop),executable);
  await launch();assert.equal((await page.evaluate(()=>window.notes.info())).dataDir,data);assert.equal((await page.evaluate(()=>window.notes.info())).distribution,'installed');
  await page.getByRole('dialog',{name:'开始使用安装版',exact:true}).waitFor();await page.screenshot({path:path.join(root,'01-first-install.png')});
  await page.getByRole('button',{name:'直接开始',exact:true}).click();await page.getByRole('dialog',{name:'开始使用安装版',exact:true}).waitFor({state:'detached'});
  assert.equal((await page.evaluate(()=>window.notes.list({}))).length,0);pass('首次安装、引导、标准用户资料目录、开始菜单及桌面入口');
  const noteId=await seed(page);await configure();
  await page.getByRole('button',{name:'全部记录',exact:true}).click();await page.locator('.note-card').filter({hasText:'留给明天的灵感'}).click();
  await page.getByRole('textbox',{name:'记录正文',exact:true}).press('End');
  const db=new DatabaseSync(path.join(data,'notes.sqlite'));db.exec("CREATE TRIGGER qa_stop_save BEFORE UPDATE OF title ON notes BEGIN SELECT RAISE(ABORT,'验收保存失败'); END;");db.close();
  await page.getByLabel('记录标题',{exact:true}).fill('最后一刻输入也要保存');await page.getByRole('alert').waitFor();
  const unchanged=snapshot(data),rejected=await run(setup,['/S']);assert.equal(rejected.code,2);assert.deepEqual(snapshot(data),unchanged);assert.equal((await page.evaluate(()=>window.notes.info())).version,'1.7.99');
  const writable=new DatabaseSync(path.join(data,'notes.sqlite'));writable.exec('DROP TRIGGER qa_stop_save;');writable.close();
  await page.keyboard.press('Control+s');await page.waitForFunction(async()=> (await window.notes.list({})).some(n=>n.title==='最后一刻输入也要保存'));
  pass('真实保存失败时安装器停止升级，不强杀应用，数据和旧程序仍可用');
  const before=snapshot(data),assetsBefore=await assetHashes(data),prefsBefore=await preferences();
  const backups=await fs.readdir(path.join(data,'自动备份'));const backupHashes=await Promise.all(backups.map(async file=>[file,await hash(path.join(data,'自动备份',file))]));
  const end=instance.waitForEvent('close');await install(setup);await end;instance=null;
  assert.deepEqual(snapshot(data),before);assert.deepEqual(await assetHashes(data),assetsBefore);
  await launch();assert.equal((await page.evaluate(()=>window.notes.info())).version,'1.8.0');assert.deepEqual(await preferences(),prefsBefore);
  assert.equal(await shortcut(menu),executable);assert.equal(await shortcut(desktop),executable);
  for(const [file,value] of backupHashes)assert.equal(await hash(path.join(data,'自动备份',file)),value);
  assert.ok((await fs.readdir(path.join(data,'升级前备份'))).length);pass('1.7.99直接覆盖至1.8.0，正常保存退出，内容、图片、重要日子、布局、备份和快捷方式保持');
  const other=await run(executable,[],{LOCALAPPDATA:local,NOTES_TEST_MODE:'0',NOTES_DATA_DIR:''});assert.equal(other.code,0);assert.equal((await instance.windows()).length,1);pass('重复启动复用已有窗口');
  await close();const beforeUninstall=snapshot(data),beforeUninstallAssets=await assetHashes(data);
  // Interrupt the real installer only after it has begun replacing its own program files.
  // The test owns this installer process and its installation directory; no note process is killed.
  const interrupted=spawn(setup,['/S'],{windowsHide:true,stdio:'ignore'});
  let stopped=false;interrupted.once('exit',()=>{stopped=true;});
  await until(async()=>!await exists(path.join(program,'resources','app.asar'))||stopped,'安装替换阶段');
  assert.equal(stopped,false,'必须确实在安装过程中中断');
  const interruptedEnd=new Promise(resolve=>interrupted.once('exit',resolve));interrupted.kill();await interruptedEnd;
  await until(async()=>!await registry()&&!await exists(executable),'被中断安装的旧版清理');
  assert.deepEqual(snapshot(data),beforeUninstall);assert.deepEqual(await assetHashes(data),beforeUninstallAssets);
  await install(setup,true);await launch();assert.deepEqual(snapshot(data),beforeUninstall);assert.deepEqual(await preferences(),prefsBefore);await close();
  pass('真实安装替换途中终止安装器，原资料不变，再运行安装包可修复并继续使用');
  await uninstall();assert.deepEqual(snapshot(data),beforeUninstall);assert.deepEqual(await assetHashes(data),beforeUninstallAssets);assert.equal(await exists(menu),false);
  await install(setup,true);await launch();assert.deepEqual(snapshot(data),beforeUninstall);assert.deepEqual(await preferences(),prefsBefore);assert.equal(await page.getByRole('dialog',{name:'开始使用安装版',exact:true}).count(),0);await close();
  pass('卸载只移除程序，重新安装继续读取原资料和设置');

  const legacyProgram=path.join(root,'legacy-program');await fs.cp(installedApp,legacyProgram,{recursive:true,filter:source=>source!==path.join(installedApp,'我的数据')});
  legacy=await electron.launch({executablePath:path.join(legacyProgram,'随手记.exe'),args:[],env:{...process.env,NOTES_TEST_MODE:'0',NOTES_DATA_DIR:''}});legacyPage=await legacy.firstWindow();await legacyPage.waitForFunction(()=>{const button=document.querySelector('[aria-label="数据与设置"]');return button&&!button.disabled;});
  const legacyId=await seed(legacyPage);await legacyPage.evaluate(id=>{localStorage.setItem('suishouji:sort','created');localStorage.setItem('suishouji:last-note',id);localStorage.setItem('suishouji:workspace:v2',JSON.stringify({view:'home',indexWidth:410,indexHidden:false,filtersCollapsed:true,focused:false,libraryHeaderHeight:130}));},legacyId);
  await launch(migratedLocal);await page.getByRole('dialog',{name:'开始使用安装版',exact:true}).waitFor();
  await instance.evaluate(({dialog,app},source)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]});dialog.showMessageBox=async()=>({response:1});globalThis.qaRelaunchRequested=false;app.relaunch=()=>{globalThis.qaRelaunchRequested=true;};},legacyProgram);
  await page.getByRole('button',{name:'从免安装版导入',exact:true}).click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/还在运行/);
  assert.equal((await page.evaluate(()=>window.notes.list({}))).length,0);
  const legacyClosed=legacy.waitForEvent('close');await legacy.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await legacyClosed;legacy=null;
  const legacyData=path.join(legacyProgram,'我的数据'),sourceHash=await hash(path.join(legacyData,'notes.sqlite')),sourceSnapshot=snapshot(legacyData),sourceAssets=await assetHashes(legacyData);
  const importedEnd=instance.waitForEvent('close');await page.getByRole('button',{name:'从免安装版导入',exact:true}).click();await importedEnd;instance=null;
  await launch(migratedLocal);assert.deepEqual(snapshot(migrated),sourceSnapshot);assert.deepEqual(await assetHashes(migrated),sourceAssets);assert.equal(await hash(path.join(legacyData,'notes.sqlite')),sourceHash);
  const migratedPrefs=await preferences();assert.equal(migratedPrefs['suishouji:sort'],'created');assert.equal(migratedPrefs['suishouji:last-note'],legacyId);assert.equal(JSON.parse(migratedPrefs['suishouji:workspace:v2']).indexWidth,410);
  await page.getByRole('button',{name:'继续上次记录',exact:true}).click();await page.locator('.tiptap img').waitFor();await page.waitForFunction(()=>document.querySelector('.tiptap img')?.naturalWidth>0);
  await page.screenshot({path:path.join(root,'02-migrated-content.png')});
  assert.equal((await page.evaluate(()=>window.notes.info())).needsSetup,false);
  await assert.rejects(page.evaluate(()=>window.notes.importLegacy()),/已有手记|已有资料/);pass('真实1.7.2 Portable导入、运行检测、原件不变、公农历日期、图片与布局设置完整、禁止重复覆盖');
  const backup=path.join(root,'安装版完整备份.zip');
  await instance.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:1});},backup);
  await page.evaluate(()=>window.notes.backup());await page.evaluate(async id=>{const detail=await window.notes.get(id);await window.notes.save({...detail.note,title:'临时修改'});await window.notes.restoreBackup();},legacyId);
  assert.equal((await page.evaluate(id=>window.notes.get(id),legacyId)).note.title,'留给明天的灵感');assert.equal(await hash(path.join(legacyData,'notes.sqlite')),sourceHash);await close();pass('安装版仍可完整备份恢复，原Portable资料保持独立');
  await uninstall();
  console.log(JSON.stringify({passed:true,checks,root,limitations:'本机隔离资料与独立安装目录验收，未使用另一台实体电脑或独立Windows虚拟机。'},null,2));
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});throw error;}
finally{
  if(instance)await instance.close().catch(()=>{});if(legacy)await legacy.close().catch(()=>{});
  const reg=await registry();if(reg&&path.normalize(reg.path)===path.normalize(program))await uninstall();
  for(const {file,backup} of preserved){if(!await exists(file)||path.normalize(await shortcut(file))===path.normalize(executable))await fs.copyFile(backup,file);}
}
