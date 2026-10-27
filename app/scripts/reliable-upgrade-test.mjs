import {repoRoot,appRoot,testRoot,installedApp} from './paths.mjs';
import {_electron as electron} from 'playwright';
import {DatabaseSync} from 'node:sqlite';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {dataFingerprint} from '../dist-electron/installer-maintenance.js';
import {sha256,Store} from '../dist-electron/store.js';
const execute=promisify(execFile),guid='8f0de495-bfe9-43aa-bb9f-e7ce5277c862',name='随手记（安装验收）';
const root=path.join(testRoot,'reliable-upgrade-'+Date.now());await fs.mkdir(root,{recursive:true});
const version=JSON.parse(await fs.readFile(path.join(appRoot,'package.json'),'utf8')).version;
const baseline=path.join(repoRoot,'.artifacts/installer-location-qa/1.8.1/suishouji-1.8.1-setup-x64.exe');
const setup=path.join(repoRoot,`.artifacts/installer-location-qa/${version}/suishouji-${version}-setup-x64.exe`);
const desktop=path.join(process.env.USERPROFILE,'Desktop',name+'.lnk'),menu=path.join(process.env.APPDATA,'Microsoft/Windows/Start Menu/Programs',name+'.lnk');
let app,page,legacy,legacyPage,local=path.join(root,'case-ab'),program;
const checks=[];
async function exists(file){try{await fs.access(file);return true;}catch{return false;}}
async function ps(code,env={}){return (await execute('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command','[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); '+code],{windowsHide:true,env:{...process.env,...env}})).stdout.trim();}
async function reg(){const text=await ps(`if(Test-Path 'HKCU:\\Software\\${guid}'){$r=Get-ItemProperty 'HKCU:\\Software\\${guid}';@{path=$r.InstallLocation}|ConvertTo-Json -Compress};exit 0`);return text?JSON.parse(text):null;}
async function until(fn,label){for(let i=0;i<300;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error(label+'超时');}
const env=()=>({...process.env,MEMO_INSTALL_QA_LOCALAPPDATA:local});
async function install(file=setup,destination){return new Promise((resolve,reject)=>{const child=spawn(file,['/S',...(destination?['/D='+destination]:[])],{windowsHide:true,windowsVerbatimArguments:true,env:env(),stdio:'ignore'});child.once('error',reject);child.once('exit',resolve);});}
async function launch(){program=(await reg()).path;app=await electron.launch({executablePath:path.join(program,'随手记.exe'),args:[],env:{...process.env,LOCALAPPDATA:local,NOTES_TEST_MODE:'0',NOTES_DATA_DIR:''}});page=await app.firstWindow();await ready(page);}
async function ready(p){await p.waitForFunction(()=>{const b=document.querySelector('[aria-label="数据与设置"]');return b&&!b.disabled;});}
async function close(){if(app){const end=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await end;app=null;}}
async function uninstall(){const entry=await reg();if(!entry)return;const relative=path.relative(root,entry.path);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'不得卸载正式安装');const result=await new Promise((resolve,reject)=>{const c=spawn(path.join(entry.path,'Uninstall 随手记.exe'),['/S'],{windowsHide:true,stdio:'ignore'});c.once('error',reject);c.once('exit',resolve);});assert.equal(result,0);await until(async()=>!await reg(),'卸载');}
async function seed(p){return p.evaluate(async file=>{
 const {note}=await window.notes.create(),assets=await window.notes.importPaths(note.id,[file]);
 await window.notes.save({...note,title:'需要保留的手记',tags:['生活'],document:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'旧版的文字和图片。'}]},{type:'image',attrs:{assetId:assets[0].id,src:'app-asset://media/'+assets[0].id,width:120}}]}});
 await window.notes.saveImportantDay({name:'农历生日',calendar:'lunar',year:2000,month:8,day:15,isLeapMonth:false,yearly:true,reminderDays:14,note:'一起保留'});
 localStorage.setItem('suishouji:last-note',note.id);localStorage.setItem('suishouji:sort','created');localStorage.setItem('suishouji:workspace:v2',JSON.stringify({view:'home',indexWidth:410,indexHidden:false,filtersCollapsed:true,focused:false,libraryHeaderHeight:120}));return note.id;
},path.join(appRoot,'assets/icon.png'));}
function pass(label){checks.push(label);console.log('通过：'+label);}
const data=()=>path.join(local,'随手记'),work=()=>path.join(local,'.随手记-迁移');
async function backupCount(){try{return (await fs.readdir(path.join(work(),'prepared'))).length;}catch{return 0;}}
async function shortcut(file){return ps('$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:MEMO_LINK);$s.TargetPath',{MEMO_LINK:file});}
try{
 assert.equal(await reg(),null,'正式安装使用不同GUID；QA已有注册时停止');
 if(!await exists(baseline))throw new Error('缺少真实1.8.1基线。请在1.8.1源码中使用--location-qa构建，放入.artifacts/installer-location-qa/1.8.1；不要给新代码伪造旧版本号。');
 assert.equal(await exists(desktop),false);assert.equal(await exists(menu),false);
 // A: genuine 1.8.1 installer, not current code with an artificially lowered version.
 const first=path.join(root,'中文 安装位置','随手记');assert.equal(await install(baseline,first),0);await launch();assert.equal((await page.evaluate(()=>window.notes.info())).version,'1.8.1');await page.getByRole('button',{name:'直接开始',exact:true}).click();const id=await seed(page);await page.reload();await ready(page);pass('无旧版安装1.8.1并正常建立图文手记、农历日子和设置');
 await page.getByRole('button',{name:'全部记录',exact:true}).click();await page.locator('.note-card').filter({hasText:'需要保留的手记'}).click();await page.getByLabel('记录标题',{exact:true}).fill('升级前刚刚输入');
 await fs.rm(path.join(first,'.suishouji-install-root.json'),{force:true});
 const ended=app.waitForEvent('close');assert.equal(await install(),0);await ended;app=null;assert.equal((await reg()).path,first);
 await launch();assert.equal((await page.evaluate(()=>window.notes.info())).version,version);assert.equal((await page.evaluate(id=>window.notes.get(id),id)).note.title,'升级前刚刚输入');assert.equal((await page.evaluate(()=>window.notes.listImportantDays())).length,1);assert.equal(await page.evaluate(()=>localStorage.getItem('suishouji:sort')),'created');assert.equal(await page.getByRole('dialog',{name:'开始使用安装版',exact:true}).count(),0);await close();pass('真实1.8.1无目录标记也可直接覆盖升级1.8.2，路径、草稿、资料和设置保持');
 const expected=await dataFingerprint(data());await uninstall();assert.equal(await dataFingerprint(data()),expected);
 // D: an old installed program directory without registry or directory marker is recognizable.
 const orphan=path.join(root,'旧正式版无标记');await fs.cp(path.join(repoRoot,'.artifacts/installer-location-qa/1.8.1/win-unpacked'),orphan,{recursive:true});await fs.rm(path.join(orphan,'.suishouji-install-root.json'),{force:true});assert.equal(await install(setup,orphan),0);assert.equal((await reg()).path,orphan);assert.equal(await dataFingerprint(data()),expected);pass('无注册信息和新版标记的真实旧正式程序，凭exe及ASAR身份正确识别');
 await uninstall();assert.equal(await install(setup,first),0);await launch();assert.equal(await dataFingerprint(data()),expected);await close();pass('卸载保留用户资料，重新安装直接读取，无需导入');await uninstall();
 // E: unrelated directory, including a forged directory marker, stays protected.
 const foreign=path.join(root,'无关资料');await fs.mkdir(foreign);await fs.writeFile(path.join(foreign,'报告.txt'),'不能删除');await fs.writeFile(path.join(foreign,'.suishouji-install-root.json'),'{"format":"suishouji-install-root","version":1}');assert.equal(await install(setup,foreign),3);assert.equal(await fs.readFile(path.join(foreign,'报告.txt'),'utf8'),'不能删除');assert.equal(await reg(),null);pass('未知文件夹即使伪造新版标记也不会被当成随手记覆盖');
 // C: real Portable executable; the test never copies personal data from installedApp.
 const old=path.join(root,'旧版容器','随手记');await fs.cp(installedApp,old,{recursive:true,filter:file=>file!==path.join(installedApp,'我的数据')});
 legacy=await electron.launch({executablePath:path.join(old,'随手记.exe'),args:[],env:{...process.env,NOTES_TEST_MODE:'0',NOTES_DATA_DIR:''}});legacyPage=await legacy.firstWindow();await ready(legacyPage);const legacyId=await seed(legacyPage);await legacyPage.reload();await ready(legacyPage);
 const original=path.join(old,'我的数据'),beforeOriginal=await dataFingerprint(original);local=path.join(root,'case-portable');
 const oldEnded=legacy.waitForEvent('close');assert.equal(await install(setup,old),0);await oldEnded;legacy=null;
 program=(await reg()).path;assert.notEqual(program,old);assert.ok(program.startsWith(path.join(local,'Programs')+path.sep));assert.equal(await dataFingerprint(original),beforeOriginal);assert.equal(await dataFingerprint(data()),beforeOriginal);await fs.access(path.join(old,'随手记.exe'));assert.equal(await backupCount(),1);
 await launch();assert.equal(await page.getByRole('dialog',{name:'开始使用安装版',exact:true}).count(),0);assert.equal(await page.evaluate(()=>localStorage.getItem('suishouji:sort')),'created');assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('suishouji:workspace:v2'))).indexWidth,410);await page.getByRole('button',{name:'继续上次记录',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.tiptap img')?.naturalWidth>0);await close();pass('选择真实旧Portable目录：安装器安全关闭旧版、先备份、自动迁移并校验，原程序和数据完整保留');
 const migrated=await dataFingerprint(data()),copies=await backupCount();const modified=new Store(original);const detail=modified.get(legacyId);modified.save({...detail.note,title:'旧版后来改过的内容'});modified.close();
 assert.equal(await install(),0);assert.equal(await dataFingerprint(data()),migrated);assert.equal(await backupCount(),copies);
 assert.equal(await install(setup,old),0);assert.equal((await reg()).path,program);assert.equal(await dataFingerprint(data()),migrated);assert.equal(await backupCount(),copies);pass('后续安装不再迁移；同时发现Portable时优先保留正式数据，不重复导入或覆盖');
 // G: interrupt only this test installer after program replacement begins.
 const interrupted=spawn(setup,['/S'],{windowsHide:true,env:env(),stdio:'ignore'});let exited=false;interrupted.once('exit',()=>exited=true);
 await until(async()=>!await exists(path.join(program,'resources/app.asar'))||exited,'安装替换阶段');assert.equal(exited,false);const stopped=new Promise(resolve=>interrupted.once('exit',resolve));interrupted.kill();await stopped;await until(async()=>!await reg()&&!await exists(path.join(program,'随手记.exe')),'中断清理');
 assert.equal(await dataFingerprint(data()),migrated);assert.equal(await install(),0);await launch();assert.equal(await dataFingerprint(data()),migrated);await close();pass('安装替换中断后用户资料不变，重跑安装包即可修复，仍不重复迁移');
 assert.equal(await shortcut(desktop),path.join((await reg()).path,'随手记.exe'));await uninstall();
 // Installer next to a Portable should discover that specific directory, not scan drives.
 const nearby=path.join(old,'新版安装包.exe');await fs.copyFile(setup,nearby);local=path.join(root,'case-nearby');assert.equal(await install(nearby),0);assert.equal(await dataFingerprint(data()),await dataFingerprint(original));assert.equal(await backupCount(),1);await uninstall();pass('安装包放在旧Portable旁也可可靠识别并自动迁移');
 // Invalid legacy data must stop, rather than silently starting with an empty database.
 const originalDb=path.join(original,'notes.sqlite'),bytes=await fs.readFile(originalDb);await fs.writeFile(originalDb,'invalid database');local=path.join(root,'case-invalid');assert.equal(await install(setup,old),3);assert.equal(await fs.readFile(originalDb,'utf8'),'invalid database');assert.equal(await reg(),null);await fs.writeFile(originalDb,bytes);pass('识别到旧程序但数据库损坏时停止，不用空数据冒充迁移成功');
 const container=path.dirname(old);await fs.writeFile(path.join(container,'开发资料.txt'),'不是程序文件，不能覆盖');local=path.join(root,'case-container');assert.equal(await install(setup,container),0);assert.equal(await dataFingerprint(data()),await dataFingerprint(original));assert.equal(await fs.readFile(path.join(container,'开发资料.txt'),'utf8'),'不是程序文件，不能覆盖');await fs.access(path.join(old,'随手记.exe'));await uninstall();pass('选择含已知旧程序子目录的容器时安全识别迁移，周围无关文件和旧程序均保留');
 const result={passed:true,checks,root};await fs.writeFile(path.join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});throw error;}
finally{if(app)await app.close().catch(()=>{});if(legacy)await legacy.close().catch(()=>{});await uninstall();}
