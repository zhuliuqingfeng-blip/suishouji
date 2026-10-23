import {appRoot,testRoot} from './paths.mjs';
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {Store} from '../dist-electron/store.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
process.chdir(appRoot);
const root=path.join(testRoot,'home-'+Date.now()),shots=path.join(testRoot,'home-1.5.1');
await fs.mkdir(root,{recursive:true});await fs.mkdir(shots,{recursive:true});
const store=new Store(root),ids=[],now=Date.now();
const titles=['工作台的小改造','周末去河边走走','一本书，读到这里','下周要带的资料','先留住这个想法','很早以前的一条置顶'];
for(let i=0;i<6;i++){
 const n=store.create().note;store.save({...n,title:titles[i],tags:[i%2?'生活':'工作'],document:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'把偶然遇见的想法留下来，等有空时再慢慢整理。这里使用独立的虚构内容。'}]}]}});
 store.db.prepare('UPDATE notes SET updatedAt=? WHERE id=?').run(new Date(now-(i===5?40:i)*86400000).toISOString(),n.id);ids.push(n.id);
}
store.pin(ids[5],true);const deleted=store.create().note;store.save({...deleted,title:'可以找回的旧草稿'});store.trash(deleted.id);store.close();
let app,page;const errors=[],checks=[];
async function ready(){await page.waitForFunction(()=>!document.querySelector('[aria-label="新建记录"]').disabled);}
async function launch(data=root){app=await electron.launch({executablePath:process.env.NOTES_PACKAGED_EXE||electronPath,args:process.env.NOTES_PACKAGED_EXE?[]:[appRoot],env:{...process.env,NOTES_TEST_MODE:'1',NOTES_DATA_DIR:data}});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('.home-mode').waitFor();await ready();}
async function close(){const end=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await end;app=null;}
async function home(){await page.getByRole('button',{name:'首页',exact:true}).click();await page.locator('.home-mode').waitFor();await ready();}
async function shot(name){await page.mouse.move(2,2);await page.screenshot({path:path.join(shots,name+'.png')});}
async function sql(statement){await app.evaluate((_e,{root,statement})=>{const db=new (process.getBuiltinModule('node:sqlite').DatabaseSync)(process.getBuiltinModule('node:path').join(root,'notes.sqlite'));try{db.exec(statement);}finally{db.close();}},{root,statement});}
async function resize(width,height){await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),{width,height});await page.waitForFunction(({width,height})=>Math.abs(innerWidth-width)<=2&&Math.abs(innerHeight-height)<=2,{width,height});}
async function geometry(){
 assert.deepEqual(await page.evaluate(()=>{
  const failures=[];if(document.documentElement.scrollWidth>innerWidth||document.querySelector('.home-page').scrollWidth>innerWidth)failures.push('横向溢出');
  for(const el of document.querySelectorAll('.app-navigation button,.home-page button')){if(!el.checkVisibility())continue;const b=el.getBoundingClientRect();if(b.left<0||b.right>innerWidth+1)failures.push('按钮超出窗口');if(b.top>=66&&b.bottom<=innerHeight-30){const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);if(hit!==el&&!el.contains(hit))failures.push('按钮被遮挡：'+(el.getAttribute('aria-label')||el.textContent));}}
  return failures;
 }),[]);
}
try{
 await launch();await resize(1260,820);
 assert.equal(await page.getByRole('button',{name:'继续上次记录',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'打开最近记录',exact:true}).isVisible(),true);
 assert.equal(await page.locator('[data-testid="home-total"]').innerText(),'6');
 assert.equal(await page.getByRole('button',{name:'新建记录',exact:true}).count(),1);assert.equal(await page.locator('.app-navigation [aria-label="新建记录"]').count(),0);
 assert.equal(await page.getByLabel('首页',{exact:true}).getByLabel('资料近况',{exact:true}).count(),0);assert.equal(await page.locator('.home-page').getByRole('button',{name:/备份|回收站/}).count(),0);
 await page.getByRole('button',{name:'数据与设置',exact:true}).click();assert.equal(await page.locator('[data-testid="home-week"]').innerText(),'5');assert.equal(await page.locator('[data-testid="settings-total"]').innerText(),'6');await page.keyboard.press('Escape');
 assert.equal((await page.evaluate(()=>window.notes.list({}))).length,6);assert.equal(await page.evaluate(()=>localStorage.getItem('suishouji:last-note')),null);
 assert.deepEqual(await page.locator('.home-recent-copy strong').allTextContents(),titles.slice(0,3));checks.push('启动概览不创建记录，最近更新不受置顶影响');
 await page.evaluate(id=>{localStorage.setItem('suishouji:last-note',id);localStorage.setItem('suishouji:workspace:v2',JSON.stringify({view:'document',focused:true,indexWidth:410,indexHidden:false,libraryHeaderHeight:56}));},ids[2]);
 await page.reload();await page.locator('.home-mode').waitFor();await ready();
 assert.equal(await page.getByRole('button',{name:'继续上次记录',exact:true}).locator('strong').innerText(),titles[2]);assert.equal(await page.locator('.editor-panel').isVisible(),false);
 assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('suishouji:workspace:v2')))).indexWidth,410);
 await geometry();await shot('01-首页概览');checks.push('兼容旧书写和专注偏好，启动固定首页且保留栏宽');
 const composition=await page.evaluate(()=>{const box=s=>document.querySelector(s).getBoundingClientRect();return {title:box('.home-intro h1').bottom,create:box('.home-create').top,continued:box('.home-continue-section').top,recent:box('.home-recents').top,foot:box('.home-footnote').top,continuationHeight:box('.home-continue-section').height,titleSize:parseFloat(getComputedStyle(document.querySelector('.home-intro h1')).fontSize),continueSize:parseFloat(getComputedStyle(document.querySelector('.home-continue-copy strong')).fontSize),background:getComputedStyle(document.querySelector('.home-continuation')).backgroundColor};});
 assert.ok(composition.title<composition.create&&composition.create<composition.continued&&composition.continued<composition.recent&&composition.recent<composition.foot);assert.ok(composition.continuationHeight<150);assert.ok(composition.titleSize>composition.continueSize*1.7);assert.equal(composition.background,'rgba(0, 0, 0, 0)');checks.push('单列顺序与视觉层级，首页唯一新建，系统管理移至设置');
 await page.getByRole('button',{name:'继续上次记录',exact:true}).click();await page.locator('.document-mode').waitFor();await ready();assert.equal(await page.getByLabel('记录标题').inputValue(),titles[2]);
 await page.getByRole('button',{name:'进入专注模式',exact:true}).click();await close();await launch();assert.equal(await page.getByLabel('主导航',{exact:true}).isVisible(),true);checks.push('从专注书写退出后重启仍到首页，继续入口对应实际记录');
 await page.getByRole('button',{name:'全部记录',exact:true}).click();await page.locator('.library-mode').waitFor();await ready();assert.equal(await page.locator('.app-navigation [aria-label="新建记录"]').count(),1);await page.getByLabel('标签筛选',{exact:true}).getByRole('button',{name:/^工作/}).click();await ready();assert.equal(await page.locator('.note-card').count(),3);
 await page.getByLabel('记录排序').selectOption('title');await home();assert.equal(await page.locator('[data-testid="home-total"]').innerText(),'6');assert.deepEqual(await page.locator('.home-recent-copy strong').allTextContents(),titles.slice(0,3));assert.equal(await page.getByRole('button',{name:'继续上次记录',exact:true}).locator('strong').innerText(),titles[2]);checks.push('标签和排序不污染首页内容，也不覆盖上次记录');
 await page.keyboard.press('Control+f');await page.locator('.library-mode').waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="搜索记录"]')===document.activeElement);await page.getByLabel('搜索记录').fill('周末');await page.waitForFunction(()=>document.querySelectorAll('.note-card').length===1);
 await home();await page.keyboard.press('Control+n');await page.locator('.document-mode').waitFor();await ready();await page.getByLabel('记录标题').fill('刚写下，就先回到首页');await home();
 assert.equal(await page.getByRole('button',{name:'继续上次记录',exact:true}).locator('strong').innerText(),'刚写下，就先回到首页');assert.equal(await page.locator('[data-testid="home-total"]').innerText(),'7');checks.push('首页Ctrl+F进入搜索，Ctrl+N记录，返回首页立即保存');
 await page.getByRole('button',{name:'继续上次记录',exact:true}).click();await ready();const lastId=await page.evaluate(()=>localStorage.getItem('suishouji:last-note'));
 await sql(`CREATE TRIGGER stop_home_save BEFORE UPDATE OF title ON notes WHEN NEW.id='${lastId}' BEGIN SELECT RAISE(ABORT,'首页保存失败验收'); END;`);
 await page.getByLabel('记录标题').fill('保存失败时保留这一页');await page.getByRole('button',{name:'首页',exact:true}).click();await page.getByRole('alert').filter({hasText:'首页保存失败验收'}).waitFor();assert.equal(await page.locator('.document-mode').count(),1);assert.equal(await page.getByLabel('记录标题').inputValue(),'保存失败时保留这一页');
 await sql('DROP TRIGGER stop_home_save');await page.getByRole('button',{name:'关闭提示',exact:true}).click();await home();checks.push('保存失败阻止返回首页并保留草稿，解除后重试成功');
 await app.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>({canceled:true});});await page.getByRole('button',{name:'数据与设置',exact:true}).click();await page.getByRole('button',{name:'备份全部数据',exact:true}).click();await ready();assert.match(await page.getByLabel('本地保存状态',{exact:true}).innerText(),/保存在本地/);assert.doesNotMatch(await page.getByLabel('本地保存状态',{exact:true}).innerText(),/已备份/);
 const backup=path.join(root,'首页备份.zip');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},backup);await page.getByRole('button',{name:'数据与设置',exact:true}).click();await page.getByRole('button',{name:'备份全部数据',exact:true}).click();await page.getByRole('status').filter({hasText:'备份已保存'}).waitFor();await ready();await fs.access(backup);assert.match(await page.getByLabel('本地保存状态',{exact:true}).innerText(),/已备份/);await page.getByRole('button',{name:'数据与设置',exact:true}).click();assert.match(await page.locator('.settings-backup-state').innerText(),/最近备份/);await shot('05-数据与设置');await page.keyboard.press('Escape');checks.push('设置中备份和详情可用，轻状态仅在成功后显示已备份');
 await page.getByRole('button',{name:'继续上次记录',exact:true}).click();await ready();await page.getByRole('button',{name:'更多记录操作',exact:true}).click();await page.getByRole('button',{name:'移到回收站',exact:true}).click();await ready();await home();assert.equal(await page.locator('[data-testid="home-total"]').innerText(),'6');assert.equal(await page.getByRole('button',{name:'继续上次记录',exact:true}).count(),0);
 await page.getByRole('button',{name:'数据与设置',exact:true}).click();await page.getByRole('button',{name:/^查看回收站/}).click();await page.locator('.note-card').filter({hasText:'保存失败时保留这一页'}).click();await page.getByRole('button',{name:'恢复记录',exact:true}).click();await ready();await home();assert.equal(await page.getByRole('button',{name:'继续上次记录',exact:true}).locator('strong').innerText(),'保存失败时保留这一页');await page.getByRole('button',{name:'关闭提示',exact:true}).click();checks.push('删除后不继续已删除记录，设置可找回回收站内容');
 await resize(920,650);await geometry();await shot('02-窄窗口首页');assert.ok(await page.locator('.home-page').evaluate(n=>n.scrollHeight>n.clientHeight));await page.keyboard.press('Control+f');await page.waitForFunction(()=>document.querySelector('[aria-label="搜索记录"]')===document.activeElement);await home();
 await page.getByRole('button',{name:'继续上次记录',exact:true}).click();await ready();await page.getByLabel('记录标题').fill('用于检验标题换行与内容边界的长标题'.repeat(8));await home();await geometry();await shot('03-长标题');checks.push('920px窗口可滚动且导航、搜索及长标题不溢出');
 await close();await launch(path.join(root,'empty'));assert.equal(await page.getByRole('button',{name:'继续上次记录',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'打开最近记录',exact:true}).count(),0);assert.equal((await page.evaluate(()=>window.notes.list({}))).length,0);await shot('04-首次使用');await geometry();
 await page.keyboard.press('Control+f');await page.locator('.library-mode').waitFor();assert.equal((await page.evaluate(()=>window.notes.list({}))).length,0);await home();await page.getByRole('button',{name:'新建记录',exact:true}).click();await page.locator('.document-mode').waitFor();await ready();assert.equal((await page.evaluate(()=>window.notes.list({}))).length,1);checks.push('空首页无假记录，首次使用可自由浏览或开始记录');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,screenshots:shots},null,2));
}catch(error){if(page&&!page.isClosed())await shot('failure').catch(()=>{});throw error;}finally{if(app)await app.close();}
