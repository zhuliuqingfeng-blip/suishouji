import fs from 'node:fs';
export interface Bounds { x:number;y:number;width:number;height:number }
export interface WindowState extends Bounds { maximized:boolean }
export function fitWindow(saved:Partial<WindowState>|null,areas:Bounds[]):WindowState {
  const primary=areas[0]??{x:0,y:0,width:1280,height:900};
  const valid=saved&&['x','y','width','height'].every(k=>typeof saved[k as keyof Bounds]==='number'&&Number.isFinite(saved[k as keyof Bounds]));
  const current=valid?saved as WindowState:null;
  const intersect=(a:Bounds,b:Bounds)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  const area=current?[...areas].sort((a,b)=>intersect(current,b)-intersect(current,a))[0]??primary:primary;
  const width=Math.min(area.width,Math.max(Math.min(920,area.width),current?.width??1260));
  const height=Math.min(area.height,Math.max(Math.min(650,area.height),current?.height??850));
  return {width,height,x:Math.max(area.x,Math.min(current?.x??area.x+(area.width-width)/2,area.x+area.width-width)),y:Math.max(area.y,Math.min(current?.y??area.y+(area.height-height)/2,area.y+area.height-height)),maximized:!!current?.maximized};
}
export function readWindowState(file:string):Partial<WindowState>|null {try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
export function writeWindowState(file:string,state:WindowState){try{fs.writeFileSync(file+'.tmp',JSON.stringify(state));fs.renameSync(file+'.tmp',file);}catch{/* Optional preferences must not prevent saving notes or exiting. */}}
