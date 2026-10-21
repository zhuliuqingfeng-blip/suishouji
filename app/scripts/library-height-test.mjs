import {appRoot,testRoot} from './paths.mjs';
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {Store} from '../dist-electron/store.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
process.chdir(appRoot);
const root=path.join(testRoot,'library-height-'+Date.now()),shots=path.join(testRoot,'library-height');
await fs.mkdir(root,{recursive:true});await fs.mkdir(shots,{recursive:true});
const store=new Store(root);
for(let i=1;i<=18;i++){
 const n=store.create().note;store.save({...n,title:`记录 ${String(i).padStart(2,'0')} · 独立布局验收`,tags:[i%2?'生活':'工作'],document:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'这是一条虚构记录，用于检查顶部空间、记录密度和各项操作。'}]}]}});
}
store.close();
let app,page;const errors=[];
async function launch(){
 app=await electron.launch({executablePath:process.env.NOTES_PACKAGED_EXE||electronPath,args:process.env.NOTES_PACKAGED_EXE?[]:[appRoot],env:{...process.env,NOTES_TEST_MODE:'1',NOTES_DATA_DIR:root}});
 page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('.library-mode').waitFor();await page.waitForFunction(()=>!document.querySelector('[aria-label="新建记录"]').disabled);
}
async function close(){const closed=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closed;app=null;}
async function settled(){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
const separator=()=>page.getByRole('separator',{name:'手记库顶部高度',exact:true});
async function metrics(){await settled();return page.evaluate(()=>{
 const list=document.querySelector('.note-list').getBoundingClientRect(),heading=document.querySelector('.collection-heading').getBoundingClientRect();
 return {height:heading.height,top:list.top,listHeight:list.height,visible:[...document.querySelectorAll('.note-row')].filter(row=>{const b=row.getBoundingClientRect();return b.top>=list.top-.5&&b.bottom<=list.bottom+.5;}).length};
});}
async function drag(delta){const box=await separator().boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2+delta,{steps:10});await page.mouse.up();await settled();}
async function screenshot(name){await page.mouse.move(2,2);await page.screenshot({path:path.join(shots,name+'.png')});}
async function controls(){
 for(const name of ['搜索记录','记录排序','紧凑视图|舒展视图','多选']){
  const locator=name.includes('|')?page.getByRole('button',{name:/紧凑视图|舒展视图/}):name==='多选'?page.getByRole('button',{name:/^(多选|退出多选)$/}):page.getByLabel(name,{exact:true});assert.equal(await locator.isVisible(),true);
 }
 assert.equal(await page.getByLabel('标签筛选',{exact:true}).isVisible(),true);
 const misses=await page.evaluate(()=>[...document.querySelectorAll('.collection-tools button,.collection-tools select,.collection-tools input')].filter(el=>{const b=el.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return hit!==el&&!el.contains(hit);}).map(el=>el.getAttribute('aria-label')||el.textContent));assert.deepEqual(misses,[]);
}
try{
 await launch();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1260,820));await page.waitForFunction(()=>innerWidth===1260);await settled();
 const normal=await metrics();assert.ok(Math.abs(normal.height-166)<1);await screenshot('01-舒展视图');
 await drag(-80);const dragged=await metrics();assert.ok(Math.abs(dragged.height-(normal.height-80))<2);assert.ok(dragged.top<normal.top-75);await controls();
 await separator().dblclick();assert.ok(Math.abs((await metrics()).height-normal.height)<2);
 await separator().focus();await page.keyboard.press('ArrowUp');assert.ok(Math.abs((await metrics()).height-156)<1);await page.keyboard.press('ArrowDown');assert.ok(Math.abs((await metrics()).height-166)<1);
 await page.keyboard.press('Home');assert.ok(Math.abs((await metrics()).height-56)<1);await drag(-400);assert.ok(Math.abs((await metrics()).height-56)<1);
 await separator().focus();await page.keyboard.press('End');const max=Number(await separator().getAttribute('aria-valuemax'));assert.ok(Math.abs((await metrics()).height-max)<2);await drag(400);assert.ok((await metrics()).height<=max+1);
 await separator().dblclick();await page.getByRole('button',{name:'紧凑视图',exact:true}).click();const compact=await metrics();assert.ok(compact.visible>=normal.visible+2,`可见记录数量应增加：${normal.visible} -> ${compact.visible}`);assert.ok(compact.listHeight>normal.listHeight+90);await controls();await screenshot('02-紧凑视图');
 await page.getByRole('button',{name:'多选',exact:true}).click();await page.getByRole('button',{name:'全选当前结果',exact:true}).click();assert.equal(await page.locator('.note-checkbox:checked').count(),18);await page.keyboard.press('Escape');
 await page.getByLabel('搜索记录').fill('记录 01');await page.waitForFunction(()=>document.querySelectorAll('.note-card').length===1);await page.getByLabel('清除搜索').click();await page.waitForFunction(()=>document.querySelectorAll('.note-card').length===18);
 await page.locator('.note-card').first().click();await page.locator('.document-mode').waitFor();assert.equal(await separator().count(),0);await page.getByRole('button',{name:'返回手记库',exact:true}).click();await page.locator('.library-mode').waitFor();assert.ok(Math.abs((await metrics()).height-56)<1);
 await close();await launch();assert.ok(Math.abs((await metrics()).height-56)<1);assert.equal(await page.getByRole('button',{name:'舒展视图',exact:true}).isVisible(),true);
 await page.getByRole('button',{name:'舒展视图',exact:true}).click();assert.ok(Math.abs((await metrics()).height-166)<1);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(920,650));await page.waitForFunction(()=>innerWidth===920);await settled();await drag(500);assert.ok((await metrics()).listHeight>=159);await page.getByRole('button',{name:'多选',exact:true}).click();await settled();assert.ok((await metrics()).listHeight>=159);await controls();assert.equal(await page.getByRole('button',{name:'全选当前结果',exact:true}).isVisible(),true);await screenshot('03-窄窗口与多选');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'紧凑视图',exact:true}).click();await screenshot('04-窄窗口紧凑视图');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,normalVisibleRows:normal.visible,compactVisibleRows:compact.visible,checks:['分界线向上向下拖动','上下限与键盘调整','双击恢复','一键紧凑和舒展','可见记录增加','搜索筛选与多选保持可用','书写场景独立','重启记住设置','窄窗口保留列表空间'],screenshots:shots},null,2));
}catch(error){if(page&&!page.isClosed())await screenshot('failure').catch(()=>{});throw error;}finally{if(app)await app.close();}
