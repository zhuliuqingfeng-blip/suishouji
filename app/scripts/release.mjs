import fs from 'node:fs/promises';
import path from 'node:path';
import { zipFiles } from '../dist-electron/archive.js';
import {appRoot,repoRoot,docsRoot,stagedApp,installedApp,packagesRoot} from './paths.mjs';
process.chdir(appRoot);
const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
const root=stagedApp,installed=installedApp;
await fs.mkdir(packagesRoot,{recursive:true});
await fs.access(path.join(root,'随手记.exe'));
await fs.copyFile(path.join(docsRoot,'使用说明.txt'),path.join(root,'使用说明.txt'));
await fs.copyFile('assets/icon.ico',path.join(root,`随手记-${version}.ico`));
await fs.mkdir(path.join(root,'我的数据'),{recursive:true});
await fs.writeFile(path.join(root,'创建桌面快捷方式.vbs'),'\ufeff'+`Set sh = CreateObject("WScript.Shell")\r\nSet fs = CreateObject("Scripting.FileSystemObject")\r\nfolder = fs.GetParentFolderName(WScript.ScriptFullName)\r\nSet link = sh.CreateShortcut(sh.SpecialFolders("Desktop") & "\\随手记.lnk")\r\nlink.TargetPath = folder & "\\随手记.exe"\r\nlink.WorkingDirectory = folder\r\nlink.IconLocation = folder & "\\随手记-${version}.ico,0"\r\nlink.Description = "本地个人图文记录"\r\nlink.Save\r\nMsgBox "已在桌面创建随手记快捷方式。", 64, "随手记"\r\n`,'utf16le');
async function walk(directory,base,prefix){const files=[];for(const d of await fs.readdir(directory,{withFileTypes:true})){if(directory===base&&d.name==='我的数据')continue;const file=path.join(directory,d.name);if(d.isDirectory())files.push(...await walk(file,base,prefix));else files.push({source:file,name:`${prefix}/${path.relative(base,file).replaceAll('\\','/')}`});}return files;}
const packageFile=path.join(packagesRoot,`随手记-${version}-Windows-x64.zip`);
await zipFiles(await walk(root,root,'随手记'),packageFile);
const sourceFiles=['package.json','package-lock.json','tsconfig.json','tsconfig.electron.json','vite.config.ts','index.html'];
async function sources(directory){const files=[];for(const d of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,d.name);if(d.isDirectory())files.push(...await sources(file));else files.push(file);}return files;}
for(const dir of ['electron','src','scripts','tests','assets'])sourceFiles.push(...await sources(dir));
const sourceEntries=sourceFiles.map(p=>({source:path.resolve(p),name:`随手记源码/app/${p.replaceAll('\\','/')}`}));
for(const p of ['README.md','.gitignore'])sourceEntries.push({source:path.join(repoRoot,p),name:`随手记源码/${p}`});
for(const p of await sources(docsRoot))sourceEntries.push({source:p,name:`随手记源码/docs/${path.relative(docsRoot,p).replaceAll('\\','/')}`});
await zipFiles(sourceEntries,path.join(packagesRoot,`随手记-${version}-源码.zip`));
try{await fs.access(installed);console.log('已有软件和数据已保留。新版本暂存在 .artifacts/staging/win-unpacked，可使用 scripts/upgrade.mjs 安全升级。');}
catch(error){if(error.code!=='ENOENT')throw error;await fs.rename(root,installed);}
console.log(`已生成 ${packageFile} 和源码包。便携包不会包含个人数据。`);
