import {appRoot,testRoot,stagingRoot,stagedApp} from './paths.mjs';
process.chdir(appRoot);
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(testRoot,'ui-'+Date.now()); await fs.mkdir(root,{recursive:true});
const dataDir=path.join(root,'我的数据'); const screenshotDir=testRoot;
const executablePath=process.env.NOTES_PACKAGED_EXE || electronPath;
const args=process.env.NOTES_PACKAGED_EXE ? [] : ['.'];
const errors=[]; let application,previousClipboard;
async function waitUntil(predicate,timeout=10000){const start=Date.now();while(!await predicate()){if(Date.now()-start>timeout)throw new Error('数据验证等待超时');await new Promise(r=>setTimeout(r,50));}}
async function launch(data=dataDir){
  const instance=await electron.launch({executablePath,args,env:{...process.env,NOTES_TEST_MODE:'1',NOTES_DATA_DIR:data},timeout:30000});
  if(previousClipboard===undefined)previousClipboard=await instance.evaluate(async({clipboard})=>Promise.all((await clipboard.read()).map(async item=>Object.fromEntries(await Promise.all(item.types.map(async type=>[type,Array.from(new Uint8Array(await (await item.getType(type)).arrayBuffer()))]))))));
  // Check attachment-open routing without leaving external apps or Explorer windows behind.
  await instance.evaluate(({shell})=>{globalThis.__openedFile=null;shell.openPath=async file=>{if(file.endsWith('.txt')){const fs=process.getBuiltinModule('fs');globalThis.__openedFile={file,text:fs.readFileSync(file,'utf8')};}return '';};});
  const page=await instance.firstWindow(); page.on('pageerror',e=>errors.push(e.message)); await page.waitForFunction(()=>!!window.notes,{timeout:20000}); await page.getByRole('button',{name:/新建记录/}).first().waitFor();
  return {instance,page};
}
try {
  let first=await launch(); application=first.instance; let page=first.page;
  await page.screenshot({path:path.join(screenshotDir,'01-empty.png')});
  await page.getByRole('button',{name:/新建记录/}).first().click();
  await page.getByLabel('记录标题').fill('把零散的想法，收进这一页');
  const body=page.getByRole('textbox',{name:'记录正文'}); await body.fill('今天想记住的几件小事\n\n周末去公园走走，带上相机。\n看到喜欢的句子，随手留在这里。');
  await page.getByLabel('添加标签',{exact:true}).fill('生活'); await page.getByLabel('添加标签',{exact:true}).press('Enter');
  await page.getByLabel('添加标签',{exact:true}).fill('灵感'); await page.getByLabel('添加标签',{exact:true}).press('Enter');
  // Do not force a save: this verifies the automatic 500ms save.
  await waitUntil(()=>page.evaluate(async()=>{const n=(await window.notes.list({}))[0];return n?.tags.length===2&&n.title==='把零散的想法，收进这一页';}));
  assert.equal((await page.evaluate(async()=>(await window.notes.list({}))[0]?.title)),'把零散的想法，收进这一页');
  await page.getByRole('button',{name:'置顶记录',exact:true}).click();
  await waitUntil(()=>page.evaluate(async()=>(await window.notes.list({}))[0]?.pinned));
  // Paste a real clipboard screenshot through Chromium's clipboard integration.
  const png=await fs.readFile('assets/icon.png');
  await application.evaluate(async({clipboard,ClipboardItem},bytes)=>{ await clipboard.write([new ClipboardItem({'image/png':new Blob([Buffer.from(bytes)],{type:'image/png'})})]); },[...png]);
  await body.click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Control+V');
  await page.locator('.tiptap img').waitFor({timeout:10000});
  await page.waitForFunction(()=>{const img=document.querySelector('.tiptap img');return img?.complete&&img.naturalWidth>0;});
  await page.locator('.tiptap img').click(); await page.getByRole('dialog',{name:'查看图片',exact:true}).waitFor(); await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'小',exact:true}).click();
  const source=path.join(root,'周末清单.txt'); await fs.writeFile(source,'相机、笔记本、一杯咖啡。');
  await application.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},source);
  await page.getByRole('button',{name:'添加附件',exact:true}).click(); await page.getByTitle('打开 周末清单.txt').waitFor(); await fs.rm(source);
  await page.getByTitle('打开 周末清单.txt').click();
  await waitUntil(()=>application.evaluate(()=>globalThis.__openedFile!==null));
  assert.equal((await application.evaluate(()=>globalThis.__openedFile)).text,'相机、笔记本、一杯咖啡。');
  await page.keyboard.press('Control+s'); await page.waitForTimeout(650);
  await page.evaluate(()=>{document.querySelector('.editor-scroll').scrollTop=0;});
  await page.screenshot({path:path.join(screenshotDir,'02-note.png')});
  await page.keyboard.press('Control+f');await page.getByLabel('搜索记录').fill('周末清单'); await page.waitForTimeout(350); assert.equal(await page.locator('.note-card').count(),1);
  await page.getByLabel('清除搜索').click();
  const all=await page.evaluate(()=>window.notes.list({})); assert.equal(all.length,1); assert.equal(all[0].pinned,true);
  const noteId=all[0].id;
  // Confirm a rich-text link is made with an app dialog, not unsupported window.prompt.
  await body.click(); await page.keyboard.press('Control+End'); await page.getByRole('button',{name:'插入网页链接',exact:true}).click();
  await page.getByLabel('网页地址').fill('https://example.com'); await page.getByRole('button',{name:'确定',exact:true}).click();
  await page.keyboard.insertText('一个网页'); await page.keyboard.press('Control+s'); await page.waitForTimeout(650);
  await page.getByRole('button',{name:'更多记录操作',exact:true}).click(); await page.getByRole('button',{name:'移到回收站',exact:true}).click();
  await page.getByRole('button',{name:'数据与设置',exact:true}).click();await page.getByRole('button',{name:/^查看回收站/}).click();await page.locator('.note-card').first().click(); await page.getByRole('button',{name:'恢复记录',exact:true}).click();
  await page.getByRole('button',{name:/全部记录/}).first().click();await page.locator('.note-card').first().click(); await page.getByLabel('记录标题').waitFor();
  const backup=path.join(root,'完整备份.zip');
  await application.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},backup);
  await page.getByRole('button',{name:'数据与设置',exact:true}).click(); await page.getByRole('button',{name:'备份全部数据',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.busy-overlay')); await page.waitForTimeout(500); await fs.access(backup);
  const exportTo=path.join(root,'导出'); await fs.mkdir(exportTo);
  await application.evaluate(({dialog},dir)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[dir]});},exportTo);
  await page.evaluate(()=>window.notes.exportNotes());
  const folders=await fs.readdir(exportTo); await fs.access(path.join(exportTo,folders[0],'打开我的记录.html'));
  // Restore through the real IPC entrypoint and native dialog hooks.
  await page.getByLabel('记录标题').fill('恢复前的临时修改'); await page.keyboard.press('Control+s'); await page.waitForTimeout(650);
  await application.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});},backup);
  await page.getByRole('button',{name:'数据与设置',exact:true}).click(); await page.getByRole('button',{name:'从备份恢复',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="记录标题"]')?.value==='把零散的想法，收进这一页',{timeout:20000});
  // Switching immediately after editing must flush the draft as well.
  await page.getByRole('button',{name:/新建记录/}).first().click();
  await page.getByLabel('记录标题').fill('快速切换保存验收'); await body.fill('刚输入就切换到另一条记录。');
  await page.keyboard.press('Control+f');
  await page.locator('.note-card').filter({hasText:'把零散的想法，收进这一页'}).click();
  await waitUntil(()=>page.evaluate(async()=> (await window.notes.list({})).some(n=>n.title==='快速切换保存验收'&&n.plainText.includes('刚输入'))));
  await page.evaluate(async()=>{const n=(await window.notes.list({})).find(n=>n.title==='快速切换保存验收');await window.notes.trash(n.id);await window.notes.remove(n.id);});
  // Edits made immediately before closing must survive (without waiting 500ms).
  await page.getByLabel('记录标题').fill('关闭前的中文修改');
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  await application.waitForEvent('close',{timeout:10000}); application=null;
  first=await launch();application=first.instance;page=first.page;
  await page.getByRole('button',{name:'继续上次记录',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="记录标题"]')?.value==='关闭前的中文修改');
  assert.equal((await page.evaluate(id=>window.notes.get(id),noteId)).attachments.length,2);
  // No external resources can be loaded in the running app.
  assert.equal(await page.evaluate(async()=>{try{await fetch('https://example.com');return false;}catch{return true;}}),true);
  await application.close(); application=null;
  const moved=path.join(root,'搬迁后的数据');await fs.rename(dataDir,moved);
  first=await launch(moved);application=first.instance;page=first.page;
  await page.getByRole('button',{name:'继续上次记录',exact:true}).click();
  await page.locator('.tiptap img').waitFor(); await page.waitForFunction(()=>document.querySelector('.tiptap img')?.naturalWidth>0);
  await page.getByTitle('打开 周末清单.txt').waitFor();
  assert.deepEqual(errors,[]); await page.screenshot({path:path.join(screenshotDir,'03-moved.png')});
  console.log(JSON.stringify({passed:true,executablePath,dataDir:moved,checks:['中文编辑','标签置顶','真实剪贴板图片','附件副本','搜索','图文链接','回收站恢复','ZIP备份恢复','HTML导出','关闭前保存','离线限制','搬迁后图片附件'],screenshots:['01-empty.png','02-note.png','03-moved.png']},null,2));
} catch(error) { if(application) {const p=await application.firstWindow();await p.screenshot({path:path.join(screenshotDir,'failure.png')}).catch(()=>{});console.error((await p.locator('body').innerText()).slice(-2500));}throw error; } finally {
  try{if(previousClipboard!==undefined){if(!application)application=(await launch()).instance;await application.evaluate(async({clipboard,ClipboardItem},items)=>{if(items.length)await clipboard.write(items.map(item=>new ClipboardItem(Object.fromEntries(Object.entries(item).map(([type,bytes])=>[type,new Blob([new Uint8Array(bytes)],{type})])))));else await clipboard.clear();},previousClipboard);}}
  finally{if(application)await application.close();}
}
