import {appRoot,testRoot} from './paths.mjs';
process.chdir(appRoot);
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root=path.join(testRoot,'clipboard-'+Date.now()); await fs.mkdir(root,{recursive:true});
let instance,page,passed=false,diagnostics='';
const errors=[],checks=[];
async function until(fn){for(let i=0;i<160;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error('剪贴板验收等待超时');}
async function writeClipboard(text,html){await instance.evaluate(async({clipboard,ClipboardItem},{text,html})=>{
  const data={'text/plain':new Blob([text],{type:'text/plain'})};
  if(html)data['text/html']=new Blob([html],{type:'text/html'});
  await clipboard.write([new ClipboardItem(data)]);
},{text,html});}
async function readClipboard(){return instance.evaluate(async({clipboard})=>({text:await clipboard.readText(),types:(await clipboard.read()).flatMap(item=>item.types)}));}
async function selectText(selector,start,end){await page.locator('.tiptap').focus();await page.evaluate(({selector,start,end})=>{
  const el=document.querySelector(selector),range=document.createRange(),selection=window.getSelection();
  if(start===undefined)range.selectNodeContents(el);else {
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    const position=offset=>{for(const node of nodes){if(offset<=node.length)return [node,offset];offset-=node.length;}throw new Error('文字选区超出范围');};
    range.setStart(...position(start));range.setEnd(...position(end));
  }
  selection.removeAllRanges();selection.addRange(range);
},{selector,start,end});await page.waitForTimeout(80);}
async function newNote(title){await page.keyboard.press('Control+n');await until(async()=>await page.getByLabel('记录标题').isEnabled()&&await page.getByLabel('记录标题').inputValue()==='');await page.getByLabel('记录标题').fill(title);await page.locator('.tiptap').focus();}
async function pasted(){await until(()=>page.getByText('已粘贴为纯文本',{exact:true}).isVisible());}
async function getDoc(){await page.keyboard.press('Control+s');await until(()=>page.getByText('所有更改已保存',{exact:true}).isVisible());return page.evaluate(async()=>{
  const title=document.querySelector('[aria-label="记录标题"]').value;
  const row=(await window.notes.list({})).find(n=>n.title===title);return (await window.notes.get(row.id)).note.document;
});}
async function menuAction(label){await instance.evaluate((_electron,label)=>{globalThis.__nextMenuAction=label;},label);}
try{
  instance=await electron.launch({executablePath:process.env.NOTES_PACKAGED_EXE||electronPath,args:process.env.NOTES_PACKAGED_EXE?[]:['.'],env:{...process.env,NOTES_TEST_MODE:'1',NOTES_DATA_DIR:path.join(root,'我的数据')}});
  instance.process().stderr?.on('data',chunk=>{diagnostics=(diagnostics+chunk).slice(-4000);});
  // Save the user's OS clipboard eagerly and restore it after all checks.
  await instance.evaluate(async({clipboard,ClipboardItem,Menu})=>{
    globalThis.__previousClipboard=await Promise.all((await clipboard.read()).map(async item=>new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))));
    globalThis.__nativePopup=Menu.prototype.popup;
    Menu.prototype.popup=function(options){
      globalThis.__lastMenu=this;globalThis.__lastMenuOptions=options;
      globalThis.__menuItems=this.items.map(i=>({label:i.label,role:i.role,enabled:i.enabled,accelerator:i.accelerator}));
      const chosen=globalThis.__nextMenuAction;globalThis.__nextMenuAction=null;
      if(chosen){const item=this.items.find(i=>i.label===chosen);if(!item||!item.enabled)throw new Error('菜单项目不可用：'+chosen);item.click(item,options.window);options.callback?.();return;}
      return globalThis.__nativePopup.call(this,options);
    };
  });
  page=await instance.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await until(()=>page.getByRole('button',{name:'新建记录',exact:true}).first().isEnabled());
  await newNote('随手摘录 · 纯文本操作');
  const source='<h2>值得记下的一句话</h2><p><strong>保留灵感</strong>，也可以<a href="https://example.com">阅读原文</a>。</p><ul><li><p>一个想法</p></li><li><p>一份资料</p></li></ul>';
  await writeClipboard('值得记下的一句话\n保留灵感，也可以阅读原文。\n一个想法\n一份资料',source);
  await page.keyboard.press('Control+v');await page.locator('.tiptap h2').waitFor();
  assert.equal(await page.locator('.tiptap strong').innerText(),'保留灵感');assert.equal(await page.locator('.tiptap a').innerText(),'阅读原文');
  const png=await fs.readFile('assets/icon.png');
  await instance.evaluate(async({clipboard,ClipboardItem},bytes)=>clipboard.write([new ClipboardItem({'image/png':new Blob([Buffer.from(bytes)],{type:'image/png'})})]),[...png]);
  await page.keyboard.press('Control+End');await page.keyboard.press('Control+v');await page.locator('.tiptap img').waitFor();
  await page.waitForFunction(()=>document.querySelector('.tiptap img').naturalWidth>0);
  await selectText('.tiptap');const beforeCopy=await page.locator('.tiptap').innerHTML();
  await page.keyboard.press('Control+Shift+c');await until(()=>page.getByText('已复制为纯文本',{exact:true}).isVisible());
  let clipboard=await readClipboard();assert.match(clipboard.text,/值得记下的一句话\n保留灵感/);assert.match(clipboard.text,/一个想法\n一份资料/);
  assert.doesNotMatch(clipboard.text,/app-asset|https:|<h2|png/);assert.deepEqual(clipboard.types,['text/plain']);
  assert.equal(await page.locator('.tiptap').innerHTML(),beforeCopy);checks.push('选区纯文本复制保留换行、排除图片且原格式不变');
  await page.keyboard.press('Control+c');await until(async()=>(await readClipboard()).types.includes('text/html'));checks.push('普通复制仍带格式');
  await selectText('.tiptap strong');await menuAction('复制为纯文本');await page.locator('.tiptap strong').click({button:'right'});
  await until(async()=>(await readClipboard()).text==='保留灵感');checks.push('正文右键复制选区');
  await page.getByLabel('记录标题').fill('尚未等待保存的标题');
  await page.getByRole('button',{name:'更多记录操作',exact:true}).click();await page.getByRole('button',{name:'复制全文为纯文本',exact:true}).click();
  await until(async()=>(await readClipboard()).text.startsWith('尚未等待保存的标题\n\n值得记下的一句话'));
  assert.deepEqual((await readClipboard()).types,['text/plain']);checks.push('全文复制读取当前标题与正文');
  await selectText('.tiptap strong');await menuAction('复制为纯文本');await page.getByRole('button',{name:'纯文本复制与粘贴'}).click();
  await until(async()=>(await readClipboard()).text==='保留灵感');checks.push('工具栏按钮保留正文选区');
  await until(()=>page.getByRole('button',{name:'纯文本复制与粘贴'}).isEnabled());
  await selectText('.tiptap strong',4,4);await writeClipboard('原剪贴板');await page.keyboard.press('Control+Shift+c');
  await until(()=>page.getByText('请先在正文中选中文字',{exact:true}).isVisible());assert.equal((await readClipboard()).text,'原剪贴板');
  checks.push('未选择文字不覆盖剪贴板');
  await newNote('纯文本粘贴验收');
  assert.equal(await page.getByRole('button',{name:'撤销 Ctrl+Z'}).isEnabled(),false);
  const plain='无格式的文字\n\n<b>这不是HTML</b> & 保留字面文字\n最后一行';
  await writeClipboard(plain,'<h2 style="color:red">来源标题</h2><p><b>来源加粗</b><a href="https://example.com">来源链接</a></p>');
  await page.keyboard.press('Control+Shift+v');await pasted();
  assert.equal(await page.locator('.tiptap h2,.tiptap strong,.tiptap a,.tiptap img').count(),0);
  assert.deepEqual((await getDoc()).content.filter(n=>n.type==='paragraph').map(n=>n.content?.map(t=>t.text).join('')??''),plain.split('\n'));
  await page.locator('.tiptap').focus();await page.keyboard.press('Control+z');assert.equal((await page.locator('.tiptap').innerText()).trim(),'');
  await page.keyboard.press('Control+y');await page.getByText('<b>这不是HTML</b> & 保留字面文字',{exact:true}).waitFor();checks.push('纯文本粘贴、空行、字面HTML、撤销重做');
  await newNote('插入已有格式的正文');await writeClipboard('前原文后','<p><strong><a href="https://example.com">前原文后</a></strong></p>');
  await page.keyboard.press('Control+v');await page.locator('.tiptap a').waitFor();
  await selectText('.tiptap a',1,3);await writeClipboard('无格式','<h1>不应插入的格式</h1>');
  await menuAction('粘贴为纯文本');await page.locator('.tiptap').click({button:'right'});await pasted();
  let doc=await getDoc();let nodes=doc.content[0].content;assert.equal(nodes.find(n=>n.text==='无格式')?.marks,undefined);
  assert.equal(nodes.find(n=>n.text==='前')?.marks.length,2);assert.equal(nodes.find(n=>n.text==='后')?.marks.length,2);
  await page.locator('.tiptap').focus();await page.keyboard.insertText('继续输入');doc=await getDoc();
  assert.ok(doc.content[0].content.some(n=>n.text.includes('无格式继续输入')&&!n.marks));checks.push('在加粗链接中替换选区，保留周围样式且后续输入无样式');
  await writeClipboard('工具栏粘贴');await menuAction('粘贴为纯文本');await page.getByRole('button',{name:'纯文本复制与粘贴'}).click();
  await until(()=>page.locator('.tiptap').innerText().then(t=>t.includes('工具栏粘贴')));checks.push('工具栏纯文本粘贴');
  const beforeEmpty=await page.locator('.tiptap').innerHTML();await instance.evaluate(async({clipboard,ClipboardItem},bytes)=>clipboard.write([new ClipboardItem({'image/png':new Blob([Buffer.from(bytes)],{type:'image/png'})})]),[...png]);
  await page.locator('.tiptap').focus();await page.keyboard.press('Control+Shift+v');await until(()=>page.getByText('剪贴板里没有可粘贴的文字',{exact:true}).isVisible());
  assert.equal(await page.locator('.tiptap').innerHTML(),beforeEmpty);checks.push('纯文本粘贴遇到只有图片时不导入图片');
  await instance.evaluate(({clipboard})=>{globalThis.__readText=clipboard.readText;clipboard.readText=async()=>{throw new Error('剪贴板临时不可用，请重试');};});
  await page.keyboard.press('Control+Shift+v');await until(()=>page.getByRole('alert').filter({hasText:'剪贴板临时不可用'}).isVisible());assert.equal(await page.locator('.tiptap').innerHTML(),beforeEmpty);
  await instance.evaluate(({clipboard})=>{clipboard.readText=globalThis.__readText;globalThis.__writeText=clipboard.writeText;clipboard.writeText=async()=>{throw new Error('复制失败，请重试');};});
  await selectText('.tiptap');await page.keyboard.press('Control+Shift+c');await until(()=>page.getByRole('alert').filter({hasText:'复制失败'}).isVisible());
  await instance.evaluate(({clipboard})=>{clipboard.writeText=globalThis.__writeText;});checks.push('剪贴板读写失败提示且内容保留');
  await writeClipboard('不应插入下一条');
  await instance.evaluate(({clipboard})=>{clipboard.readText=async()=>{await new Promise(r=>setTimeout(r,400));return globalThis.__readText();};});
  await page.locator('.tiptap').focus();await page.keyboard.press('Control+End');await page.keyboard.press('Control+Shift+v');await newNote('异步粘贴保护');
  await page.waitForTimeout(550);assert.equal((await page.locator('.tiptap').innerText()).trim(),'');
  await instance.evaluate(({clipboard})=>{clipboard.readText=globalThis.__readText;});checks.push('异步读取剪贴板期间换记录不会串写');
  await page.keyboard.press('Control+f');await page.getByLabel('搜索记录').fill('搜索框输入');await writeClipboard('剪贴板保留');await page.keyboard.press('Control+Shift+c');assert.equal((await readClipboard()).text,'剪贴板保留');
  await page.getByLabel('清除搜索').click();checks.push('快捷键仅作用于正文');
  if(!await page.getByLabel('搜索记录').isVisible())await page.getByRole('button',{name:'显示记录列表',exact:true}).click();
  await page.locator('.note-card').filter({hasText:'尚未等待保存的标题'}).click();await page.locator('.tiptap h2').waitFor();
  assert.equal(await page.getByRole('button',{name:'撤销 Ctrl+Z'}).isEnabled(),false);checks.push('新建及切换记录不会带入其他记录的撤销历史');
  await page.getByLabel('记录标题').fill('随手摘录 · 纯文本操作');
  if(await page.getByRole('button',{name:'关闭提示',exact:true}).isVisible())await page.getByRole('button',{name:'关闭提示',exact:true}).click();
  await page.locator('.tiptap').focus();await page.keyboard.press('ArrowRight');
  await page.getByRole('button',{name:'纯文本复制与粘贴'}).click();
  await until(()=>instance.evaluate(()=>globalThis.__menuItems?.[0]?.enabled===false));
  await instance.evaluate(({BrowserWindow})=>globalThis.__lastMenu.closePopup(BrowserWindow.getAllWindows()[0]));
  await until(()=>page.getByRole('button',{name:'纯文本复制与粘贴'}).getAttribute('aria-expanded').then(v=>v==='false'));
  checks.push('真实原生菜单显示、禁用空选区复制、关闭后恢复按钮状态');
  await selectText('.tiptap strong');
  await page.screenshot({path:path.join(root,'01-normal.png')});
  await page.getByRole('button',{name:'更多记录操作',exact:true}).click();await page.screenshot({path:path.join(root,'02-note-menu.png')});await page.keyboard.press('Escape');
  await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(920,700));
  await page.waitForTimeout(250);await page.evaluate(()=>document.querySelector('.editor-scroll').scrollTop=0);
  const dimensions=await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,editor:document.querySelector('.editor-panel').getBoundingClientRect().width,toolbar:document.querySelector('.toolbar').getBoundingClientRect().toJSON(),children:[...document.querySelectorAll('.toolbar button')].map(n=>n.getBoundingClientRect().toJSON())}));
  assert.equal(dimensions.scrollWidth,dimensions.viewport);assert.ok(dimensions.editor>=400);
  for(const child of dimensions.children){assert.ok(child.left>=dimensions.toolbar.left);assert.ok(child.right<=dimensions.toolbar.right+1);assert.ok(child.bottom<=dimensions.toolbar.bottom+1);}
  await page.screenshot({path:path.join(root,'03-narrow.png')});checks.push('窄窗口工具栏无横向溢出，操作按钮完整可见');
  await page.getByRole('button',{name:'进入专注模式'}).click();await page.screenshot({path:path.join(root,'04-focus.png')});
  await page.getByRole('button',{name:'退出专注模式'}).click();
  await page.getByRole('button',{name:'更多记录操作',exact:true}).click();await page.getByRole('button',{name:'移到回收站',exact:true}).click();
  await page.getByRole('button',{name:'回收站',exact:true}).click();await page.locator('.note-card').first().click();await page.locator('.tiptap h2').waitFor();await selectText('.tiptap strong');
  await menuAction('复制为纯文本');await page.locator('.tiptap strong').click({button:'right'});await until(async()=>(await readClipboard()).text==='保留灵感');
  const readonlyMenu=await instance.evaluate(()=>globalThis.__menuItems);assert.equal(readonlyMenu.find(i=>i.label==='粘贴为纯文本').enabled,false);
  checks.push('回收站允许纯文本复制，禁止粘贴');
  assert.deepEqual(errors,[]);
  passed=true;
  console.log(JSON.stringify({passed:true,version:(await page.evaluate(()=>window.notes.info())).version,checks,screenshots:root},null,2));
}catch(error){console.error({completedChecks:checks,diagnostics});if(page&&!page.isClosed()){await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});console.error((await page.locator('body').innerText().catch(()=>'' )).slice(-2200));}throw error;}
finally{
  if(instance){await instance.evaluate(async({clipboard})=>{if(globalThis.__previousClipboard?.length)await clipboard.write(globalThis.__previousClipboard);else clipboard.clear();}).catch(()=>{});if(passed)await instance.close();else await instance.evaluate(({app})=>app.exit(0)).catch(()=>{});}
}
