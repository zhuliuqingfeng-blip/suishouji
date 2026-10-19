import {appRoot,testRoot,stagingRoot,stagedApp} from './paths.mjs';
process.chdir(appRoot);
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(testRoot,'ux-'+Date.now());await fs.mkdir(root,{recursive:true});
const executablePath=process.env.NOTES_PACKAGED_EXE||electronPath;
let instance,page;
async function until(predicate){for(let i=0;i<160;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,50));}throw new Error('体验验证等待超时');}
async function launch(){instance=await electron.launch({executablePath,args:process.env.NOTES_PACKAGED_EXE?[]:['.'],env:{...process.env,NOTES_TEST_MODE:'1',NOTES_DATA_DIR:root}});page=await instance.firstWindow();await page.getByRole('button',{name:/新建记录/}).first().waitFor();await until(()=>page.getByRole('button',{name:/新建记录/}).first().isEnabled());}
try{
 await launch();await page.screenshot({path:path.resolve(testRoot,'新版-空白界面.png')});
 await page.keyboard.press('Control+n');await page.getByLabel('记录标题').waitFor();
 await page.keyboard.press('Control+n');assert.equal((await page.evaluate(()=>window.notes.list({}))).length,1);
 await page.getByLabel('记录标题').fill('把今天的灵感，留在这里');
 await page.getByRole('textbox',{name:'记录正文'}).fill('记录不必复杂。\n\n一个想法、一张图片，或者一份值得留住的文件。\n\n慢慢写，也慢慢整理。');
 await page.getByLabel('添加标签',{exact:true}).fill('生活');await page.getByLabel('添加标签',{exact:true}).press('Enter');
 await page.getByLabel('添加标签',{exact:true}).fill('灵感');await page.getByLabel('添加标签',{exact:true}).press('Enter');
 await until(()=>page.evaluate(async()=>(await window.notes.list({}))[0]?.tags.length===2));
 const first=(await page.evaluate(()=>window.notes.list({})))[0];await page.evaluate(id=>window.notes.pin(id,true),first.id);
 await page.keyboard.press('Control+f');assert.equal(await page.getByLabel('搜索记录').evaluate(n=>n===document.activeElement),true);
 await page.getByLabel('搜索记录').fill('不存在');await page.keyboard.press('Escape');assert.equal(await page.getByLabel('搜索记录').inputValue(),'');
 const caption=await page.getByRole('textbox',{name:'记录正文'}).evaluate(n=>parseFloat(getComputedStyle(n).fontSize));assert.ok(caption>=16);
 const primary=await page.locator('.brand-icon').first().evaluate(n=>getComputedStyle(n).backgroundImage);assert.match(primary,/80, 86, 151/);
 assert.equal(await page.getByRole('button',{name:'添加图片或文件',exact:true}).isVisible(),true);
 await page.getByLabel('记录标题').focus();await page.evaluate(()=>document.querySelector('.editor-scroll').scrollTop=0);await page.waitForTimeout(150);
 await page.screenshot({path:path.resolve(testRoot,'新版-记录界面.png')});
 await page.keyboard.press('Control+n');await page.getByLabel('记录标题').fill('下次打开，从这里继续');
 await page.getByRole('textbox',{name:'记录正文'}).fill('这条记录没有置顶，用于验证打开位置。');
 await page.keyboard.press('Control+s');await until(()=>page.evaluate(async()=> (await window.notes.list({})).some(n=>n.title==='下次打开，从这里继续')));
 await page.getByRole('button',{name:'插入网页链接',exact:true}).click();await page.getByRole('dialog',{name:'插入网页链接',exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
 const closed=instance.waitForEvent('close');await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closed;instance=null;
 await launch();await until(async()=>await page.getByLabel('记录标题').inputValue()==='下次打开，从这里继续');
 console.log(JSON.stringify({passed:true,version:await page.evaluate(async()=>(await window.notes.info()).version),checks:['靛蓝珊瑚配色','正文字号16px','Ctrl+N新建','空白记录复用','Ctrl+F搜索','Esc清空搜索','顶部图片文件入口','记住上次未置顶记录','Esc关闭链接对话框']},null,2));
}catch(error){if(page)await page.screenshot({path:path.resolve(testRoot,'ux-failure.png')}).catch(()=>{});throw error;}finally{if(instance)await instance.close();}
