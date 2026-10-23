import {useEffect,useId,useLayoutEffect,useRef,useState,type MutableRefObject} from 'react';
import {ArrowUpRight,Plus,X,ChevronDown,ArrowLeft} from 'lucide-react';
import type {ImportantDay,ImportantDayInput,NotesAPI,DayReminder} from '../electron/shared';
import {dayDistance,occurrence,orderedDays,originalDate,validateImportantDay,solarDateLabel,lunarRepeatRule} from '../electron/important-days';
import {LUNAR_MIN_YEAR,LUNAR_MAX_YEAR,LUNAR_RANGE,lunarMonthOptions,lunarMonthName,lunarDayName,lunarToSolar} from '../electron/lunar-calendar';
import './important-days.css';

export function useImportantDays(api:NotesAPI,paused:boolean){
  const [entries,setEntries]=useState<ImportantDay[]>([]),[pending,setPending]=useState<DayReminder[]>([]);
  const [now,setNow]=useState(()=>new Date()),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
  const sequence=useRef(0),pausedRef=useRef(paused);pausedRef.current=paused;
  async function refresh(){
    if(pausedRef.current)return;
    const seq=++sequence.current;
    try{const [days,reminders]=await Promise.all([api.listImportantDays(),api.pendingDayReminders()]);if(seq!==sequence.current)return;setEntries(days);setPending(reminders);setNow(new Date());setError('');setLoaded(true);}
    catch(e){if(seq===sequence.current)setError(e instanceof Error?e.message:String(e));}
  }
  useEffect(()=>{
    const check=()=>{if(document.visibilityState!=='hidden')void refresh();};
    check();const timer=setInterval(check,60000);window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);
    return()=>{clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);sequence.current++;};
  },[paused]);
  async function acknowledge(keys:string[]){await api.acknowledgeDayReminders(keys);setPending(p=>p.filter(r=>!keys.includes(r.key)));}
  return {entries,pending,now,error,loaded,refresh,acknowledge};
}

export function ImportantDaysPage({entries,now,error,loaded,busy,onAdd,onOpen,onRetry}:{entries:ImportantDay[];now:Date;error:string;loaded:boolean;busy:boolean;onAdd:()=>void;onOpen:(entry:ImportantDay)=>void;onRetry:()=>void}){
  const ordered=orderedDays(entries,now),upcoming=ordered.filter(o=>o.days>=0),past=ordered.filter(o=>o.days<0).reverse();
  const rows=(items:typeof ordered)=>items.map(o=><button className={`important-day-row ${o.days===0?'is-today':''}`} key={o.entry.id} disabled={busy} onClick={()=>onOpen(o.entry)}>
    <span className="day-row-copy"><strong>{o.entry.name}</strong><span>{originalDate(o.entry)}{o.adjusted?' · 平年按2月最后一天':''}</span>{o.entry.calendar==='lunar'&&<small className="day-row-solar">{o.date?`${o.entry.yearly?'下次':'对应公历'}：${solarDateLabel(o.date)}`:`农历${LUNAR_RANGE}年内没有可计算的下次日期`}</small>}</span>
    <span className="day-row-distance">{o.days<0?'留在记忆里':dayDistance(o.days)}<ArrowUpRight size={15}/></span>
  </button>);
  return <main className="important-days-page" aria-label="重要日子" aria-busy={busy}>
    <div className="important-days-inner">
      <header className="important-days-heading"><div><h1>重要日子</h1><p>把重要的人和日子，记在这里。</p></div><button className="day-add" aria-label="添加重要日子" onClick={onAdd} disabled={busy||!loaded}><Plus size={17}/>添加</button></header>
      {error?<div className="days-unavailable" role="alert"><p>暂时没能读取重要日子：{error}</p><button onClick={onRetry}>重新读取</button></div>:!loaded?<p className="days-empty">正在翻开重要日子…</p>:<>
        {upcoming.length?<div className="important-days-list">{rows(upcoming)}</div>:<p className="days-empty">{past.length?'接下来的日子，等你慢慢记下。':'生日、纪念日，或其他不想忘记的日期。\n从上方添加第一个重要日子。'}</p>}
        {!!past.length&&<details className="past-days"><summary>过去的日子 <ChevronDown size={14}/></summary><div>{rows(past)}</div></details>}
      </>}
    </div>
  </main>;
}

const initial:ImportantDayInput={name:'',calendar:'solar',year:null,month:new Date().getMonth()+1,day:new Date().getDate(),isLeapMonth:false,yearly:true,reminderDays:14,note:''};
const presets=[0,1,3,7,14,30];
export type DayCloseHandler=(after?:()=>void)=>void;
export function ImportantDayDialog({entry,api,onSaved,onClose,closeRequest}:{entry:ImportantDay|'new';api:NotesAPI;onSaved:()=>Promise<void>;onClose:()=>void;closeRequest:MutableRefObject<DayCloseHandler|null>}){
  const formId=useId();
  const baseline=useRef<ImportantDayInput>(entry==='new'?{...initial,month:new Date().getMonth()+1,day:new Date().getDate()}:entry);
  const [value,setValue]=useState<ImportantDayInput>(baseline.current),[editing,setEditing]=useState(entry==='new');
  const [reminder,setReminder]=useState(presets.includes(value.reminderDays)?String(value.reminderDays):'custom');
  const [error,setError]=useState(''),[working,setWorking]=useState(false),[confirmation,setConfirmation]=useState<'discard'|'delete'|null>(null);
  const afterClose=useRef<(()=>void)|undefined>(undefined),dialog=useRef<HTMLDialogElement>(null),previousFocus=useRef(document.activeElement as HTMLElement|null);
  const dirty=JSON.stringify(value)!==JSON.stringify(baseline.current);
  function finish(){onClose();afterClose.current?.();}
  function requestClose(after?:()=>void){if(working)return;afterClose.current=after;if(editing&&dirty)setConfirmation('discard');else finish();}
  useLayoutEffect(()=>{closeRequest.current=requestClose;return()=>{closeRequest.current=null;};});
  useEffect(()=>{const el=dialog.current!;el.showModal();return()=>{el.close();previousFocus.current?.focus();};},[]);
  useEffect(()=>{if(error)dialog.current?.querySelector('[role="alert"]')?.scrollIntoView({block:'nearest'});},[error]);
  function change<K extends keyof ImportantDayInput>(key:K,next:ImportantDayInput[K]){setValue(v=>({...v,[key]:next}));setError('');}
  async function save(){
    setError('');let clean:ImportantDayInput;try{clean={...validateImportantDay(value),id:value.id};}catch(e){setError((e as Error).message);return;}
    setWorking(true);try{await api.saveImportantDay(clean);await onSaved();finish();}catch(e){setError(e instanceof Error?e.message:String(e));setConfirmation(null);}finally{setWorking(false);}
  }
  async function remove(){setWorking(true);try{await api.removeImportantDay(value.id!);await onSaved();finish();}catch(e){setError(e instanceof Error?e.message:String(e));setConfirmation(null);}finally{setWorking(false);}}
  let preview='';try{const next=occurrence({...validateImportantDay(value),id:'preview',createdAt:'',updatedAt:''});preview=!next.date?`农历${LUNAR_RANGE}年内没有可计算的下次日期，仍保留原始日期。`:next.days<0?'这个日子已留在过去。':`下次是 ${solarDateLabel(next.date)} · ${dayDistance(next.days)}`;}catch{/* The form explains incomplete input on save. */}
  const lunar=value.calendar==='lunar',monthCode=value.isLeapMonth?-value.month:value.month;
  const monthOptions=lunar?lunarMonthOptions(value.year):[];
  const missingLeap=lunar&&value.isLeapMonth&&!monthOptions.some(m=>m.month===value.month&&m.isLeapMonth);
  const originalSolar=lunar&&value.year!==null?lunarToSolar(value.year,value.month,value.day,value.isLeapMonth):null;
  const originalSolarLabel=originalSolar?`${originalSolar.year}年${originalSolar.month}月${originalSolar.day}日`:'';
  const detailNext=editing?null:occurrence(value as ImportantDay);
  const nextSolarLabel=detailNext?.date?solarDateLabel(detailNext.date):'';
  return <dialog className="day-dialog" ref={dialog} aria-label={editing?(entry==='new'?'添加重要日子':'编辑重要日子'):'重要日子详情'} onCancel={e=>{e.preventDefault();requestClose();}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)requestClose();}}}>
    <header className="day-dialog-heading"><span>{editing?(entry==='new'?'添加重要日子':'编辑重要日子'):'重要日子'}</span><button aria-label="关闭重要日子" onClick={()=>requestClose()} disabled={working}><X size={19}/></button></header>
    {editing?<form id={formId} className="day-form" onSubmit={e=>{e.preventDefault();void save();}} noValidate>
      <label>名称<input aria-label="日子名称" autoFocus maxLength={100} placeholder="例如：妈妈生日" value={value.name} onChange={e=>change('name',e.target.value)} disabled={working}/></label>
      <fieldset disabled={working}><legend>日期</legend>
        <div className="day-calendar-switch" role="group" aria-label="日期类型">{(['solar','lunar'] as const).map(calendar=><button type="button" key={calendar} aria-pressed={value.calendar===calendar} onClick={()=>{setValue(v=>({...v,calendar,isLeapMonth:calendar==='solar'?false:v.isLeapMonth}));setError('');}}>{calendar==='solar'?'公历':'农历'}</button>)}</div>
        <div className="day-date-inputs">
        <label><span>月</span><select aria-label="月份" value={lunar?monthCode:value.month} onChange={e=>{const code=Number(e.target.value);setValue(v=>({...v,month:Math.abs(code),isLeapMonth:code<0}));setError('');}}>{lunar?<>
          {(monthOptions.length?monthOptions:Array.from({length:12},(_,i)=>({month:i+1,isLeapMonth:false}))).map(m=><option key={m.isLeapMonth?-m.month:m.month} value={m.isLeapMonth?-m.month:m.month}>{lunarMonthName(m.month,m.isLeapMonth)}</option>)}
          {missingLeap&&<option value={-value.month} disabled>{lunarMonthName(value.month,true)}（该年无此月）</option>}
        </>:Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{i+1}月</option>)}</select></label>
        <label><span>日</span><select aria-label="日期" value={value.day} onChange={e=>change('day',Number(e.target.value))}>{Array.from({length:lunar?30:31},(_,i)=><option key={i+1} value={i+1}>{lunar?lunarDayName(i+1):`${i+1}日`}</option>)}{lunar&&value.day===31&&<option value="31" disabled>31日（农历无此日）</option>}</select></label>
        <label className="day-year"><span>{lunar?'农历年份':'年份'}{value.yearly?'（可选）':''}</span><input aria-label="年份" type="number" min={lunar?LUNAR_MIN_YEAR:1} max={lunar?LUNAR_MAX_YEAR:9999} placeholder={value.yearly?'可留空':'请填写'} value={value.year??''} onChange={e=>change('year',e.target.value===''?null:Number(e.target.value))}/></label>
      </div>{lunar&&<p className="day-calendar-help">农历年份支持{LUNAR_RANGE}年；不填年份时，也可选择闰月。</p>}</fieldset>
      <label className="day-repeat"><input type="checkbox" checked={value.yearly} disabled={working} onChange={e=>change('yearly',e.target.checked)}/>每年重复</label>
      {value.yearly&&(lunar?<p className="day-form-help day-lunar-rule">{lunarRepeatRule}</p>:value.month===2&&value.day===29&&<p className="day-form-help">平年按2月最后一天提醒。</p>)}
      <label>提前提醒<select aria-label="提前提醒" value={reminder} disabled={working} onChange={e=>{setReminder(e.target.value);if(e.target.value!=='custom')change('reminderDays',Number(e.target.value));}}>{presets.map(n=><option key={n} value={n}>{n===0?'当天':'提前'+n+'天'}</option>)}<option value="custom">自定义</option></select></label>
      {reminder==='custom'&&<label className="day-custom">提前天数<input aria-label="提前天数" type="number" min="0" max="365" value={Number.isNaN(value.reminderDays)?'':value.reminderDays} disabled={working} onChange={e=>change('reminderDays',e.target.value===''?NaN:Number(e.target.value))}/></label>}
      <p className="day-form-help">{value.reminderDays>0?'提前提醒一次，当天再提醒一次。':'当天提醒一次。'}<br/>提醒仅在「随手记」运行期间生效。</p>
      <label>备注<span className="field-optional">可选</span><textarea aria-label="日子备注" maxLength={3000} rows={3} value={value.note} placeholder="留下一点与这个日子有关的话。" disabled={working} onChange={e=>change('note',e.target.value)}/></label>
      {preview&&<p className="day-preview">{preview}</p>}
      {originalSolarLabel&&<p className="day-preview">录入日期对应公历：{originalSolarLabel}</p>}
      {error&&<p className="day-form-error" role="alert">{error}</p>}
    </form>:<div className="day-detail">
      <h2>{value.name}</h2><p className="day-detail-date">{originalDate(value)}</p>
      {lunar&&<div className="day-detail-solar">{value.yearly&&originalSolarLabel&&originalSolarLabel!==nextSolarLabel&&<p>录入日期对应公历：{originalSolarLabel}</p>}<p>{detailNext?.date?`${value.yearly?'下次对应公历':'对应公历'}：${nextSolarLabel}`:`农历${LUNAR_RANGE}年内没有可计算的下次日期。原始日期仍保留，可继续编辑。`}</p></div>}
      <p className="day-detail-distance">{dayDistance(detailNext!.days)}</p>
      {value.yearly&&(lunar?<p className="day-form-help">{lunarRepeatRule}</p>:value.month===2&&value.day===29&&<p className="day-form-help">平年按2月最后一天提醒。</p>)}
      <p className="day-detail-reminder">{value.reminderDays?'提前'+value.reminderDays+'天和当天提醒。':'当天提醒一次。'}</p><p className="day-form-help">提醒仅在「随手记」运行期间生效。</p>
      {value.note&&<p className="day-detail-note">{value.note}</p>}
      {error&&<p className="day-form-error" role="alert">{error}</p>}
    </div>}
    {!confirmation&&<footer className="day-dialog-actions" key={editing?'edit':'detail'}>{editing?<><button type="button" onClick={()=>requestClose()} disabled={working}>取消</button><button className="day-primary" type="submit" form={formId} disabled={working}>{working?'正在保存…':'保存'}</button></>:<><button type="button" className="day-delete" onClick={()=>setConfirmation('delete')}>删除这个日子</button><button type="button" className="day-primary" onClick={()=>setEditing(true)}>编辑</button></>}</footer>}
    {confirmation&&<div className="day-confirmation" role="group" aria-label={confirmation==='delete'?'确认删除日子':'未保存的修改'}><strong>{confirmation==='delete'?'删除这个重要日子？':'还有修改没有保存。'}</strong><p>{confirmation==='delete'?'只会删除这个日子，不影响手记。删除后无法从回收站恢复。':'可以先保存，或放弃这次修改。'}</p><div>
      <button disabled={working} onClick={()=>{setConfirmation(null);afterClose.current=undefined;}}><ArrowLeft size={13}/>{confirmation==='delete'?'取消':'继续编辑'}</button>
      {confirmation==='discard'?<><button disabled={working} onClick={finish}>放弃修改{afterClose.current?'并退出':''}</button><button className="day-primary" disabled={working} onClick={()=>void save()}>保存{afterClose.current?'并退出':''}</button></>:<button className="day-delete" disabled={working} onClick={()=>void remove()}>{working?'正在删除…':'确认删除'}</button>}
    </div></div>}
  </dialog>;
}
