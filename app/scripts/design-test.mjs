import {appRoot,testRoot} from './paths.mjs';
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {Store} from '../dist-electron/store.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
process.chdir(appRoot);
const root=path.join(testRoot,'design-'+Date.now()),shots=path.join(testRoot,'design-1.4');
await fs.mkdir(root,{recursive:true});await fs.mkdir(shots,{recursive:true});
const store=new Store(root);
const p=text=>({type:'paragraph',content:[{type:'text',text}]}),h=text=>({type:'heading',attrs:{level:2},content:[{type:'text',text}]});
const samples=[
 ['周末，留一点时间给自己',['生活'],[p('想去河边走走，顺路逛一逛那家旧书店。带上相机，不必赶时间。')]],
 ['想读的书与摘录',['阅读'],[p('把偶然遇见的好句子留下来，等有空时再慢慢读。')]],
 ['工作备忘 · 下一步',['工作'],[p('整理本周的资料，确认交付清单。重要文件直接拖进这条记录。')]],
 ['给家里添一点新意',['生活','灵感'],[p('换一盏暖色的小台灯，让书桌成为愿意多待一会儿的地方。')]],
 ['长文阅读与编辑',['工作'],Array.from({length:40},(_,i)=>p(`第 ${i+1} 段：这是独立的界面验收内容，用于检查长记录滚动后格式工具栏仍可使用。`))],
 ['把日子里的小事，慢慢收好',['生活','灵感'],[
   p('不需要每件事都井井有条。先记下来，再慢慢整理。'),h('留给周末的三个小计划'),
   {type:'bulletList',content:['去河边散步，带上相机和一本书。','试着做一道新菜，把喜欢的食谱留下来。','整理书桌，给新的想法留出一点空间。'].map(text=>({type:'listItem',content:[p(text)]}))},
   {type:'blockquote',content:[p('记录，是给平常的日子留一个书签。')]}
 ]]
];
const ids=[];
for(const [title,tags,content]of samples){const n=store.create().note;store.save({...n,title,tags,document:{type:'doc',content}});ids.push(n.id);}
store.pin(ids.at(-1),true);
const attachment=path.join(root,'周末的小清单.txt');await fs.writeFile(attachment,'相机、一本书、一杯咖啡。');store.addFile(ids.at(-1),attachment);
const trash=store.create().note;store.save({...trash,title:'可以找回的旧灵感',document:{type:'doc',content:[p('删除的记录会留在回收站，恢复后还能继续编辑。')]}});store.trash(trash.id);store.close();
let app,page;const errors=[];
async function ready(){await page.waitForFunction(()=>!document.querySelector('[aria-label="新建记录"]')?.disabled);}
async function shot(name){await page.mouse.move(2,2);await page.screenshot({path:path.join(shots,name+'.png')});}
async function resize(width,height){await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),{width,height});await page.waitForFunction(({width,height})=>Math.abs(innerWidth-width)<=2&&Math.abs(innerHeight-height)<=2&&Math.abs(document.querySelector('.app-shell').getBoundingClientRect().height-innerHeight)<=1,{width,height});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function geometry(){
 const result=await page.evaluate(()=>{
   const failures=[];
   for(const selector of ['.app-navigation','.collection-tools','.document-command','.toolbar','.app-status','.selection-bar']){
     const parent=document.querySelector(selector);if(!parent?.checkVisibility()||getComputedStyle(parent).visibility==='hidden')continue;
     const box=parent.getBoundingClientRect();
     for(const child of parent.querySelectorAll('button,input,select')){
       if(!child.checkVisibility())continue;const b=child.getBoundingClientRect();
       if(b.left<box.left-1||b.right>box.right+1||b.top<box.top-1||b.bottom>box.bottom+1)failures.push(`${selector}: ${child.getAttribute('aria-label')||child.textContent}`);
       if(b.top>=0&&b.bottom<=innerHeight){const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);if(hit!==child&&!child.contains(hit))failures.push(`按钮被遮挡: ${child.getAttribute('aria-label')||child.textContent}`);}
     }
   }
   if(document.documentElement.scrollWidth>innerWidth)failures.push('窗口横向溢出');
   return failures;
 });assert.deepEqual(result,[]);
}
async function openDirectory(){if(!await page.getByLabel('搜索记录').isVisible())await page.getByRole('button',{name:'显示记录列表',exact:true}).click();}
async function back(){await page.getByRole('button',{name:'返回手记库',exact:true}).click();await page.locator('.library-mode').waitFor();}
try{
 app=await electron.launch({executablePath:process.env.NOTES_PACKAGED_EXE||electronPath,args:process.env.NOTES_PACKAGED_EXE?[]:[appRoot],env:{...process.env,NOTES_TEST_MODE:'1',NOTES_DATA_DIR:root}});
 page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('.home-mode').waitFor();await ready();await page.getByRole('button',{name:'全部记录',exact:true}).click();await page.locator('.library-mode').waitFor();await ready();await resize(1260,820);
 await geometry();await shot('01-整页手记库');assert.equal(await page.locator('.note-card').count(),6);assert.equal(await page.locator('.editor-panel').isVisible(),false);
 await page.getByLabel('标签筛选',{exact:true}).getByRole('button',{name:/^生活/}).click();await page.waitForFunction(()=>document.querySelectorAll('.note-card').length===3);await page.getByLabel('记录列表',{exact:true}).focus();await page.keyboard.press('Control+a');assert.equal(await page.locator('.note-checkbox:checked').count(),3);await geometry();await shot('02-筛选与批量操作');await page.keyboard.press('Escape');
 await page.getByLabel('标签筛选',{exact:true}).getByRole('button',{name:'全部',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.note-card').length===6);
 await page.locator(`[data-note-id="${ids.at(-1)}"] .note-card`).click();await page.locator('.document-mode').waitFor();await ready();assert.equal(await page.locator('.notes-panel').isVisible(),false);await geometry();await shot('03-独立书写页');
 await page.getByRole('button',{name:'更多记录操作',exact:true}).click();await shot('04-记录菜单');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'数据与设置',exact:true}).click();await page.getByRole('button',{name:'使用说明与数据位置',exact:true}).click();await page.getByRole('dialog',{name:'使用说明',exact:true}).waitFor();await shot('05-使用说明');await page.keyboard.press('Escape');
 await openDirectory();await geometry();await shot('06-按需记录目录');
 const handle=page.getByRole('separator',{name:'记录列表宽度'});await handle.focus();await page.keyboard.press('End');await resize(920,650);assert.ok((await page.locator('.editor-panel').boundingBox()).width>=400);await geometry();await shot('07-窄窗口与目录');await handle.dblclick();assert.equal(Number(await handle.getAttribute('aria-valuenow')),350);
 await page.getByRole('button',{name:'收起标签筛选',exact:true}).click();assert.equal(await page.getByLabel('标签筛选',{exact:true}).isVisible(),false);await page.getByRole('button',{name:'展开标签筛选',exact:true}).click();
 await page.locator(`[data-note-id="${ids[4]}"] .note-card`).click();await ready();
 const before=(await page.locator('.toolbar').boundingBox()).y;await page.getByRole('textbox',{name:'记录正文'}).focus();await page.keyboard.press('Control+End');assert.ok(await page.locator('.editor-scroll').evaluate(n=>n.scrollTop)>400);assert.ok(Math.abs((await page.locator('.toolbar').boundingBox()).y-before)<1);await geometry();await shot('08-长文与常驻工具');
 await page.getByRole('button',{name:'加粗 Ctrl+B',exact:true}).click();await page.keyboard.insertText(' 加粗验收');await page.locator('.tiptap strong').filter({hasText:'加粗验收'}).waitFor();for(let i=0;i<20;i++)await page.keyboard.press('ArrowUp');await page.keyboard.insertText('光标可见');
 const caret=await page.evaluate(()=>({y:getSelection().getRangeAt(0).getBoundingClientRect().top,bar:document.querySelector('.toolbar').getBoundingClientRect().bottom}));assert.ok(caret.y>=caret.bar);
 await page.getByRole('button',{name:'进入专注模式',exact:true}).click();assert.equal(await page.getByLabel('主导航',{exact:true}).isVisible(),false);await geometry();await page.evaluate(()=>document.querySelector('.editor-scroll').scrollTop=0);await shot('09-专注书写');
 await page.keyboard.press('Control+f');await page.waitForFunction(()=>document.querySelector('[aria-label="搜索记录"]')===document.activeElement);assert.equal(await page.getByLabel('主导航',{exact:true}).isVisible(),true);
 await back();await resize(1260,820);await page.getByRole('button',{name:'回收站',exact:true}).click();await ready();await page.locator('.note-card').first().click();await page.locator('.trash-banner').waitFor();await geometry();await shot('10-回收站只读页');assert.equal(await page.getByRole('textbox',{name:'记录正文'}).getAttribute('contenteditable'),'false');await back();
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});await page.getByRole('button',{name:'清空回收站',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.note-card').length===0);await geometry();await shot('11-空回收站');
 await page.getByRole('button',{name:'全部记录',exact:true}).click();await ready();await page.getByLabel('搜索记录').fill('没有匹配的内容');await page.waitForFunction(()=>document.querySelectorAll('.note-card').length===0);await geometry();await shot('12-搜索空结果');await page.getByLabel('清除搜索').click();await ready();await page.locator('.note-card').first().click();await ready();
 const contrasts=await page.evaluate(()=>{
   const rgb=s=>s.match(/[\d.]+/g).map(Number),lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
   return ['.app-brand','.new-button','.tiptap','.save-state','.record-type','.page-details dd','.page-details dt','.attachment-hint','.app-status'].flatMap(selector=>{const el=document.querySelector(selector);if(!el?.checkVisibility())return[];const fg=rgb(getComputedStyle(el).color);let bg=[255,255,255],parent=el;while(parent){const c=rgb(getComputedStyle(parent).backgroundColor);if(c.length===3||c[3]===1){bg=c;break;}parent=parent.parentElement;}const a=lum(fg),b=lum(bg);return[{selector,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}];});
 });for(const {selector,ratio}of contrasts)assert.ok(ratio>=4.5,`${selector} 对比度 ${ratio}`);
 await page.keyboard.press('Control+s');assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['整页资料索引与独立书写场景','标签筛选及范围多选','常驻格式工具和光标可见','可调整宽度的按需目录','920px窄窗口操作无溢出或遮挡','主导航与目录的专注恢复','Ctrl+F跨场景搜索','菜单及说明','回收站只读及空状态','搜索空结果','主要文字对比度'],screenshots:shots},null,2));
}catch(error){if(page&&!page.isClosed())await shot('failure').catch(()=>{});throw error;}finally{if(app)await app.close();}
