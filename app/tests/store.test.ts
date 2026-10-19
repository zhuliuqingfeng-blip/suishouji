import {testRoot} from '../scripts/paths.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Store, sha256 } from '../electron/store.js';
import { createBackup, validateBackup, applyRestore, exportHtml, zipFiles, recoverInterruptedRestore } from '../electron/archive.js';

async function fixture() { const root = await fs.mkdtemp(path.join(testRoot,'data-')); return { root, store: new Store(root) }; }
await fs.mkdir(testRoot, { recursive: true });
test('中文图文、搜索、标签、置顶、回收站及关闭后持久化', async () => {
  const { root, store } = await fixture();
  const a = store.create().note, b = store.create().note;
  store.save({ ...a, title: '', tags: ['工作','工作'], document: { type:'doc', content:[{type:'paragraph',content:[{type:'text',text:'中文输入：明天整理 FPGA 资料'}]}] } });
  assert.equal(store.list({ query:'fpga' }).length,1); assert.equal(store.list({ tag:'工作' }).length,1); assert.deepEqual(store.get(a.id).note.tags,['工作']);
  store.pin(a.id,true); assert.equal(store.list()[0].id,a.id);
  store.trash(a.id); assert.equal(store.list().length,1); assert.equal(store.list({trash:true})[0].id,a.id);
  assert.throws(() => store.remove(b.id)); store.restore(a.id); store.close();
  const reopened = new Store(root); assert.match(reopened.get(a.id).note.plainText,/明天/); assert.equal(reopened.get(a.id).note.pinned,true);
  reopened.trash(a.id); reopened.remove(a.id); assert.equal(reopened.overview().active,1); reopened.close();
});
test('附件保存独立副本，整套数据换位置后图片与附件有效', async () => {
  const { root, store } = await fixture(); const note = store.create().note;
  const source = path.join(root,'原始资料.txt'); await fs.writeFile(source,'原文件内容'); const file = store.addFile(note.id,source); await fs.rm(source);
  const image = store.addImage(note.id,new Uint8Array([1,2,3]),'image/png');
  store.save({ ...note, document:{type:'doc',content:[{type:'image',attrs:{assetId:image.id,src:'https://tracking.example/pixel'}}]},tags:[] });
  assert.match(store.get(note.id).note.document.content![0].attrs!.src as string,/^app-asset:/);
  assert.equal(store.list({query:'原始资料'}).length,1); assert.equal(await fs.readFile(store.assetPath(file),'utf8'),'原文件内容');
  store.close(); const moved = `${root}-moved`; await fs.rename(root,moved); const next = new Store(moved);
  assert.equal(await fs.readFile(next.assetPath(next.attachment(file.id)),'utf8'),'原文件内容'); assert.equal((await fs.stat(next.assetPath(next.attachment(image.id)))).size,3); next.close();
});
test('完整备份恢复包含回收站和附件，损坏或路径异常的备份不影响当前数据', async () => {
  const { root, store } = await fixture(); const note = store.create().note; const deleted = store.create().note;
  store.save({...note,title:'备份前',tags:['生活']}); store.addImage(note.id,new Uint8Array([1,2,3]),'image/png'); store.trash(deleted.id);
  const zip = path.join(root,'完整备份.zip'); await createBackup(store,zip);
  store.save({...store.get(note.id).note,title:'备份后修改'});
  const validation = await validateBackup(zip); assert.equal(validation.count,2); applyRestore(store,validation.stage); await fs.rm(validation.stage,{recursive:true,force:true});
  assert.equal(store.get(note.id).note.title,'备份前'); assert.equal(store.overview().trash,1); assert.equal(store.allAssets().length,1);
  const broken = path.join(root,'损坏.zip'); const bytes = await fs.readFile(zip); await fs.writeFile(broken,bytes.subarray(0,bytes.length-20));
  await assert.rejects(validateBackup(broken)); assert.equal(store.get(note.id).note.title,'备份前');
  const bad = path.join(root,'异常.zip'); await zipFiles([{source:store.databasePath,name:'unexpected.txt'}],bad); await assert.rejects(validateBackup(bad));
  assert.equal(store.overview().active,1); store.close();
});
test('HTML导出保留图文和文件，标题中的HTML被转义', async () => {
  const { root, store } = await fixture(); const n = store.create().note;
  const a = store.addImage(n.id,new Uint8Array([5,6,7]),'image/png');
  store.save({...n,title:'<script>不执行</script>',tags:[],document:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'本地正文'}]},{type:'image',attrs:{assetId:a.id}}]}});
  const out = path.join(root,'导出'); await exportHtml(store,out);
  const html = await fs.readFile(path.join(out,`${n.id}.html`),'utf8'); assert.match(html,/&lt;script&gt;/); assert.match(html,/本地正文/); assert.match(html,/附件\//); assert.ok(!html.includes('app-asset:'));
  await fs.access(path.join(out,'打开我的记录.html')); store.close();
});
test('中断的恢复在下次启动前回滚到原始数据', async () => {
  const { root, store } = await fixture(); const n = store.create().note; store.save({...n,title:'应当保留'}); store.close();
  const old = path.join(root,'.restore-old'); await fs.mkdir(old); await fs.rename(path.join(root,'notes.sqlite'),path.join(old,'notes.sqlite'));
  await fs.writeFile(path.join(root,'notes.sqlite'),'未完成替换'); await fs.writeFile(path.join(root,'.restore-state.json'),JSON.stringify({committed:false,moved:['notes.sqlite'],installed:['notes.sqlite']}));
  recoverInterruptedRestore(root); const next = new Store(root); assert.equal(next.get(n.id).note.title,'应当保留'); next.close();
});
test('保存失败保留上次数据；内容被篡改的备份无法通过校验', async () => {
  const {root,store}=await fixture();const note=store.create().note;store.save({...note,title:'原有内容'});
  assert.throws(()=>store.save({...note,title:'长'.repeat(301)}));assert.equal(store.get(note.id).note.title,'原有内容');
  const fake=path.join(root,'假备份');await fs.mkdir(fake);store.snapshot(path.join(fake,'notes.sqlite'));
  const dbFile=path.join(fake,'notes.sqlite');const size=(await fs.stat(dbFile)).size;const checksum=await sha256(dbFile);
  await fs.writeFile(path.join(fake,'manifest.json'),JSON.stringify({format:'suishouji-backup',version:1,createdAt:new Date().toISOString(),files:[{path:'notes.sqlite',size,sha256:checksum}]}));
  await fs.appendFile(dbFile,'篡改');const zip=path.join(root,'清单与内容不符.zip');
  await zipFiles([{source:dbFile,name:'notes.sqlite'},{source:path.join(fake,'manifest.json'),name:'manifest.json'}],zip);
  await assert.rejects(validateBackup(zip),/校验失败/);assert.equal(store.get(note.id).note.title,'原有内容');store.close();
});
test('批量附件中某个文件失败时，整批回滚并清理已复制文件', async () => {
  const {root,store}=await fixture();const n=store.create().note;const source=path.join(root,'正常文件.txt');await fs.writeFile(source,'资料');
  assert.throws(()=>store.addFiles(n.id,[source,path.join(root,'不存在.txt')]));
  assert.equal(store.get(n.id).attachments.length,0);assert.equal((await fs.readdir(path.join(root,'attachments'))).length,0);store.close();
});
