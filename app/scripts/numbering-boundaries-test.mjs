import {appRoot,testRoot} from './paths.mjs';
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

process.chdir(appRoot);
const root=path.join(testRoot,'numbering-boundaries-'+Date.now());
await fs.mkdir(root,{recursive:true});
const p=text=>({type:'paragraph',content:text?[{type:'text',text}]:[]}),item=(text,extra=[])=>({type:'listItem',content:[p(text),...extra]});
const ol=(start,items,continuePrevious=false)=>({type:'orderedList',attrs:{start,continuePrevious},content:items.map(text=>typeof text==='string'?item(text):text)});
const bullet=items=>({type:'bulletList',content:items.map(text=>item(text))});
let app,page,id;
const checks=[],failures=[],errors=[];
async function launch(){
  app=await electron.launch({executablePath:process.env.NOTES_PACKAGED_EXE||electronPath,args:process.env.NOTES_PACKAGED_EXE?[]:[appRoot],env:{...process.env,NOTES_TEST_MODE:'1',NOTES_DATA_DIR:root}});
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('.home-mode').waitFor();
}
async function close(){const end=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await end;app=null;}
async function open(title){
  await page.getByRole('button',{name:'全部记录',exact:true}).click();
  await page.locator('.note-card').filter({hasText:title}).first().click();
  await page.getByLabel('记录标题',{exact:true}).filter({visible:true}).waitFor();
  await page.waitForFunction(title=>document.querySelector('[aria-label="记录标题"]').value===title&&!document.querySelector('.space-tabs button').disabled,title);
}
async function fixture(title,content){id=await page.evaluate(async({title,content})=>{const {note}=await window.notes.create();await window.notes.save({...note,title,document:{type:'doc',content}});return note.id;},{title,content});await open(title);}
async function cursor(text){
  await page.evaluate(text=>{const element=document.querySelector('.tiptap'),editor=element.editor,target=[...element.querySelectorAll('p')].find(n=>n.textContent===text);if(!target)throw new Error('找不到测试段落：'+text);editor.commands.setTextSelection(editor.view.posAtDOM(target,0));editor.view.focus();},text);
  await page.waitForFunction(text=>document.querySelector('.tiptap').editor.state.selection.$from.parent.textContent===text,text);
}
async function toggle(){await page.getByRole('button',{name:'编号列表',exact:true}).click();}
async function lists(selector='.tiptap>ol'){return page.locator(selector).evaluateAll(nodes=>nodes.map(n=>[n.start,n.children.length]));}
async function saved(){await page.keyboard.press('Control+s');await page.getByText('所有更改已保存',{exact:true}).waitFor();return page.evaluate(async id=>(await window.notes.get(id)).note.document,id);}
async function check(name,run){try{await run();checks.push(name);}catch(error){failures.push({name,error:error.stack});await page.screenshot({path:path.join(root,'failure-'+failures.length+'.png')});}}
async function insertItemAfter(text,newText){
  await cursor(text);await page.keyboard.press('End');
  await page.waitForFunction(()=>{const {$from}=document.querySelector('.tiptap').editor.state.selection;return $from.parentOffset===$from.parent.content.size;});
  await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('.tiptap').editor.state.selection.$from.parent.content.size===0);
  await page.keyboard.insertText(newText);
}
try{
  await launch();
  await check('Shift+Tab取消中间项与按钮一致，撤销重做、保存重开后保持接续',async()=>{
    await fixture('Shift+Tab中间项',[ol(1,['键盘甲','键盘乙','键盘丙']),p('说明'),ol(4,['键盘丁'],true),p('独立组'),ol(1,['独立甲']),p('说明'),ol(2,['独立乙'],true)]);
    await cursor('键盘乙');await page.keyboard.press('Shift+Tab');assert.deepEqual(await lists(),[[1,1],[2,1],[3,1],[1,1],[2,1]]);
    let doc=await saved();assert.deepEqual(doc.content.filter(n=>n.type==='orderedList').map(n=>n.attrs.continuePrevious),[false,true,true,false,true]);
    await page.keyboard.press('Control+z');assert.deepEqual(await lists(),[[1,3],[4,1],[1,1],[2,1]]);
    await page.keyboard.press('Control+y');assert.deepEqual(await lists(),[[1,1],[2,1],[3,1],[1,1],[2,1]]);
    await saved();await close();await launch();await open('Shift+Tab中间项');assert.deepEqual(await lists(),[[1,1],[2,1],[3,1],[1,1],[2,1]]);
  });
  await check('按钮、Shift+Tab、Backspace和直接提级命令得到相同正文及编号关系',async()=>{
    let expected;
    for(const mode of ['按钮','Shift+Tab','Backspace','命令']){
      await fixture('统一提级入口'+mode,[ol(7,['统一甲','统一乙','统一丙']),p('说明'),ol(10,['统一丁'],true)]);await cursor('统一乙');
      if(mode==='按钮')await toggle();else if(mode==='命令')assert.equal(await page.evaluate(()=>document.querySelector('.tiptap').editor.commands.liftListItem('listItem')),true);else await page.keyboard.press(mode);
      assert.deepEqual(await lists(),[[7,1],[8,1],[9,1]]);
      const doc=await saved();if(expected)assert.deepEqual(doc,expected);else expected=doc;
    }
  });
  await check('空编号项按Enter退出时也保持后续接续，撤销重做有效',async()=>{
    await fixture('空编号项回车',[ol(7,['空项甲','','空项丙']),p('说明'),ol(10,['空项丁'],true)]);await cursor('');
    await page.keyboard.press('Enter');assert.deepEqual(await lists(),[[7,1],[8,1],[9,1]]);
    await page.keyboard.press('Control+z');assert.deepEqual(await lists(),[[7,3],[10,1]]);
    await page.keyboard.press('Control+y');assert.deepEqual(await lists(),[[7,1],[8,1],[9,1]]);
  });
  await check('Shift+Tab支持多项及引用，首尾取消、项目列表与嵌套提级保持原行为',async()=>{
    await fixture('键盘连续多项',[ol(7,['多项甲','多项乙','多项丙','多项丁','多项戊']),p('说明'),ol(12,['多项己'],true)]);
    await page.evaluate(()=>{const element=document.querySelector('.tiptap'),editor=element.editor,paragraphs=[...element.querySelectorAll('p')],first=paragraphs.find(n=>n.textContent==='多项乙'),last=paragraphs.find(n=>n.textContent==='多项丙');editor.commands.setTextSelection({from:editor.view.posAtDOM(first,0),to:editor.view.posAtDOM(last,last.childNodes.length)});editor.view.focus();});
    await page.keyboard.press('Shift+Tab');assert.deepEqual(await lists(),[[7,1],[8,2],[10,1]]);
    await fixture('键盘引用提级',[{type:'blockquote',content:[ol(3,['键引甲','键引乙','键引丙']),p('说明'),ol(6,['键引丁'],true)]}]);
    await cursor('键引乙');await page.keyboard.press('Shift+Tab');assert.deepEqual(await lists('.tiptap>blockquote>ol'),[[3,1],[4,1],[5,1]]);
    for(const selected of ['首尾甲','首尾丙']){await fixture('键盘首尾取消'+selected,[ol(7,['首尾甲','首尾乙','首尾丙']),p('说明'),ol(10,['首尾丁'],true)]);await cursor(selected);await page.keyboard.press('Shift+Tab');assert.deepEqual(await lists(),[[7,2],[9,1]]);}
    await fixture('键盘项目列表',[bullet(['项目甲','项目乙','项目丙'])]);await cursor('项目乙');await page.keyboard.press('Shift+Tab');assert.deepEqual(await lists(),[]);assert.deepEqual(await page.locator('.tiptap>ul').evaluateAll(nodes=>nodes.map(n=>n.children.length)),[1,1]);assert.equal(await page.locator('.tiptap>p').filter({hasText:/^项目乙$/}).count(),1);
    await fixture('键盘嵌套提级',[ol(30,[item('键外层',[ol(7,['键内甲','键内乙','键内丙'])])])]);await cursor('键内乙');await page.keyboard.press('Shift+Tab');assert.deepEqual(await lists(),[[30,2]]);assert.deepEqual(await lists('.tiptap>ol>li>ol'),[[7,1],[7,1]]);
    const doc=await saved();assert.ok(doc.content[0].content.every(n=>n.content.find(c=>c.type==='orderedList').attrs.continuePrevious===false));
  });
  await check('外层编号不会使内层项目列表跳过接续；前组增删、撤销重做和重开有效',async()=>{
    await fixture('嵌套编号边界',[ol(30,[item('外层项目',[ol(7,['内层第七项']),p('内层说明'),bullet(['内层待编号甲','内层待编号乙'])])])]);
    await cursor('内层待编号甲');const pressedBefore=await page.getByRole('button',{name:'编号列表',exact:true}).getAttribute('aria-pressed');
    await toggle();assert.deepEqual(await lists('.tiptap>ol>li>ol'),[[7,1],[8,2]]);assert.equal(pressedBefore,'false');assert.deepEqual(await lists(),[[30,1]]);
    let doc=await saved();assert.equal(doc.content[0].content[0].content[3].attrs.continuePrevious,true);
    await insertItemAfter('内层第七项','内层新增项目');assert.deepEqual(await lists('.tiptap>ol>li>ol'),[[7,2],[9,2]]);
    await page.keyboard.press('Control+z');assert.deepEqual(await lists('.tiptap>ol>li>ol'),[[7,1],[8,2]]);
    await page.keyboard.press('Control+y');assert.deepEqual(await lists('.tiptap>ol>li>ol'),[[7,2],[9,2]]);
    await saved();await close();await launch();await open('嵌套编号边界');assert.deepEqual(await lists('.tiptap>ol>li>ol'),[[7,2],[9,2]]);
  });
  await check('取消首组中间项后剩余编号接续，独立起点保留，撤销重做及重开有效',async()=>{
    await fixture('取消中间编号边界',[ol(1,['甲','乙','丙']),p('说明正文'),ol(4,['丁'],true),p('另一段说明'),ol(1,['独立的一']),p('说明'),ol(2,['独立的二'],true)]);
    await cursor('乙');await toggle();assert.deepEqual(await lists(),[[1,1],[2,1],[3,1],[1,1],[2,1]]);
    assert.equal(await page.locator('.tiptap>p').filter({hasText:/^乙$/}).count(),1);
    let doc=await saved();assert.deepEqual(doc.content.filter(n=>n.type==='orderedList').map(n=>n.attrs.continuePrevious),[false,true,true,false,true]);
    await page.keyboard.press('Control+z');assert.deepEqual(await lists(),[[1,3],[4,1],[1,1],[2,1]]);
    await page.keyboard.press('Control+y');assert.deepEqual(await lists(),[[1,1],[2,1],[3,1],[1,1],[2,1]]);
    await saved();await close();await launch();await open('取消中间编号边界');assert.deepEqual(await lists(),[[1,1],[2,1],[3,1],[1,1],[2,1]]);
  });
  await check('连续多项取消、自定义起点、引用和已接续组使用实际编辑命令',async()=>{
    await fixture('连续多项取消',[ol(7,['范围甲','范围乙','范围丙','范围丁','范围戊']),p('说明'),ol(12,['范围己'],true)]);
    await page.evaluate(()=>{const element=document.querySelector('.tiptap'),editor=element.editor,paragraphs=[...element.querySelectorAll('p')],first=paragraphs.find(n=>n.textContent==='范围乙'),last=paragraphs.find(n=>n.textContent==='范围丙');editor.commands.setTextSelection({from:editor.view.posAtDOM(first,0),to:editor.view.posAtDOM(last,last.childNodes.length)});editor.view.focus();});
    await toggle();assert.deepEqual(await lists(),[[7,1],[8,2],[10,1]]);
    await fixture('引用内取消',[{type:'blockquote',content:[ol(3,['引用甲','引用乙','引用丙']),p('说明'),ol(6,['引用丁'],true)]}]);
    await cursor('引用乙');await page.keyboard.press('Control+Shift+7');assert.deepEqual(await lists('.tiptap>blockquote>ol'),[[3,1],[4,1],[5,1]]);
    await fixture('已接续组取消',[ol(5,['前五','前六']),p('说明'),ol(7,['接续甲','接续乙','接续丙'],true),p('说明'),ol(10,['接续丁'],true)]);
    await cursor('接续乙');await toggle();assert.deepEqual(await lists(),[[5,2],[7,1],[8,1],[9,1]]);
  });
  await check('修复后的编号关系完整备份恢复和HTML导出保持一致',async()=>{
    await saved();const backup=path.join(root,'编号备份.zip'),out=path.join(root,'编号导出');await fs.mkdir(out);
    await app.evaluate(({dialog,shell},{backup,out})=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:backup});dialog.showOpenDialog=async(_win,options)=>({canceled:false,filePaths:options.properties?.includes('openDirectory')?[out]:[backup]});dialog.showMessageBox=async()=>({response:1});shell.openPath=async()=>'';},{backup,out});
    assert.ok(await page.evaluate(()=>window.notes.backup()));const original=await page.evaluate(async id=>(await window.notes.get(id)).note,id);
    await page.evaluate(async id=>{const {note}=await window.notes.get(id);await window.notes.save({...note,document:{type:'doc',content:[{type:'paragraph'}]}});},id);
    assert.ok(await page.evaluate(()=>window.notes.restoreBackup()));assert.deepEqual(await page.evaluate(async id=>(await window.notes.get(id)).note.document,id),original.document);
    const destination=await page.evaluate(id=>window.notes.exportNotes(id),id),html=await fs.readFile(path.join(destination,id+'.html'),'utf8');
    for(const start of [5,7,8,9])assert.ok(html.includes(`<ol start="${start}">`));
  });
  assert.deepEqual(errors,[]);
  await close();console.log(JSON.stringify({passed:!failures.length,checks,failures,dataDir:root},null,2));
  if(failures.length)process.exitCode=1;
}finally{if(app)await app.close();}
