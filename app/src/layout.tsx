import { useEffect,useLayoutEffect,useRef,useState,type CSSProperties,type RefObject } from 'react';
export const LIBRARY_HEADER={min:56,max:240,default:166,compactBelow:110,listMin:160};
export interface LayoutPreferences { view:'home'|'library'|'document'|'days';indexWidth:number;indexHidden:boolean;filtersCollapsed:boolean;focused:boolean;libraryHeaderHeight:number }
const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n));
export const DEFAULT_LAYOUT:LayoutPreferences={view:'home',indexWidth:350,indexHidden:true,filtersCollapsed:false,focused:false,libraryHeaderHeight:LIBRARY_HEADER.default};
export function normalizeLayout(input:Partial<LayoutPreferences>|null):LayoutPreferences {
  const p=input??{};return {view:p.view==='document'?'document':p.view==='library'?'library':p.view==='days'?'days':'home',indexWidth:clamp(Number(p.indexWidth)||350,280,520),indexHidden:p.indexHidden!==false,filtersCollapsed:p.filtersCollapsed===true,focused:p.focused===true,libraryHeaderHeight:typeof p.libraryHeaderHeight==='number'&&Number.isFinite(p.libraryHeaderHeight)?clamp(p.libraryHeaderHeight,LIBRARY_HEADER.min,LIBRARY_HEADER.max):LIBRARY_HEADER.default};
}
export function fitPanels(p:LayoutPreferences,width:number){
  const index=p.view==='document'&&!p.indexHidden&&!p.focused?Math.min(p.indexWidth,Math.max(280,width-448)):0;
  return {index,handle:index?8:0};
}
export function usePanels(){
  const [preferences,setPreferences]=useState(()=>{try{return {...normalizeLayout(JSON.parse(localStorage.getItem('suishouji:workspace:v2')??'null')),view:'home' as const,focused:false};}catch{return {...DEFAULT_LAYOUT};}});
  const [width,setWidth]=useState(window.innerWidth);
  useEffect(()=>{const resize=()=>setWidth(window.innerWidth);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
  useEffect(()=>{try{localStorage.setItem('suishouji:workspace:v2',JSON.stringify(preferences));}catch{}},[preferences]);
  const sizes=fitPanels(preferences,width);
  const style:CSSProperties={'--index-width':`${sizes.index}px`,'--index-handle':`${sizes.handle}px`,'--library-header-height':`${preferences.libraryHeaderHeight}px`} as CSSProperties;
  return {preferences,setPreferences,sizes,style};
}
export function Splitter({name,value,min,max,reset,hidden,onChange,orientation='vertical',className='',getValue}:{name:string;value:number;min:number;max:number;reset:number;hidden:boolean;onChange:(n:number)=>void;orientation?:'vertical'|'horizontal';className?:string;getValue?:()=>number}){
  const horizontal=orientation==='horizontal';
  const drag=useRef<{x:number;value:number}|null>(null),[active,setActive]=useState(false);
  return <div className={`splitter ${className} ${active?'dragging':''}`} role="separator" aria-label={name} aria-orientation={orientation} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} hidden={hidden} tabIndex={hidden?-1:0}
    onDoubleClick={()=>onChange(reset)} title={horizontal?'上下拖动调整顶部高度，双击恢复默认；也可按上下方向键':'拖动调整宽度，双击恢复默认'}
    onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();drag.current={x:horizontal?e.clientY:e.clientX,value:getValue?.()??value};e.currentTarget.setPointerCapture(e.pointerId);setActive(true);}}
    onPointerMove={e=>{if(drag.current)onChange(clamp(drag.current.value+(horizontal?e.clientY:e.clientX)-drag.current.x,min,max));}}
    onPointerUp={e=>{drag.current=null;setActive(false);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
    onLostPointerCapture={()=>{drag.current=null;setActive(false);}}
    onKeyDown={e=>{const decrease=horizontal?'ArrowUp':'ArrowLeft',increase=horizontal?'ArrowDown':'ArrowRight';if([decrease,increase,'Home','End'].includes(e.key)){e.preventDefault();onChange(e.key==='Home'?min:e.key==='End'?max:clamp((getValue?.()??value)+(e.key===decrease?-10:10),min,max));}}}/>;
}
export function LibraryHeightSplitter({heading,list,onChange}:{heading:RefObject<HTMLDivElement|null>;list:RefObject<HTMLDivElement|null>;onChange:(n:number)=>void}){
  const [metrics,setMetrics]=useState({value:LIBRARY_HEADER.default,max:LIBRARY_HEADER.max});
  useLayoutEffect(()=>{
    const top=heading.current,rows=list.current;if(!top||!rows)return;
    const measure=()=>{const value=Math.round(top.getBoundingClientRect().height),max=clamp(Math.floor(value+rows.getBoundingClientRect().height-LIBRARY_HEADER.listMin),LIBRARY_HEADER.min,LIBRARY_HEADER.max);setMetrics(previous=>previous.value===value&&previous.max===max?previous:{value,max});};
    const observer=new ResizeObserver(measure);observer.observe(top);observer.observe(rows);measure();return()=>observer.disconnect();
  },[heading,list]);
  return <Splitter name="手记库顶部高度" className="library-height-splitter" orientation="horizontal" value={metrics.value} min={LIBRARY_HEADER.min} max={metrics.max} reset={LIBRARY_HEADER.default} hidden={false} onChange={onChange} getValue={()=>Math.round(heading.current?.getBoundingClientRect().height??metrics.value)}/>;
}
export function rangeSelection(ids:string[],selected:Set<string>,id:string,anchor:string|null,range:boolean){
  const next=new Set(selected),at=ids.indexOf(id),from=anchor?ids.indexOf(anchor):-1;
  if(range&&from>=0&&at>=0)for(const item of ids.slice(Math.min(from,at),Math.max(from,at)+1))next.add(item);
  else if(next.has(id))next.delete(id);else next.add(id);
  return next;
}
