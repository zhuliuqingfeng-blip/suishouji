import type {NoteSummary} from '../electron/shared';

export const noteTitle=(note:{title:string;plainText:string})=>note.title.trim()||note.plainText.trim().split('\n')[0]?.slice(0,60)||'未命名记录';

export function homeSnapshot(notes:NoteSummary[],lastId:string|null,now:Date){
  const active=notes.filter(note=>!note.deletedAt);
  const recent=[...active].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
  const since=new Date(now);since.setHours(0,0,0,0);since.setDate(since.getDate()-6);
  return {
    total:active.length,
    updatedThisWeek:active.filter(note=>{const time=Date.parse(note.updatedAt);return time>=since.getTime()&&time<=now.getTime();}).length,
    resume:active.find(note=>note.id===lastId)??null,
    recent:recent.slice(0,3)
  };
}

export function friendlyTime(value:string,now:Date){
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return '时间未知';
  const today=new Date(now);today.setHours(0,0,0,0);
  const yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);
  const tomorrow=new Date(today);tomorrow.setDate(tomorrow.getDate()+1);
  const clock=date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
  if(date>=today&&date<tomorrow)return `今天 ${clock}`;
  if(date>=yesterday&&date<today)return `昨天 ${clock}`;
  return date.toLocaleDateString('zh-CN',{...(date.getFullYear()!==now.getFullYear()?{year:'numeric' as const}:{}),month:'long',day:'numeric'});
}
