import fsp from 'node:fs/promises';
import path from 'node:path';
import {validateImportantDay} from './important-days.js';
import {lunarMonthName,lunarDayName} from './lunar-calendar.js';
import type {DayImportConflict,DayImportDifference,ImportantDay,ImportantDayInput} from './shared.js';

// A single versioned JSON file carries only the original date fields. Lunar
// entries never store the derived Gregorian date, so re-importing cannot change
// the meaning of a recurring lunar day.
export const DAYS_FORMAT='suishouji-important-days';
export const DAYS_VERSION=1;
export const MAX_DAYS_FILE_BYTES=20*1024*1024;
export const MAX_DAYS_ROWS=10000;

export interface DayReminderRecord { occurrence:string; stage:'advance'|'today'; seenAt:string }
export interface DayFileRecord extends ImportantDayInput {
  createdAt:string|null; updatedAt:string|null; reminded:DayReminderRecord[];
}
export interface DaysFile {
  format:string; version:number; application:string; exportedAt:string; count:number; days:DayFileRecord[];
}
export interface ParsedDaysFile { exportedAt:string|null; rows:DayFileRecord[] }
export interface DayImportPlan {
  added:DayFileRecord[];
  duplicates:number;
  conflicts:{ local:ImportantDay; incoming:DayFileRecord }[];
}

const uuidLike=/^[a-f\d-]{36}$/;
const dayLike=/^\d{4}-\d{2}-\d{2}$/;

function stamp(value:unknown):string|null {
  if(typeof value!=='string'||!value)return null;
  const time=Date.parse(value);
  if(!Number.isFinite(time))return null;
  const date=new Date(time),year=date.getUTCFullYear();
  if(year<1970||year>9999)return null;
  return date.toISOString();
}

export function buildDaysFile(entries:ImportantDay[],reminders:Map<string,DayReminderRecord[]>,now=new Date()):DaysFile {
  return {
    format:DAYS_FORMAT, version:DAYS_VERSION, application:'随手记', exportedAt:now.toISOString(), count:entries.length,
    days:entries.map(entry=>({
      id:entry.id, name:entry.name, calendar:entry.calendar, year:entry.year, month:entry.month, day:entry.day,
      isLeapMonth:entry.isLeapMonth, yearly:entry.yearly, reminderDays:entry.reminderDays, note:entry.note,
      createdAt:stamp(entry.createdAt), updatedAt:stamp(entry.updatedAt), reminded:reminders.get(entry.id)??[]
    }))
  };
}

export function serializeDaysFile(file:DaysFile):string { return `${JSON.stringify(file,null,2)}\n`; }

export async function writeDaysFile(destination:string,text:string):Promise<void> {
  const temporary=`${destination}.partial`;
  try { await fsp.writeFile(temporary,text,'utf8'); await fsp.rename(temporary,destination); }
  catch(error){ await fsp.rm(temporary,{force:true}); throw new Error(`无法保存重要日子文件：${error instanceof Error?error.message:String(error)}`); }
}

// Never write an export over the files the running application keeps open.
// Windows paths are case-insensitive, so a saved "NOTES.SQLITE" must be caught
// just like "notes.sqlite".
export function isLiveDataPath(dataDir:string,destination:string):boolean {
  const relative=path.relative(dataDir,destination).toLowerCase();
  return relative==='notes.sqlite'||relative.startsWith(`attachments${path.sep}`)||relative.startsWith(`.运行缓存${path.sep}`);
}

function parseReminders(raw:unknown,at:string):DayReminderRecord[] {
  if(raw===undefined||raw===null)return [];
  if(!Array.isArray(raw))throw new Error(`${at}的提醒记录格式无效`);
  const seen=new Set<string>(),out:DayReminderRecord[]=[];
  for(const item of raw){
    if(!item||typeof item!=='object'||Array.isArray(item))throw new Error(`${at}的提醒记录格式无效`);
    const record=item as Record<string,unknown>;
    const occurrence=typeof record.occurrence==='string'?record.occurrence:'';
    const stage=record.stage;
    const seenAt=stamp(record.seenAt);
    if(!dayLike.test(occurrence)||(stage!=='advance'&&stage!=='today')||!seenAt)throw new Error(`${at}的提醒记录格式无效`);
    const key=`${occurrence}/${stage}`;
    if(seen.has(key))continue;
    seen.add(key);out.push({occurrence,stage,seenAt});
  }
  return out;
}

function parseRow(raw:unknown,position:number):DayFileRecord {
  const at=`第 ${position} 条`;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error(`${at}的格式无效`);
  const row=raw as Record<string,unknown>;
  if(row.calendar!=='solar'&&row.calendar!=='lunar')throw new Error(`${at}的日期类型无效`);
  if(row.name!==undefined&&typeof row.name!=='string')throw new Error(`${at}的名称格式无效`);
  const year=row.year===undefined||row.year===null?null:row.year;
  if(year!==null&&(typeof year!=='number'||!Number.isInteger(year)))throw new Error(`${at}的年份无效`);
  if(typeof row.month!=='number'||typeof row.day!=='number')throw new Error(`${at}的月份或日期无效`);
  if(row.isLeapMonth!==undefined&&typeof row.isLeapMonth!=='boolean')throw new Error(`${at}的闰月标记无效`);
  if(typeof row.yearly!=='boolean')throw new Error(`${at}缺少是否每年重复的信息`);
  if(typeof row.reminderDays!=='number')throw new Error(`${at}缺少提前提醒天数`);
  if(row.note!==undefined&&typeof row.note!=='string')throw new Error(`${at}的备注格式无效`);
  let value:ImportantDayInput;
  try {
    value=validateImportantDay({
      name:(row.name as string|undefined)??'', calendar:row.calendar, year, month:row.month, day:row.day,
      isLeapMonth:row.isLeapMonth===true, yearly:row.yearly, reminderDays:row.reminderDays, note:(row.note as string|undefined)??''
    });
  } catch(error) { throw new Error(`${at}：${error instanceof Error?error.message:String(error)}`); }
  return {
    ...value,
    // The local id is only a matching hint. Unknown or missing ids are ignored
    // so a hand-edited file still imports, and a fresh id is assigned on insert.
    id:typeof row.id==='string'&&uuidLike.test(row.id)?row.id:undefined,
    createdAt:stamp(row.createdAt), updatedAt:stamp(row.updatedAt), reminded:parseReminders(row.reminded,at)
  };
}

export function parseDaysFile(text:string):ParsedDaysFile {
  if(typeof text!=='string'||!text.trim())throw new Error('文件是空的，没有可以导入的重要日子');
  if(Buffer.byteLength(text,'utf8')>MAX_DAYS_FILE_BYTES)throw new Error('文件过大，不是随手记的重要日子导出文件');
  // Windows editors may save with a BOM; it carries no data.
  const body=text.charCodeAt(0)===0xFEFF?text.slice(1):text;
  let root:unknown;
  try { root=JSON.parse(body); } catch { throw new Error('文件内容不是有效的 JSON，可能已经损坏'); }
  if(!root||typeof root!=='object'||Array.isArray(root))throw new Error('这不是随手记的重要日子导出文件');
  const file=root as Record<string,unknown>;
  if(file.format!==DAYS_FORMAT)throw new Error('这不是随手记的重要日子导出文件');
  const version=file.version;
  if(typeof version!=='number'||!Number.isInteger(version)||version<1)throw new Error('文件缺少版本信息，无法确认是否兼容');
  if(version>DAYS_VERSION)throw new Error('这个文件来自更新版本的随手记，请先更新软件再导入');
  if(!Array.isArray(file.days))throw new Error('文件结构不完整，找不到重要日子的列表');
  if(file.days.length>MAX_DAYS_ROWS)throw new Error(`文件里有 ${file.days.length} 条记录，超过一次导入 ${MAX_DAYS_ROWS} 条的上限`);
  // The application never writes an empty export, so an empty list is not a
  // useful file and must not reach the preview as "everything already exists".
  if(!file.days.length)throw new Error('文件里没有可以导入的重要日子');
  return {exportedAt:stamp(file.exportedAt),rows:file.days.map((row,index)=>parseRow(row,index+1))};
}

// Identity for merging: the local id when the file came from this installation,
// otherwise the original date and name. Content equality decides duplicate
// versus conflict, so nothing is ever overwritten silently.
const signature=(day:ImportantDayInput)=>JSON.stringify([day.calendar,day.year,day.month,day.day,day.isLeapMonth,day.yearly,day.name]);
// Same key as JSON.stringify([signature,reminderDays,note]) without paying for
// nested serialization on every comparison.
const content=(day:ImportantDayInput)=>`${signature(day)}\u0000${day.reminderDays}\u0000${day.note}`;

export function planDayImport(current:ImportantDay[],rows:DayFileRecord[]):DayImportPlan {
  const claimed=new Set<string>(),byId=new Map(current.map(day=>[day.id,day])),bySignature=new Map<string,ImportantDay[]>();
  for(const day of current){ const key=signature(day),bucket=bySignature.get(key); if(bucket)bucket.push(day); else bySignature.set(key,[day]); }
  const added:DayFileRecord[]=[],conflicts:DayImportPlan['conflicts']=[],addedContent=new Set<string>();let duplicates=0;
  for(const row of rows){
    let local=row.id?byId.get(row.id):undefined;
    if(local&&claimed.has(local.id))local=undefined;
    if(!local){
      // Two local days can share a date and a name. Prefer the one whose content
      // is identical, so an exact match is reported as duplicate instead of
      // pairing the row with a different record and overwriting it later.
      const bucket=bySignature.get(signature(row)),key=content(row);
      local=bucket?.find(day=>!claimed.has(day.id)&&content(day)===key)??bucket?.find(day=>!claimed.has(day.id));
    }
    if(local){
      claimed.add(local.id);
      if(content(local)===content(row))duplicates++; else conflicts.push({local,incoming:row});
      continue;
    }
    const key=content(row);
    if(addedContent.has(key)){duplicates++;continue;}
    addedContent.add(key);added.push(row);
  }
  return {added,duplicates,conflicts};
}

export function dayDateLabel(day:ImportantDayInput):string {
  const year=day.year===null?'':`${day.year}年`;
  return day.calendar==='lunar'?`农历${year}${lunarMonthName(day.month,day.isLeapMonth)}${lunarDayName(day.day)}`:`${year}${day.month}月${day.day}日`;
}
const reminderLabel=(days:number)=>days>0?`提前${days}天`:'当天提醒';
// Two notes that differ only after the visible part must not look identical in
// the conflict list: the user is choosing between them.
const noteText=(text:string,other:string):string=>{
  const shown=!text?'（空）':text.length>80?`${text.slice(0,80)}…`:text;
  return text!==other&&text.slice(0,80)===other.slice(0,80)?`${shown}（差异在后文）`:shown;
};

export function dayImportConflict(local:ImportantDay,incoming:DayFileRecord):DayImportConflict {
  const differences:DayImportDifference[]=[];
  if(local.name!==incoming.name)differences.push({field:'name',label:'名称',local:local.name,incoming:incoming.name});
  const localDate=dayDateLabel(local),incomingDate=dayDateLabel(incoming);
  if(localDate!==incomingDate)differences.push({field:'date',label:'日期',local:localDate,incoming:incomingDate});
  if(local.yearly!==incoming.yearly)differences.push({field:'yearly',label:'每年重复',local:local.yearly?'每年重复':'不重复',incoming:incoming.yearly?'每年重复':'不重复'});
  if(local.reminderDays!==incoming.reminderDays)differences.push({field:'reminder',label:'提前提醒',local:reminderLabel(local.reminderDays),incoming:reminderLabel(incoming.reminderDays)});
  if(local.note!==incoming.note)differences.push({field:'note',label:'备注',local:noteText(local.note,incoming.note),incoming:noteText(incoming.note,local.note)});
  return {title:local.name,differences};
}
