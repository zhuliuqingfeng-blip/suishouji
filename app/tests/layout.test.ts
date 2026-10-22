import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_LAYOUT,fitPanels,normalizeLayout,rangeSelection} from '../src/layout.js';
import {fitWindow} from '../electron/window-state.js';
test('手记库使用整页，书写目录可收起和专注，窄窗口保留正文空间及偏好宽度',()=>{
 const p=normalizeLayout({...DEFAULT_LAYOUT,view:'document',indexHidden:false,indexWidth:520});const actual=fitPanels(p,904);
 assert.ok(904-actual.index-actual.handle>=400);assert.equal(p.indexWidth,520);
 assert.equal(fitPanels({...p,view:'library'},1260).index,0);assert.equal(fitPanels({...p,indexHidden:true},1260).index,0);
 assert.equal(DEFAULT_LAYOUT.view,'home');assert.deepEqual(fitPanels({...p,view:'home'},1260),{index:0,handle:0});assert.equal(normalizeLayout({view:'document',indexWidth:420}).indexWidth,420);
 assert.deepEqual(fitPanels({...p,focused:true},1260),{index:0,handle:0});assert.equal(normalizeLayout({indexWidth:999}).indexWidth,520);
 assert.equal(normalizeLayout({indexWidth:400}).libraryHeaderHeight,166);assert.equal(normalizeLayout({libraryHeaderHeight:0}).libraryHeaderHeight,56);assert.equal(normalizeLayout({libraryHeaderHeight:Infinity}).libraryHeaderHeight,166);
});
test('连续多选按当前顺序添加，普通选择可取消且不会重复',()=>{
 const range=rangeSelection(['a','b','c','d'],new Set(['a']),'c','a',true);assert.deepEqual([...range],['a','b','c']);
 assert.deepEqual([...rangeSelection(['a','b','c'],range,'b','a',false)],['a','c']);
});
test('窗口位置适配多显示器和断开的显示器，损坏设置使用可见默认值',()=>{
 const areas=[{x:0,y:0,width:1920,height:1040},{x:1920,y:0,width:1280,height:800}];
 const saved=fitWindow({x:2000,y:90,width:1260,height:850,maximized:true},areas);assert.equal(saved.x,1940);assert.equal(saved.height,800);assert.equal(saved.maximized,true);
 const lost=fitWindow({x:9000,y:-1000,width:2000,height:1200},[areas[0]]);assert.equal(lost.x,0);assert.equal(lost.y,0);assert.equal(lost.width,1920);
 const invalid=fitWindow({x:NaN,y:2,width:900,height:700},[{x:0,y:0,width:800,height:600}]);assert.equal(invalid.width,800);assert.equal(invalid.height,600);
});
