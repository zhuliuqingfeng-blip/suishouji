import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {NoteSummary} from '../electron/shared.js';
import {friendlyTime,homeSnapshot,noteTitle} from '../src/home-model.js';

const now=new Date(2026,9,22,12);
const note=(id:string,date:Date,extra:Partial<NoteSummary>={}):NoteSummary=>({id,title:id,plainText:'正文',tags:[],pinned:false,deletedAt:null,createdAt:date.toISOString(),updatedAt:date.toISOString(),attachmentCount:0,...extra});

test('首页最近更新不受置顶及输入列表顺序影响，最多展示三条',()=>{
  const rows=[note('old',new Date(2026,8,1),{pinned:true}),note('second',new Date(2026,9,21)),note('newest',new Date(2026,9,22,10)),note('third',new Date(2026,9,20))];
  assert.deepEqual(homeSnapshot(rows,'old',now).recent.map(n=>n.id),['newest','second','third']);
  assert.equal(homeSnapshot(rows,'old',now).resume?.id,'old');assert.equal(rows[0].id,'old');
});
test('七日统计按本地日历包含今天及前六天，排除回收站、未来及无效时间',()=>{
  const rows=[note('start',new Date(2026,9,16)),note('before',new Date(2026,9,15,23,59,59)),note('today',now),note('future',new Date(2026,9,22,13)),note('trash',now,{deletedAt:now.toISOString()}),note('invalid',now,{updatedAt:'invalid'})];
  const snapshot=homeSnapshot(rows,'trash',now);assert.equal(snapshot.updatedThisWeek,2);assert.equal(snapshot.total,5);assert.equal(snapshot.resume,null);
  assert.equal(homeSnapshot(rows,'removed',now).resume,null);assert.deepEqual(homeSnapshot([],null,now).recent,[]);
});
test('继续上次只采用有效记录编号，不把排序第一条冒充上次内容',()=>{
  const rows=[note('first',now)];assert.equal(homeSnapshot(rows,null,now).resume,null);assert.equal(homeSnapshot(rows,'missing',now).resume,null);
  assert.equal(noteTitle({...rows[0],title:' ',plainText:'首行标题\n正文'}),'首行标题');assert.equal(noteTitle({title:'',plainText:''}),'未命名记录');
});
test('状态时间区分今天、昨天和跨年，不把未知时间显示为正常备份',()=>{
  assert.match(friendlyTime(new Date(2026,9,22,9,8).toISOString(),now),/^今天 09:08$/);
  assert.match(friendlyTime(new Date(2026,9,22,12,0,3).toISOString(),now),/^今天 12:00$/);
  assert.match(friendlyTime(new Date(2026,9,21,23,1).toISOString(),now),/^昨天 23:01$/);
  assert.match(friendlyTime(new Date(2025,9,1).toISOString(),now),/2025/);assert.equal(friendlyTime('invalid',now),'时间未知');
});
