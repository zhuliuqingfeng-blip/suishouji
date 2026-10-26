import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {Editor} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {Schema,type Node} from '@tiptap/pm/model';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {history,undo,redo} from '@tiptap/pm/history';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ContinuousOrderedList,continuationPlugin,numberingChanges,previousNumberedList} from '../src/numbering.js';
import {Store} from '../electron/store.js';
import {createBackup,validateBackup,applyRestore,exportHtml} from '../electron/archive.js';
import {testRoot} from '../scripts/paths.mjs';

const schema=new Schema({nodes:{
  doc:{content:'block+'},paragraph:{group:'block',content:'text*'},text:{group:'inline'},
  heading:{group:'block',content:'text*'},blockquote:{group:'block',content:'block+'},
  orderedList:{group:'block',content:'listItem+',attrs:{start:{default:1},continuePrevious:{default:false},type:{default:null}}},
  bulletList:{group:'block',content:'listItem+'},listItem:{content:'paragraph block*'}
}});
const p=(text:string)=>schema.nodes.paragraph.create(null,text?schema.text(text):undefined);
const li=(text:string,extra:Node[]=[])=>schema.nodes.listItem.create(null,[p(text),...extra]);
const ol=(start:number,continuous:boolean,items:Node[])=>schema.nodes.orderedList.create({start,continuePrevious:continuous},items);
const doc=(nodes:Node[])=>schema.nodes.doc.create(null,nodes);
function starts(root:Node){const found:number[]=[];root.descendants(n=>{if(n.type.name==='orderedList')found.push(n.attrs.start);});return found;}
function normalized(root:Node){let state=EditorState.create({schema,doc:root});const tr=state.tr;for(const change of numberingChanges(root)){const n=tr.doc.nodeAt(change.pos)!;tr.setNodeMarkup(change.pos,undefined,{...n.attrs,start:change.start});}state=state.apply(tr);return state.doc;}

test('分散段落接续同层编号，正文、标题和独立重新开始的列表均保留',()=>{
  const original=doc([ol(1,false,[li('第一项'),li('第二项')]),p('中间说明'),schema.nodes.heading.create(null,schema.text('说明标题')),ol(1,true,[li('第三项')]),p('另一段说明'),ol(1,true,[li('第四项')]),ol(1,false,[li('新的第一项')]),p('新组说明'),ol(1,true,[li('新的第二项')])]);
  const next=normalized(original);assert.deepEqual(starts(next),[1,3,4,1,2]);assert.equal(next.child(1).textContent,'中间说明');assert.equal(next.child(2).type.name,'heading');assert.equal(next.textContent,original.textContent);
});
test('嵌套列表和引用的编号分别计算，不使用另一层级的序号',()=>{
  const original=doc([ol(1,false,[li('外层',[ol(5,false,[li('内层五')]),p('内层说明'),ol(1,true,[li('内层六')])])]),p('外层说明'),ol(1,true,[li('外层二')]),schema.nodes.blockquote.create(null,[ol(1,true,[li('引用内一')]),p('引用内说明'),ol(1,true,[li('引用内二')])])]);
  assert.deepEqual(starts(normalized(original)),[1,5,6,2,1,2]);
});
test('删除前面一组后从1接续，已有独立起始数字和手打数字不被重写',()=>{
  const original=doc([p('1.这只是手动输入的文字'),ol(9,false,[li('从九开始')]),p('说明'),ol(1,true,[li('接着十')])]);
  assert.deepEqual(starts(normalized(original)),[9,10]);assert.equal(normalized(original).firstChild!.textContent,'1.这只是手动输入的文字');
  assert.deepEqual(starts(normalized(doc([p('已删除前组'),ol(7,true,[li('剩下一组')])]))),[1]);
});
test('查找前一编号跨过正文和标题，但不会跨出当前父级',()=>{
  const original=doc([ol(4,false,[li('四'),li('五')]),p('说明'),p('待编号')]);
  const position=original.child(0).nodeSize+original.child(1).nodeSize+1;
  const state=EditorState.create({schema,doc:original,selection:TextSelection.create(original,position)});
  assert.equal(previousNumberedList(state)!.node.attrs.start,4);assert.equal(previousNumberedList(state)!.node.childCount,2);
  const nested=doc([ol(1,false,[li('外层')]),schema.nodes.blockquote.create(null,p('引用内段落'))]);
  const inside=EditorState.create({schema,doc:nested,selection:TextSelection.create(nested,nested.firstChild!.nodeSize+2)});
  assert.equal(previousNumberedList(inside),null);
});
test('前面增删项目自动更新后续编号，撤销和重做一次完成整组变化',()=>{
  const original=doc([ol(1,false,[li('甲')]),p('说明'),ol(2,true,[li('乙')])]);
  let state=EditorState.create({schema,doc:original,plugins:[history(),continuationPlugin()]});
  const apply=(tr:Parameters<EditorState['apply']>[0])=>{state=state.applyTransaction(tr).state;};
  apply(state.tr.insert(original.firstChild!.nodeSize-1,li('新增')));assert.deepEqual(starts(state.doc),[1,3]);
  assert.equal(undo(state,apply),true);assert.deepEqual(state.doc.toJSON(),original.toJSON());assert.equal(undo(state,apply),false);
  assert.equal(redo(state,apply),true);assert.deepEqual(starts(state.doc),[1,3]);
});

const editors:Editor[]=[];
afterEach(()=>{for(const editor of editors.splice(0))editor.destroy();});
function commandEditor(original:Node,first:string,last=first){
  const editor=new Editor({element:null,injectCSS:false,extensions:[StarterKit.configure({orderedList:false,link:false,dropcursor:false,gapcursor:false,trailingNode:false}),ContinuousOrderedList],content:original.toJSON()});
  editors.push(editor);editor.view.updateState(editor.state.reconfigure({plugins:editor.extensionManager.plugins}));
  let from=0,to=0;
  editor.state.doc.descendants((node,pos)=>{if(node.type.name==='paragraph'){if(node.textContent===first)from=pos+1;if(node.textContent===last)to=pos+1+node.content.size;}});
  assert.ok(from&&to,'测试段落必须存在');
  editor.commands.setTextSelection({from,to});return editor;
}
function lifted(original:Node,first:string,last=first){
  const editor=commandEditor(original,first,last);
  assert.equal(editor.commands.liftListItem('listItem'),true);
  return {get state(){return editor.state;},undo:()=>editor.commands.undo(),redo:()=>editor.commands.redo()};
}
test('取消中间项只接续原列表拆出的后半组，保留自定义起点和已有独立列表',()=>{
  for(const start of [1,7]){
    const original=doc([ol(start,false,[li('甲'),li('乙'),li('丙')]),p('说明'),ol(start+3,true,[li('丁')]),p('另一组'),ol(1,false,[li('独立一')]),p('说明'),ol(2,true,[li('独立二')])]);
    const result=lifted(original,'乙');assert.deepEqual(starts(result.state.doc),[start,start+1,start+2,1,2]);assert.equal(result.state.doc.textContent,original.textContent);
    assert.deepEqual(result.state.doc.content.content.filter(n=>n.type.name==='orderedList').map(n=>n.attrs.continuePrevious),[false,true,true,false,true]);
    assert.equal(result.undo(),true);assert.deepEqual(result.state.doc.toJSON(),original.toJSON());assert.equal(result.redo(),true);assert.deepEqual(starts(result.state.doc),[start,start+1,start+2,1,2]);
  }
});
test('取消连续多个中间项，已接续列表及引用内部也维持同层编号',()=>{
  const multiple=doc([ol(1,false,['甲','乙','丙','丁','戊'].map(t=>li(t))),p('说明'),ol(6,true,[li('己')])]);
  const result=lifted(multiple,'乙','丙');assert.deepEqual(starts(result.state.doc),[1,2,4]);assert.equal(result.state.doc.textContent,multiple.textContent);
  const continued=doc([ol(5,false,[li('前五'),li('前六')]),p('说明'),ol(7,true,[li('甲'),li('乙'),li('丙')]),p('说明'),ol(10,true,[li('丁')])]);
  assert.deepEqual(starts(lifted(continued,'乙').state.doc),[5,7,8,9]);
  const quoted=doc([schema.nodes.blockquote.create(null,[ol(3,false,[li('甲'),li('乙'),li('丙')]),p('说明'),ol(6,true,[li('丁')])])]);
  assert.deepEqual(starts(lifted(quoted,'乙').state.doc),[3,4,5]);
});
test('取消首尾项不改变独立起点；嵌套提级后不跨不同父级建立接续',()=>{
  const original=doc([ol(7,false,[li('甲'),li('乙'),li('丙')]),p('说明'),ol(10,true,[li('丁')])]);
  for(const selected of ['甲','丙']){
    const result=lifted(original,selected);assert.deepEqual(starts(result.state.doc),[7,9]);assert.equal(result.state.doc.firstChild!.type.name,selected==='甲'?'paragraph':'orderedList');
    const lists=result.state.doc.content.content.filter(n=>n.type.name==='orderedList');assert.equal(lists[0].attrs.continuePrevious,false);
  }
  const nested=doc([ol(30,false,[li('外层',[ol(7,false,[li('甲'),li('乙'),li('丙')])])])]);
  const result=lifted(nested,'乙'),inner:Node[]=[];result.state.doc.descendants(node=>{if(node.type.name==='orderedList'&&node.attrs.start===7)inner.push(node);});
  assert.equal(inner.length,2);assert.ok(inner.every(n=>n.attrs.continuePrevious===false));assert.equal(result.state.doc.textContent,nested.textContent);
});

test('直接提级与链式命令共用接续逻辑；能力检查和只读状态不修改正文',()=>{
  const original=doc([ol(7,false,[li('甲'),li('乙'),li('丙')]),p('说明'),ol(10,true,[li('丁')])]);
  const editor=commandEditor(original,'乙'),before=editor.getJSON();
  assert.equal(editor.can().liftListItem('listItem'),true);assert.deepEqual(editor.getJSON(),before);
  assert.equal(editor.chain().setTextSelection(editor.state.selection.from).liftListItem('listItem').run(),true);
  assert.deepEqual(starts(editor.state.doc),[7,8,9]);assert.equal(editor.state.doc.textContent,original.textContent);
  assert.equal(editor.commands.undo(),true);assert.deepEqual(editor.getJSON(),before);
  editor.setEditable(false,false);assert.equal(editor.can().liftListItem('listItem'),false);assert.equal(editor.commands.liftListItem('listItem'),false);assert.deepEqual(editor.getJSON(),before);
});

test('空列表项回车使用的提级命令也保留后半组接续关系',()=>{
  const original=doc([ol(7,false,[li('甲'),li(''),li('丙')]),p('说明'),ol(10,true,[li('丁')])]);
  const editor=commandEditor(original,''),before=editor.getJSON();
  assert.equal(editor.commands.liftEmptyBlock(),true);assert.deepEqual(starts(editor.state.doc),[7,8,9]);assert.equal(editor.state.doc.textContent,original.textContent);
  assert.equal(editor.commands.undo(),true);assert.deepEqual(editor.getJSON(),before);
});
test('读取旧文档不自动改写存储；存档、完整备份和HTML导出保留接续后的数字',async()=>{
  await fs.mkdir(testRoot,{recursive:true});const root=await fs.mkdtemp(path.join(testRoot,'numbering-')),store=new Store(root),note=store.create().note;
  const original=doc([ol(1,false,[li('第一节')]),p('未编号说明'),ol(2,true,[li('第二节')]),p('未编号说明'),ol(3,true,[li('第三节')])]).toJSON();
  store.save({...note,document:original});const saved=store.get(note.id).note.document;assert.equal(saved.content![2].attrs!.continuePrevious,true);
  const backup=path.join(root,'完整备份.zip');await createBackup(store,backup);store.save({...note,document:{type:'doc',content:[{type:'paragraph'}]}});
  const checked=await validateBackup(backup);applyRestore(store,checked.stage);await fs.rm(checked.stage,{recursive:true,force:true});assert.deepEqual(store.get(note.id).note.document,saved);
  const out=path.join(root,'HTML');await exportHtml(store,out);const html=await fs.readFile(path.join(out,note.id+'.html'),'utf8');assert.match(html,/<ol start="2">/);assert.match(html,/<ol start="3">/);
  const legacy=JSON.stringify({type:'doc',content:[{type:'orderedList',attrs:{start:7},content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'旧内容'}]}]}]}]});store.db.prepare('UPDATE notes SET document=? WHERE id=?').run(legacy,note.id);store.close();
  const reopened=new Store(root);assert.equal(reopened.db.prepare('SELECT document FROM notes WHERE id=?').get(note.id)!.document,legacy);reopened.get(note.id);assert.equal(reopened.db.prepare('SELECT document FROM notes WHERE id=?').get(note.id)!.document,legacy);reopened.close();
});
