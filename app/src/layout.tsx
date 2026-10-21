import { useEffect,useRef,useState,type CSSProperties } from 'react';
export interface LayoutPreferences { view:'library'|'document';indexWidth:number;indexHidden:boolean;filtersCollapsed:boolean;focused:boolean }
const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n));
export const DEFAULT_LAYOUT:LayoutPreferences={view:'library',indexWidth:350,indexHidden:true,filtersCollapsed:false,focused:false};
export function normalizeLayout(input:Partial<LayoutPreferences>|null):LayoutPreferences {
  const p=input??{};return {view:p.view==='document'?'document':'library',indexWidth:clamp(Number(p.indexWidth)||350,280,520),indexHidden:p.indexHidden!==false,filtersCollapsed:p.filtersCollapsed===true,focused:p.focused===true};
}
export function fitPanels(p:LayoutPreferences,width:number){
  const index=p.view==='document'&&!p.indexHidden&&!p.focused?Math.min(p.indexWidth,Math.max(280,width-448)):0;
  return {index,handle:index?8:0};
}
export function usePanels(){
  const [preferences,setPreferences]=useState(()=>{try{return normalizeLayout(JSON.parse(localStorage.getItem('suishouji:workspace:v2')??'null'));}catch{return {...DEFAULT_LAYOUT};}});
  const [width,setWidth]=useState(window.innerWidth);
  useEffect(()=>{const resize=()=>setWidth(window.innerWidth);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
  useEffect(()=>{try{localStorage.setItem('suishouji:workspace:v2',JSON.stringify(preferences));}catch{}},[preferences]);
  const sizes=fitPanels(preferences,width);
  const style:CSSProperties={'--index-width':`${sizes.index}px`,'--index-handle':`${sizes.handle}px`} as CSSProperties;
  return {preferences,setPreferences,sizes,style};
}
export function Splitter({name,value,min,max,reset,hidden,onChange}:{name:string;value:number;min:number;max:number;reset:number;hidden:boolean;onChange:(n:number)=>void}){
  const drag=useRef<{x:number;value:number}|null>(null),[active,setActive]=useState(false);
  return <div className={`splitter ${active?'dragging':''}`} role="separator" aria-label={name} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} hidden={hidden} tabIndex={hidden?-1:0}
    onDoubleClick={()=>onChange(reset)} title="拖动调整宽度，双击恢复默认"
    onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();drag.current={x:e.clientX,value};e.currentTarget.setPointerCapture(e.pointerId);setActive(true);}}
    onPointerMove={e=>{if(drag.current)onChange(clamp(drag.current.value+e.clientX-drag.current.x,min,max));}}
    onPointerUp={e=>{drag.current=null;setActive(false);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
    onLostPointerCapture={()=>{drag.current=null;setActive(false);}}
    onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();onChange(e.key==='Home'?min:e.key==='End'?max:clamp(value+(e.key==='ArrowLeft'?-10:10),min,max));}}}/>;
}
export function rangeSelection(ids:string[],selected:Set<string>,id:string,anchor:string|null,range:boolean){
  const next=new Set(selected),at=ids.indexOf(id),from=anchor?ids.indexOf(anchor):-1;
  if(range&&from>=0&&at>=0)for(const item of ids.slice(Math.min(from,at),Math.max(from,at)+1))next.add(item);
  else if(next.has(id))next.delete(id);else next.add(id);
  return next;
}
