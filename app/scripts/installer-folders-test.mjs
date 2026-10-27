// Focused installation-folder checks. Uses a separate NSIS identity and user-data root.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {appRoot,repoRoot,testRoot} from './paths.mjs';
const execute=promisify(execFile),guid='8f0de495-bfe9-43aa-bb9f-e7ce5277c862';
const version=JSON.parse(await fs.readFile(path.join(appRoot,'package.json'),'utf8')).version;
const setup=path.join(repoRoot,`.artifacts/installer-location-qa/${version}/suishouji-${version}-setup-x64.exe`);
const root=path.join(testRoot,'installer-folders-'+Date.now()),local=path.join(root,'user');
await fs.mkdir(root,{recursive:true});
const checks=[];
async function ps(code){return (await execute('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command','[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); '+code],{windowsHide:true})).stdout.trim();}
async function registered(){return ps(`if(Test-Path 'HKCU:\\Software\\${guid}'){(Get-ItemProperty 'HKCU:\\Software\\${guid}').InstallLocation};exit 0`);}
async function exists(file){try{await fs.access(file);return true;}catch{return false;}}
async function plan(destination,{preview=true,expected=0,registeredPath='',data=path.join(local,'随手记')}={}){
 const ini=path.join(root,'plan.ini');await fs.rm(ini,{force:true});
 let code=0;try{await execute('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',path.join(appRoot,'scripts/installer/validate-location.ps1')],{windowsHide:true,env:{...process.env,MEMO_INSTALLER_DIR:destination,MEMO_INSTALLER_DATA:data,MEMO_INSTALLED_DIR:registeredPath,MEMO_DEFAULT_DIR:path.join(local,'Programs','suishouji'),MEMO_SETUP_DIR:'',MEMO_SHORTCUT:'',MEMO_PLAN_FILE:ini,MEMO_LOCATION_PREVIEW:preview?'1':'0'}});}catch(error){if(typeof error.code!=='number')throw error;code=error.code;}
 assert.equal(code,expected,`目录规划：${destination}`);if(code!==0)return;
 const text=(await fs.readFile(ini)).toString('utf16le');return Object.fromEntries([...text.matchAll(/^(\w+)=(.*)\r?$/gm)].map(m=>[m[1],m[2].trim()]));
}
async function run(file,args){return new Promise((resolve,reject)=>{const child=spawn(file,args,{windowsHide:true,windowsVerbatimArguments:true,env:{...process.env,MEMO_INSTALL_QA_LOCALAPPDATA:local},stdio:'ignore'});child.once('error',reject);child.once('exit',resolve);});}
async function install(destination){return run(setup,['/S',...(destination?['/D='+destination]:[])]);}
async function uninstall(){const program=await registered();if(!program)return;const relative=path.relative(root,program);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'只能卸载隔离测试程序');assert.equal(await run(path.join(program,'Uninstall 随手记.exe'),['/S']),0);for(let i=0;i<100&&await registered();i++)await new Promise(r=>setTimeout(r,100));assert.equal(await registered(),'');}
function pass(text){checks.push(text);console.log('通过：'+text);}
try{
 assert.equal(await registered(),'','已有QA安装时停止，不碰现有程序');
 const container=path.join(root,'soft'),target=path.join(container,'随手记');await fs.mkdir(container);await fs.writeFile(path.join(container,'其他软件.txt'),'保持原样');
 assert.equal((await plan(container)).program,target);assert.equal(await exists(target),false);
 const empty=path.join(root,'空总目录');await fs.mkdir(empty);assert.equal((await plan(empty)).program,path.join(empty,'随手记'));assert.equal((await fs.readdir(empty)).length,0);
 assert.equal((await plan(target)).program,target);assert.equal((await plan(path.join(root,'suishouji'))).program,path.join(root,'suishouji'));
 pass('空或非空软件总目录自动使用随手记子目录；预览无落盘；中英文应用目录不重复嵌套');
 const occupied=path.join(root,'占用目录','随手记');await fs.mkdir(occupied,{recursive:true});await fs.writeFile(path.join(occupied,'报告.txt'),'不能覆盖');
 await plan(path.dirname(occupied),{expected:12});await plan(occupied,{expected:12});assert.equal(await fs.readFile(path.join(occupied,'报告.txt'),'utf8'),'不能覆盖');
 await plan(path.join(local,'随手记'),{expected:11});
 const linked=path.join(root,'链接目录');await fs.symlink(container,linked,'junction');await plan(linked,{expected:11});
 pass('同名应用目录中的未知文件、资料目录和链接目录仍受保护');
 // Read-only proof for the user's exact E:\soft selection. No files are installed there.
 const realParent='E:\\soft';if(await exists(realParent)){
   const before=await fs.readdir(realParent),resolved=await plan(realParent);
   assert.equal(resolved.program,path.join(realParent,'随手记'));assert.deepEqual(await fs.readdir(realParent),before);
   pass('实际E:\\soft仅预览为E:\\soft\\随手记，不改动其中任何软件');
 }
 assert.equal(await install(container),0);assert.equal(await registered(),target);await fs.access(path.join(target,'随手记.exe'));assert.equal(await exists(path.join(container,'随手记.exe')),false);
 assert.equal(await fs.readFile(path.join(container,'其他软件.txt'),'utf8'),'保持原样');
 const marker=path.join(local,'随手记','本次验证.txt');await fs.writeFile(marker,'用户资料应保留');
 assert.equal(await install(),0);assert.equal(await registered(),target);assert.equal(await fs.readFile(marker,'utf8'),'用户资料应保留');assert.equal(await exists(path.join(target,'随手记')),false);
 assert.equal((await plan(container,{registeredPath:target})).program,target);
 pass('真实安装器选总目录后创建独立程序目录，后续覆盖沿用原位置，不套娃且保留资料');
 await uninstall();assert.equal(await fs.readFile(path.join(container,'其他软件.txt'),'utf8'),'保持原样');assert.equal(await fs.readFile(marker,'utf8'),'用户资料应保留');
 assert.equal(await install(path.dirname(occupied)),3);assert.equal(await registered(),'');assert.equal(await fs.readFile(path.join(occupied,'报告.txt'),'utf8'),'不能覆盖');
 pass('卸载只移除程序子目录；真实安装器拒绝占用的同名目录，周围文件及用户资料保留');
 const result={passed:true,version,checks,root};await fs.writeFile(path.join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await uninstall();}
