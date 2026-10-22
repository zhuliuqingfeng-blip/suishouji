import {appRoot,testRoot} from './paths.mjs';
process.chdir(appRoot);
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Store} from '../dist-electron/store.js';
const root=path.join(testRoot,'workspace-'+Date.now());await fs.mkdir(root,{recursive:true});
const store=new Store(root),ids=[];
for(const title of ['A 项目','B 项目','C 项目','D 备忘','E 备忘','F 置顶']){const n=store.create().note;store.save({...n,title,document:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'这是独立的验收记录。'}]}]}});ids.push(n.id);}
store.pin(ids[5],true);store.close();
let instance,page;const errors=[];
async function until(predicate,timeout=12000){const start=Date.now();while(!await predicate()){if(Date.now()-start>timeout)throw new Error('验收等待超时');await new Promise(r=>setTimeout(r,50));}}
async function launch(){instance=await electron.launch({executablePath:process.env.NOTES_PACKAGED_EXE||electronPath,args:process.env.NOTES_PACKAGED_EXE?[]:[appRoot],env:{...process.env,NOTES_TEST_MODE:'1',NOTES_DATA_DIR:root}});await instance.evaluate(({dialog,shell})=>{globalThis.__dialogResponse=1;globalThis.__dialogs=[];dialog.showMessageBox=async(_window,options)=>{globalThis.__dialogs.push(options.message);return {response:globalThis.__dialogResponse,checkboxChecked:false};};shell.openPath=async()=>'';});page=await instance.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByRole('button',{name:/新建记录/}).first().waitFor();await until(()=>page.getByRole('button',{name:/新建记录/}).first().isEnabled());}
const card=id=>page.locator(`[data-note-id="${id}"] .note-card`);
const active=()=>page.evaluate(()=>window.notes.list({}));
const deleted=()=>page.evaluate(()=>window.notes.list({trash:true}));
async function response(value){await instance.evaluate((_e,value)=>{globalThis.__dialogResponse=value;},value);}
async function sql(statement){await instance.evaluate((_e,{root,statement})=>{const {DatabaseSync}=process.getBuiltinModule('node:sqlite');const db=new DatabaseSync(process.getBuiltinModule('path').join(root,'notes.sqlite'));db.exec(statement);db.close();},{root,statement});}
async function directory(){if(!await page.getByLabel('搜索记录').isVisible())await page.getByRole('button',{name:'显示记录列表',exact:true}).click();}
async function select(...selected){await directory();if(await page.getByRole('button',{name:'退出多选',exact:true}).count())await page.getByRole('button',{name:'退出多选',exact:true}).click();for(const id of selected)await card(id).click({modifiers:['Control']});}
async function ready(){await until(()=>page.getByRole('button',{name:/新建记录/}).first().isEnabled());}
async function undo(){await page.getByRole('button',{name:/^撤销 \d+s$/}).click();await until(async()=>await page.locator('.undo-toast').count()===0);await ready();}
async function close(){const end=instance.waitForEvent('close');await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await end;instance=null;}
try{
 await launch();await page.getByRole('button',{name:'全部记录',exact:true}).click();await page.locator('.note-card').first().click();await directory();await page.getByLabel('记录排序').selectOption('title');await until(async()=>await card(ids[0]).count()===1);
 const original=await page.getByLabel('记录标题').inputValue();
 await card(ids[0]).click({modifiers:['Control']});await card(ids[2]).click({modifiers:['Shift']});assert.equal(await page.locator('.note-checkbox:checked').count(),3);assert.equal(await page.getByLabel('记录标题').inputValue(),original);
 await page.keyboard.press('Escape');await card(ids[0]).click({modifiers:['Control']});await page.getByRole('checkbox',{name:'选择 C 项目',exact:true}).click({modifiers:['Shift']});assert.equal(await page.locator('.note-checkbox:checked').count(),3);
 await page.screenshot({path:path.join(testRoot,'1.2-多选.png')});
 await response(0);await page.keyboard.press('Delete');await until(()=>page.getByRole('button',{name:'删除所选',exact:true}).isEnabled());assert.equal((await active()).length,6);assert.equal(await page.locator('.note-checkbox:checked').count(),3);
 await response(1);await page.getByRole('button',{name:'删除所选',exact:true}).click();await until(async()=>(await deleted()).length===3);await undo();await until(async()=>(await active()).length===6);
 await card(ids[1]).click();await until(async()=>await page.getByRole('textbox',{name:'记录正文'}).getAttribute('contenteditable')==='true');await page.getByRole('textbox',{name:'记录正文'}).fill('输入后立即批量删除，草稿也应保存。');await select(ids[1],ids[2]);await page.getByRole('button',{name:'删除所选',exact:true}).click();await until(async()=>(await deleted()).length===2);await ready();
 assert.equal(await page.getByLabel('记录标题').inputValue(),'D 备忘');assert.match((await page.evaluate(id=>window.notes.get(id),ids[1])).note.plainText,/草稿也应保存/);await undo();await until(async()=>(await active()).length===6);
 await page.getByLabel('搜索记录').fill('项目');await until(async()=>await page.locator('.note-card').count()===3);await page.getByLabel('记录列表',{exact:true}).focus();await page.keyboard.press('Control+a');assert.equal(await page.locator('.note-checkbox:checked').count(),3);
 await page.getByRole('button',{name:'删除所选',exact:true}).click();await until(async()=>(await deleted()).length===3);await ready();assert.equal(await page.getByLabel('记录标题').inputValue(),'D 备忘');await undo();await until(async()=>(await active()).length===6);assert.equal(await page.getByLabel('记录标题').inputValue(),'D 备忘');await page.getByLabel('记录列表',{exact:true}).focus();await page.keyboard.press('Control+a');
 await page.getByLabel('搜索记录').fill('A 项目');await until(async()=>await page.locator('.selection-bar').count()===0);await page.getByLabel('清除搜索').click();await until(async()=>await page.locator('.note-card').count()===6);
 await card(ids[0]).click({button:'right'});await page.getByRole('menuitem',{name:'置顶记录',exact:true}).click();await until(async()=>(await active()).find(n=>n.id===ids[0]).pinned);assert.equal(await page.getByLabel('记录标题').inputValue(),'D 备忘');
 await select(ids[0],ids[1]);await card(ids[1]).click({button:'right'});assert.ok(await page.getByRole('menuitem',{name:'移到回收站（2 条）',exact:true}).count());await page.keyboard.press('Escape');
 for(const [label,delta]of [['记录列表宽度',60]]){const separator=page.getByRole('separator',{name:label}),box=await separator.boundingBox(),before=Number(await separator.getAttribute('aria-valuenow'));await page.mouse.move(box.x+box.width/2,box.y+100);await page.mouse.down();await page.mouse.move(box.x+box.width/2+delta,box.y+100,{steps:8});await page.mouse.up();await until(async()=>Math.abs(Number(await separator.getAttribute('aria-valuenow'))-before-delta)<3);}
 await page.getByRole('separator',{name:'记录列表宽度'}).dblclick();assert.equal(Number(await page.getByRole('separator',{name:'记录列表宽度'}).getAttribute('aria-valuenow')),350);
 await page.getByRole('separator',{name:'记录列表宽度'}).focus();await page.keyboard.press('ArrowRight');assert.equal(Number(await page.getByRole('separator',{name:'记录列表宽度'}).getAttribute('aria-valuenow')),360);
 await page.getByRole('button',{name:'收起标签筛选',exact:true}).click();assert.equal(await page.getByLabel('标签筛选',{exact:true}).isVisible(),false);await page.getByRole('button',{name:'展开标签筛选',exact:true}).click();
 await page.getByRole('button',{name:'隐藏记录列表',exact:true}).click();assert.equal(await page.locator('.notes-panel').isVisible(),false);await page.keyboard.press('Control+f');await until(()=>page.getByLabel('搜索记录').evaluate(n=>n===document.activeElement));
 await page.getByRole('button',{name:'进入专注模式',exact:true}).click();assert.equal(await page.getByLabel('主导航',{exact:true}).isVisible(),false);assert.equal(await page.locator('.notes-panel').isVisible(),false);await page.getByRole('button',{name:'退出专注模式',exact:true}).click();assert.equal(await page.locator('.notes-panel').isVisible(),true);
 await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(920,700));await until(async()=>(await page.locator('.editor-panel').boundingBox()).width>=399);assert.ok((await page.locator('.editor-panel').boundingBox()).width>=399);
 await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1120,760));await page.waitForTimeout(400);
 await page.getByLabel('记录标题').focus();await page.keyboard.press('Control+a');assert.equal(await page.locator('.selection-bar').count(),0);
 const expectedBounds=await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getNormalBounds());
 await page.getByRole('button',{name:'收起标签筛选',exact:true}).click();await page.getByRole('button',{name:'隐藏记录列表',exact:true}).first().click();await close();await launch();
 await page.locator('.home-mode').waitFor();await page.getByRole('button',{name:'继续上次记录',exact:true}).click();assert.equal(await page.locator('.notes-panel').isVisible(),false);assert.equal(await page.locator('.editor-panel').isVisible(),true);
 const bounds=await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getNormalBounds());assert.ok(Math.abs(bounds.width-expectedBounds.width)<=2,`窗口宽度 ${bounds.width}，预期 ${expectedBounds.width}`);assert.ok(Math.abs(bounds.height-expectedBounds.height)<=2);await page.keyboard.press('Control+f');await until(()=>page.getByLabel('搜索记录').evaluate(n=>n===document.activeElement));assert.equal(await page.getByLabel('记录排序').inputValue(),'title');
 await page.getByRole('button',{name:'展开标签筛选',exact:true}).click();
 const currentId=await page.evaluate(()=>localStorage.getItem('suishouji:last-note'));await sql(`CREATE TRIGGER stop_save BEFORE UPDATE OF title ON notes WHEN NEW.id='${currentId}' BEGIN SELECT RAISE(ABORT,'模拟保存失败'); END;`);
 await page.getByLabel('记录标题').fill('尚未保存的中文草稿');await page.getByRole('button',{name:'返回手记库',exact:true}).click();await page.getByRole('alert').filter({hasText:'模拟保存失败'}).waitFor();assert.equal(await page.locator('.editor-panel').isVisible(),true);await select(ids[0]);await page.getByRole('button',{name:'删除所选',exact:true}).click();await page.getByRole('alert').filter({hasText:'模拟保存失败'}).waitFor();assert.equal((await active()).length,6);assert.equal(await page.getByLabel('记录标题').inputValue(),'尚未保存的中文草稿');
 await sql('DROP TRIGGER stop_save');await page.keyboard.press('Control+s');await until(async()=>(await page.evaluate(id=>window.notes.get(id),currentId)).note.title==='尚未保存的中文草稿');await page.getByRole('button',{name:'退出多选',exact:true}).click();
 await select(ids[0],ids[1]);await page.getByRole('button',{name:'删除所选',exact:true}).click();await until(async()=>(await deleted()).length===2);await page.getByRole('button',{name:'回收站',exact:true}).click();await select(ids[0],ids[1]);await page.getByRole('button',{name:'恢复所选',exact:true}).click();await until(async()=>(await deleted()).length===0);await page.getByRole('button',{name:'全部记录',exact:true}).click();
 await select(ids[0],ids[1]);await page.getByRole('button',{name:'删除所选',exact:true}).click();await until(async()=>(await deleted()).length===2);await page.getByRole('button',{name:'回收站',exact:true}).click();await select(ids[0],ids[1]);
 await response(0);await page.getByRole('button',{name:'永久删除所选',exact:true}).click();await until(()=>page.getByRole('button',{name:'永久删除所选',exact:true}).isEnabled());assert.equal((await deleted()).length,2);
 await response(1);await sql(`CREATE TRIGGER stop_remove BEFORE DELETE ON notes WHEN OLD.id='${ids[1]}' BEGIN SELECT RAISE(ABORT,'模拟永久删除失败'); END;`);await page.getByRole('button',{name:'永久删除所选',exact:true}).click();await page.getByRole('alert').filter({hasText:'失败 1 条'}).waitFor();assert.equal((await deleted()).length,1);assert.equal(await page.locator('.note-checkbox:checked').count(),1);await sql('DROP TRIGGER stop_remove');await page.getByRole('button',{name:'永久删除所选',exact:true}).click();await until(async()=>(await deleted()).length===0);
 await page.getByRole('button',{name:'全部记录',exact:true}).click();await page.locator('.note-card').first().click();await page.getByLabel('记录标题').focus();await page.evaluate(()=>document.querySelector('.editor-scroll').scrollTop=0);await page.screenshot({path:path.join(testRoot,'工作区与批量操作.png')});assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,checks:['Ctrl/Shift多选','筛选范围全选','单次确认及取消','删除撤销','删除前保存及邻近记录','右键菜单','目录拖动及重置','筛选收起和专注恢复','窄窗口正文空间','窗口与场景布局记忆','保存失败阻止删除','批量恢复','永久删除部分失败重试'],dataDir:root},null,2));
}catch(error){if(page){await page.screenshot({path:path.join(testRoot,'1.2-failure.png')}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-2500));}throw error;}finally{if(instance)await instance.close();}
