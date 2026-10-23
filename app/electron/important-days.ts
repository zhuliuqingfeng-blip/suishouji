import type {DayReminder, ImportantDay, ImportantDayInput} from './shared.js';

// Calendar arithmetic uses civil dates, never elapsed local hours (DST / sleep).
export function civilNumber(year:number,month:number,day:number):number {
  const date=new Date(0);date.setUTCFullYear(year,month-1,day);date.setUTCHours(0,0,0,0);return date.getTime()/86400000;
}
export function localDay(now=new Date()):number {return civilNumber(now.getFullYear(),now.getMonth()+1,now.getDate());}
export function daysInMonth(year:number,month:number):number {
  return civilNumber(month===12?year+1:year,month===12?1:month+1,1)-civilNumber(year,month,1);
}
export function validateImportantDay(input:ImportantDayInput):ImportantDayInput {
  if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>100)throw new Error('请填写名称，最多100字');
  if(input.calendar!=='solar')throw new Error('当前版本支持公历日期');
  if(typeof input.yearly!=='boolean')throw new Error('请选择是否每年重复');
  const year=input.year;
  if(year!==null&&(!Number.isInteger(year)||year<1||year>9999))throw new Error('年份请填写1至9999之间的整数，或留空');
  if(!input.yearly&&year===null)throw new Error('不重复的日子需要填写年份');
  if(!Number.isInteger(input.month)||input.month<1||input.month>12||!Number.isInteger(input.day)||input.day<1||input.day>daysInMonth(year??2000,input.month))throw new Error('请填写有效的公历日期');
  if(!Number.isInteger(input.reminderDays)||input.reminderDays<0||input.reminderDays>365)throw new Error('提前提醒请填写0至365之间的整数天数');
  if(typeof input.note!=='string'||input.note.length>3000)throw new Error('备注最多3000字');
  return {name:input.name.trim(),calendar:'solar',year,month:input.month,day:input.day,yearly:input.yearly,reminderDays:input.reminderDays,note:input.note.trim()};
}
export interface DayOccurrence { entry:ImportantDay; date:string; days:number; year:number; adjusted:boolean }
export function occurrence(entry:ImportantDay,now=new Date()):DayOccurrence {
  const today=localDay(now);
  let year=entry.yearly?Math.max(now.getFullYear(),entry.year??1):entry.year!;
  const at=(y:number)=>civilNumber(y,entry.month,Math.min(entry.day,daysInMonth(y,entry.month)));
  if(entry.yearly&&at(year)<today)year++;
  const day=Math.min(entry.day,daysInMonth(year,entry.month));
  return {entry,year,date:`${String(year).padStart(4,'0')}-${String(entry.month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,days:at(year)-today,adjusted:day!==entry.day};
}
export function orderedDays(entries:ImportantDay[],now=new Date()):DayOccurrence[] {
  return entries.map(e=>occurrence(e,now)).sort((a,b)=>a.days-b.days||a.entry.name.localeCompare(b.entry.name,'zh-CN')||a.entry.id.localeCompare(b.entry.id));
}
export function upcomingDays(entries:ImportantDay[],now=new Date()):DayOccurrence[] {
  return orderedDays(entries,now).filter(o=>o.days>=0&&o.days<=Math.max(14,o.entry.reminderDays));
}
export function reminderFor(entry:ImportantDay,now=new Date()):DayReminder|null {
  const next=occurrence(entry,now);if(next.days<0||next.days>entry.reminderDays)return null;
  const stage=next.days===0?'today':'advance';
  return {key:`${entry.id}/${next.date}/${stage}${stage==='advance'?'/'+entry.reminderDays:''}`,dayId:entry.id,occurrence:next.date,stage};
}
export function dayDistance(days:number):string {return days===0?'今天':days===1?'明天':days<0?'已过去'+(-days)+'天':'还有'+days+'天';}
export function originalDate(entry:ImportantDay):string {return `${entry.year===null?'':entry.year+'年'}${entry.month}月${entry.day}日 · ${entry.yearly?'每年':'不重复'}`;}
