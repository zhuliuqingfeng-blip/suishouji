import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../electron/store.js';
import {testRoot} from '../scripts/paths.mjs';
await fs.mkdir(testRoot,{recursive:true});
async function fixture(){const root=await fs.mkdtemp(path.join(testRoot,'batch-'));return {root,store:new Store(root)};}
test('批量删除事务遇到中途错误时全部回滚，恢复也先校验整批状态',async()=>{
 const {store}=await fixture();const a=store.create().note,b=store.create().note;
 store.db.exec(`CREATE TRIGGER stop_batch BEFORE UPDATE OF deletedAt ON notes WHEN NEW.id='${b.id}' BEGIN SELECT RAISE(ABORT,'模拟写入失败'); END;`);
 assert.throws(()=>store.trashMany([a.id,b.id]),/模拟/);assert.equal(store.overview().trash,0);
 store.db.exec('DROP TRIGGER stop_batch');store.trashMany([a.id,b.id]);store.restore(a.id);
 assert.throws(()=>store.restoreMany([b.id,a.id]));assert.ok(store.get(b.id).note.deletedAt);store.close();
});
test('撤销只恢复本次删除中未再次变化的记录，并且有十秒期限',async()=>{
 const {store}=await fixture();const a=store.create().note,b=store.create().note,c=store.create().note;
 store.trash(c.id);const result=store.trashMany([a.id,a.id,b.id]);assert.equal(result.succeeded.length,2);
 store.restore(a.id);store.trash(a.id);
 const undone=store.undoDelete(result.undo!.token);assert.deepEqual(undone.succeeded,[b.id]);assert.ok(store.get(a.id).note.deletedAt);assert.ok(store.get(c.id).note.deletedAt);
 const expires=store.trashMany([b.id]);const original=Date.now;try{Date.now=()=>original()+11000;assert.throws(()=>store.undoDelete(expires.undo!.token),/撤销时间/);}finally{Date.now=original;}
 store.close();
});
test('永久删除逐项报告，失败项附件完整且可重试',async()=>{
 const {store}=await fixture();const a=store.create().note,b=store.create().note;
 const attachment=store.addImage(b.id,new Uint8Array([1,2,3]),'image/png');store.trashMany([a.id,b.id]);
 store.db.exec(`CREATE TRIGGER stop_remove BEFORE DELETE ON notes WHEN OLD.id='${b.id}' BEGIN SELECT RAISE(ABORT,'模拟删除失败'); END;`);
 const result=store.removeMany([a.id,b.id]);assert.deepEqual(result.succeeded,[a.id]);assert.equal(result.failed[0].id,b.id);await fs.access(store.assetPath(attachment));assert.ok(store.get(b.id).note.deletedAt);
 store.db.exec('DROP TRIGGER stop_remove');assert.equal(store.removeMany([b.id]).succeeded.length,1);assert.equal(store.overview().trash,0);store.close();
});
test('删除过程意外中断后，未提交的附件恢复，已提交的暂存附件清理',async()=>{
 const {root,store}=await fixture();const n=store.create().note;const attachment=store.addImage(n.id,new Uint8Array([4]),'image/png');store.trash(n.id);
 const stage=path.join(root,'.delete-pending',n.id);await fs.mkdir(stage,{recursive:true});await fs.rename(store.assetPath(attachment),path.join(stage,path.basename(attachment.relativePath)));store.close();
 const reopened=new Store(root);await fs.access(reopened.assetPath(attachment));
 await fs.mkdir(stage,{recursive:true});await fs.rename(reopened.assetPath(attachment),path.join(stage,path.basename(attachment.relativePath)));reopened.db.prepare('DELETE FROM notes WHERE id=?').run(n.id);reopened.close();
 const next=new Store(root);await assert.rejects(fs.access(stage));assert.equal(next.overview().trash,0);next.close();
});
test('排序支持修改时间、创建时间、中文标题，置顶始终优先',async()=>{
 const {store}=await fixture();const a=store.create().note,b=store.create().note,c=store.create().note;
 for(const [n,title,created,updated] of [[a,'苹果','2020-01-01','2022-01-01'],[b,'香蕉','2021-01-01','2020-01-01'],[c,'置顶','2019-01-01','2019-01-01']] as const){store.save({...n,title});store.db.prepare('UPDATE notes SET createdAt=?,updatedAt=? WHERE id=?').run(created,updated,n.id);}
 store.pin(c.id,true);assert.deepEqual(store.list({sort:'updated'}).map(n=>n.id),[c.id,a.id,b.id]);assert.deepEqual(store.list({sort:'created'}).map(n=>n.id),[c.id,b.id,a.id]);assert.deepEqual(store.list({sort:'title'}).map(n=>n.id),[c.id,a.id,b.id]);store.close();
});
