import {appRoot,testRoot,stagingRoot,stagedApp} from './paths.mjs';
process.chdir(appRoot);
import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const original=stagedApp,moved=path.join(stagingRoot,'整套搬迁验收');
const exe=folder=>path.join(folder,'随手记.exe'); let instance,activeFolder=original;
async function moveFolder(from,to){for(let attempt=0;;attempt++){try{return await fs.rename(from,to);}catch(error){if(attempt>=30)throw error;await new Promise(r=>setTimeout(r,250));}}}
async function launch(folder){
  instance=await electron.launch({executablePath:exe(folder),args:[],env:{...process.env,NOTES_TEST_MODE:'0'},timeout:30000});
  const page=await instance.firstWindow();await page.waitForFunction(()=>!!window.notes);return page;
}
async function close(){await instance.close();instance=null;}
try{
  let page=await launch(original); const before=await page.evaluate(()=>window.notes.info());
  assert.equal(before.dataDir,path.join(original,'我的数据'));assert.ok(before.lastBackup);assert.equal(before.backupWarning,null);
  assert.equal((await page.evaluate(()=>window.notes.list({}))).length,0);
  const note=await page.evaluate(async()=>{const {note}=await window.notes.create();await window.notes.save({...note,title:'整套文件夹搬迁验收',document:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'这是一条验收数据，交付前会清理。'}]}]}});return note;});
  const assets=await page.evaluate(async({id,file})=>window.notes.importPaths(id,[file]),{id:note.id,file:path.resolve('assets/icon.png')});
  await page.evaluate(async({id,asset})=>{const {note}=await window.notes.get(id);note.document.content.push({type:'image',attrs:{assetId:asset.id,src:`app-asset://media/${asset.id}`}});await window.notes.save(note);},{id:note.id,asset:assets[0]});
  await close();
  const backups=path.join(original,'我的数据','自动备份'),todayFile=(await fs.readdir(backups)).find(n=>n.endsWith('.zip'));
  const generated=[];
  for(let i=1;i<=8;i++){const d=new Date();d.setDate(d.getDate()-i);const name=`自动备份-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}.zip`;generated.push(name);await fs.copyFile(path.join(backups,todayFile),path.join(backups,name));}
  await moveFolder(original,moved);activeFolder=moved;page=await launch(moved);
  const after=await page.evaluate(()=>window.notes.info());assert.equal(after.dataDir,path.join(moved,'我的数据'));
  const detail=await page.evaluate(id=>window.notes.get(id),note.id);assert.equal(detail.note.title,'整套文件夹搬迁验收');
  await page.locator('.note-card').first().click();await page.locator('.tiptap img').waitFor();await page.waitForFunction(()=>document.querySelector('.tiptap img')?.naturalWidth>0);
  assert.equal((await fs.readdir(path.join(moved,'我的数据','自动备份'))).filter(n=>n.endsWith('.zip')).length,7);
  await page.screenshot({path:path.resolve(testRoot,'04-portable-moved.png')});
  await instance.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
  await page.evaluate(async id=>{await window.notes.trash(id);await window.notes.remove(id);},note.id);
  assert.equal((await page.evaluate(()=>window.notes.list({}))).length,0);await close();
  await moveFolder(moved,original);activeFolder=original;
  // This directory was created exclusively by this smoke test, before delivery.
  const clean=path.join(original,'我的数据');assert.ok(clean.startsWith(stagingRoot+path.sep));await fs.rm(clean,{recursive:true,force:true,maxRetries:30,retryDelay:250});await fs.mkdir(clean);
  console.log(JSON.stringify({passed:true,defaultDataLocation:true,dailyBackup:true,retainsSevenBackups:true,wholeProgramMoved:true,imagesAfterMove:true,deliveryDataIsEmpty:true},null,2));
}catch(error){console.error('搬迁检查：',error);throw error;}finally{if(instance)await instance.close();if(activeFolder===moved)await moveFolder(moved,original);}
