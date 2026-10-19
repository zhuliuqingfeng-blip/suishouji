import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_LAYOUT,fitPanels,normalizeLayout,rangeSelection} from '../src/layout.js';
import {fitWindow} from '../electron/window-state.js';
test('窄窗口保留正文空间，折叠和专注不丢失用户宽度',()=>{
 const p=normalizeLayout({...DEFAULT_LAYOUT,navWidth:300,listWidth:480});const actual=fitPanels(p,904);
 assert.ok(904-actual.nav-actual.list-actual.navHandle-actual.listHandle>=400);assert.equal(p.listWidth,480);
 assert.equal(fitPanels({...p,navCollapsed:true},1260).nav,64);assert.equal(fitPanels({...p,listHidden:true},1260).list,0);
 assert.deepEqual(fitPanels({...p,focused:true},1260),{nav:0,list:0,navHandle:0,listHandle:0});assert.equal(normalizeLayout({navWidth:10,listWidth:999}).navWidth,180);
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
