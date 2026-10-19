import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import type { EditorView } from '@tiptap/pm/view';
import { insertPlainText, notePlainText, plainText } from '../src/plain-text.js';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' }, paragraph: { group: 'block', content: 'inline*' },
    heading: { group: 'block', content: 'inline*' },
    bulletList: { group: 'block', content: 'listItem+' }, listItem: { content: 'paragraph block*' },
    text: { group: 'inline' }, hardBreak: { group: 'inline', inline: true },
    image: { group: 'block', atom: true, attrs: { src: {} } }
  }, marks: { bold: {}, link: { attrs: { href: {} } } }
});
const p = (text: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);

test('纯文本提取保留中文、空行、列表与软换行，去掉样式、链接地址和图片', () => {
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.heading.create(null,schema.text('标题',[schema.marks.bold.create()])), p(''),
    schema.nodes.paragraph.create(null,[schema.text('网页',[schema.marks.link.create({href:'https://example.com'})]),schema.nodes.hardBreak.create(),schema.text('<标签> & 原文字')]),
    schema.nodes.image.create({src:'app-asset://media/private-image'}),
    schema.nodes.bulletList.create(null,[schema.nodes.listItem.create(null,p('第一项')),schema.nodes.listItem.create(null,p('第二项'))])
  ]);
  assert.equal(plainText(doc),'标题\n\n网页\n<标签> & 原文字\n第一项\n第二项');
  assert.equal(plainText(doc,1,2),'标');
  assert.equal(notePlainText('  我的标题  ',plainText(doc)),'我的标题\n\n'+plainText(doc));
  assert.equal(notePlainText('', '只有正文'),'只有正文');
});

test('纯文本粘贴替换选择，不继承加粗链接，保留空行和字面HTML并可一次撤销', () => {
  const original = schema.nodes.doc.create(null,[schema.nodes.paragraph.create(null,schema.text('前原文后',[schema.marks.bold.create(),schema.marks.link.create({href:'https://example.com'})])),p('保留的段落')]);
  let state = EditorState.create({schema,doc:original,selection:TextSelection.create(original,2,4),plugins:[history()]});
  const view = { get state(){return state;}, dispatch(tr: Parameters<EditorView['dispatch']>[0]){state=state.apply(tr);}, focus(){} } as EditorView;
  insertPlainText(view,'无格式\r\n\r\n<b>原样</b>\n');
  assert.equal(plainText(state.doc),'前无格式\n\n<b>原样</b>\n后\n保留的段落');
  const textNodes: {text:string;marks:number}[] = [];
  state.doc.descendants(n=>{if(n.isText)textNodes.push({text:n.text!,marks:n.marks.length});});
  assert.equal(textNodes.find(n=>n.text==='无格式')?.marks,0);
  assert.equal(textNodes.find(n=>n.text==='<b>原样</b>')?.marks,0);
  assert.equal(textNodes.find(n=>n.text==='前')?.marks,2);
  assert.equal(textNodes.find(n=>n.text==='后')?.marks,2);
  assert.deepEqual(state.storedMarks,[]);
  assert.equal(undo(state,tr=>{state=state.apply(tr);}),true);
  assert.deepEqual(state.doc.toJSON(),original.toJSON());
});

test('粘贴保留当前位置的标题或列表布局，不改变未选中的段落', () => {
  for (const block of [schema.nodes.heading.create(null,schema.text('标题')),schema.nodes.bulletList.create(null,schema.nodes.listItem.create(null,p('列表')))]) {
    const doc=schema.nodes.doc.create(null,[block,p('原段落')]);
    const cursor=block.type.name==='heading'?2:4;
    let state=EditorState.create({schema,doc,selection:TextSelection.create(doc,cursor)});
    const view={get state(){return state;},dispatch(tr:Parameters<EditorView['dispatch']>[0]){state=state.apply(tr);},focus(){}} as EditorView;
    insertPlainText(view,'插入文字');
    assert.equal(state.doc.firstChild?.type.name,block.type.name);
    assert.equal(state.doc.lastChild?.textContent,'原段落');
    assert.match(plainText(state.doc),/插入文字/);
    state.doc.check();
  }
});

test('粘贴与前后输入各自撤销，不会一次误撤销多项操作', () => {
  let state=EditorState.create({schema,doc:schema.nodes.doc.create(null,p('')),plugins:[history()]});
  const dispatch=(tr:Parameters<EditorView['dispatch']>[0])=>{state=state.apply(tr);};
  const view={get state(){return state;},dispatch,focus(){}} as EditorView;
  dispatch(state.tr.insertText('刚输入'));
  insertPlainText(view,'粘贴');
  dispatch(state.tr.insertText('接着输入'));
  undo(state,dispatch);assert.equal(plainText(state.doc),'刚输入粘贴');
  undo(state,dispatch);assert.equal(plainText(state.doc),'刚输入');
  undo(state,dispatch);assert.equal(plainText(state.doc),'');
});
