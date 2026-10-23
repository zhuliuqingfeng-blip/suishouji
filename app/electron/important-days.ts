import type {DayReminder, ImportantDay, ImportantDayInput} from './shared.js';
import {LUNAR_MIN_YEAR,LUNAR_MAX_YEAR,LUNAR_RANGE,lunarMonths,lunarToSolar,lunarMonthName,lunarDayName} from './lunar-calendar.js';

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
  if(input.calendar!=='solar'&&input.calendar!=='lunar')throw new Error('请选择公历或农历');
  // Existing solar callers may omit the new field. Every saved row is explicit.
  const isLeapMonth=input.isLeapMonth===undefined?false:input.isLeapMonth;
  if(typeof isLeapMonth!=='boolean')throw new Error('请选择是否闰月');
  if(typeof input.yearly!=='boolean')throw new Error('请选择是否每年重复');
  const year=input.year;
  if(year!==null&&(!Number.isInteger(year)||year<1||year>9999))throw new Error('年份请填写1至9999之间的整数，或留空');
  if(!input.yearly&&year===null)throw new Error('不重复的日子需要填写年份');
  if(input.calendar==='solar'){
    if(isLeapMonth)throw new Error('公历日期没有闰月');
    if(!Number.isInteger(input.month)||input.month<1||input.month>12||!Number.isInteger(input.day)||input.day<1||input.day>daysInMonth(year??2000,input.month))throw new Error('请填写有效的公历日期');
  }else{
    if(year!==null&&(year<LUNAR_MIN_YEAR||year>LUNAR_MAX_YEAR))throw new Error(`农历年份支持${LUNAR_RANGE}年，或留空`);
    if(!Number.isInteger(input.month)||input.month<1||input.month>12||!Number.isInteger(input.day)||input.day<1||input.day>30)throw new Error('请填写有效的农历日期');
    if(year!==null){
      const month=lunarMonths(year).find(m=>m.month===input.month&&m.isLeapMonth===isLeapMonth);
      if(!month)throw new Error(`${year}年没有${lunarMonthName(input.month,isLeapMonth)}，请核对年份和月份`);
      if(input.day>month.days)throw new Error(`${year}年${lunarMonthName(input.month,isLeapMonth)}只有${month.days}天，请核对日期`);
    }else{
      let possible=false;
      for(let y=LUNAR_MIN_YEAR;y<=LUNAR_MAX_YEAR;y++)if(lunarToSolar(y,input.month,input.day,isLeapMonth)){possible=true;break;}
      if(!possible)throw new Error(`农历${LUNAR_RANGE}年中没有这个日期，请核对月份和日期`);
    }
  }
  if(!Number.isInteger(input.reminderDays)||input.reminderDays<0||input.reminderDays>365)throw new Error('提前提醒请填写0至365之间的整数天数');
  if(typeof input.note!=='string'||input.note.length>3000)throw new Error('备注最多3000字');
  return {name:input.name.trim(),calendar:input.calendar,year,month:input.month,day:input.day,isLeapMonth,yearly:input.yearly,reminderDays:input.reminderDays,note:input.note.trim()};
}
export interface DayOccurrence { entry:ImportantDay; date:string|null; days:number; year:number|null; adjusted:boolean }
const isoDate=(y:number,m:number,d:number)=>`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
export function occurrence(entry:ImportantDay,now=new Date()):DayOccurrence {
  const today=localDay(now);
  if(entry.calendar==='lunar'){
    // A lunar year can extend into the following Gregorian year. Start one
    // year earlier, compare real civil dates, and skip nonexistent dates only.
    const first=entry.yearly?Math.max(LUNAR_MIN_YEAR,now.getFullYear()-1,entry.year??LUNAR_MIN_YEAR):entry.year!;
    const last=entry.yearly?LUNAR_MAX_YEAR:first;
    for(let year=first;year<=last;year++){
      const solar=lunarToSolar(year,entry.month,entry.day,entry.isLeapMonth);
      if(!solar)continue;
      const days=civilNumber(solar.year,solar.month,solar.day)-today;
      if(!entry.yearly||days>=0)return {entry,year,date:isoDate(solar.year,solar.month,solar.day),days,adjusted:false};
    }
    // Keep the entry editable without inventing a date or sending reminders.
    return {entry,year:null,date:null,days:Infinity,adjusted:false};
  }
  let year=entry.yearly?Math.max(now.getFullYear(),entry.year??1):entry.year!;
  const at=(y:number)=>civilNumber(y,entry.month,Math.min(entry.day,daysInMonth(y,entry.month)));
  if(entry.yearly&&at(year)<today)year++;
  const day=Math.min(entry.day,daysInMonth(year,entry.month));
  return {entry,year,date:isoDate(year,entry.month,day),days:at(year)-today,adjusted:day!==entry.day};
}
export function orderedDays(entries:ImportantDay[],now=new Date()):DayOccurrence[] {
  return entries.map(e=>occurrence(e,now)).sort((a,b)=>a.days-b.days||a.entry.name.localeCompare(b.entry.name,'zh-CN')||a.entry.id.localeCompare(b.entry.id));
}
export function upcomingDays(entries:ImportantDay[],now=new Date()):DayOccurrence[] {
  return orderedDays(entries,now).filter(o=>o.days>=0&&o.days<=Math.max(14,o.entry.reminderDays));
}
export function reminderFor(entry:ImportantDay,now=new Date()):DayReminder|null {
  const next=occurrence(entry,now);if(!next.date||next.days<0||next.days>entry.reminderDays)return null;
  const stage=next.days===0?'today':'advance';
  return {key:`${entry.id}/${next.date}/${stage}${stage==='advance'?'/'+entry.reminderDays:''}`,dayId:entry.id,occurrence:next.date,stage};
}
export function dayDistance(days:number):string {return !Number.isFinite(days)?'暂无下次日期':days===0?'今天':days===1?'明天':days<0?'已过去'+(-days)+'天':'还有'+days+'天';}
export function originalDate(entry:ImportantDayInput):string {
  const year=entry.year===null?'':entry.year+'年';
  const date=entry.calendar==='lunar'?`农历${year}${lunarMonthName(entry.month,entry.isLeapMonth)}${lunarDayName(entry.day)}`:`${year}${entry.month}月${entry.day}日`;
  return `${date} · ${entry.yearly?'每年':'不重复'}`;
}
export function solarDateLabel(date:string):string {const [year,month,day]=date.split('-').map(Number);return `${year}年${month}月${day}日`;}
export const lunarRepeatRule='没有所选闰月或三十的年份会跳过，寻找下一次相同农历日期，原日期保持不变。';
