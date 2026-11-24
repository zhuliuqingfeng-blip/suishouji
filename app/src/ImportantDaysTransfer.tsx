import {useEffect,useRef,useState,type MutableRefObject,type ReactNode} from 'react';
import {X} from 'lucide-react';
import type {DayExportResult,DayImportPreview} from '../electron/shared';

const dateText=(value:string)=>new Date(value).toLocaleString('zh-CN',{hour12:false});
type FocusTarget=MutableRefObject<HTMLElement|null>;

// The transfer dialogs reuse the day dialog shell so the page keeps one visual
// language: same width, heading, scroll area and footer buttons.
function TransferShell({label,children,footer,onClose,returnFocus}:{label:string;children:ReactNode;footer:ReactNode;onClose:()=>void;returnFocus?:FocusTarget}){
  const dialog=useRef<HTMLDialogElement>(null),previous=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    const el=dialog.current!;previous.current=document.activeElement as HTMLElement|null;el.showModal();
    return()=>{el.close();(returnFocus?.current??previous.current)?.focus();};
  },[]);
  return <dialog className="day-dialog day-transfer-dialog" ref={dialog} aria-label={label} onCancel={e=>{e.preventDefault();onClose();}}>
    <header className="day-dialog-heading"><span>{label}</span><button aria-label={`关闭${label}`} onClick={onClose}><X size={19}/></button></header>
    {children}
    <footer className="day-dialog-actions">{footer}</footer>
  </dialog>;
}

export function DayExportDialog({result,error,onReveal,onClose,returnFocus}:{result:DayExportResult;error:string;onReveal:()=>void;onClose:()=>void;returnFocus?:FocusTarget}){
  return <TransferShell label="导出重要日子" onClose={onClose} returnFocus={returnFocus} footer={<>
    <button type="button" onClick={onReveal}>打开所在文件夹</button>
    <button type="button" className="day-primary" autoFocus onClick={onClose}>完成</button>
  </>}>
    <div className="day-transfer-body">
      <p className="day-transfer-lead">已导出 <b>{result.count}</b> 条重要日子</p>
      <p className="day-transfer-file">保存位置</p>
      <p className="day-transfer-path">{result.path}</p>
      {error&&<p className="day-form-error" role="alert">{error}</p>}
      <p className="day-form-help">这个文件只包含重要日子，可以单独保存、迁移到其他电脑，或分享给别人。导入时只会合并，不会删除现有的日子。已提醒过的节点会随文件一起带走。</p>
    </div>
  </TransferShell>;
}

export function DayImportDialog({preview,error,working,onCancel,onConfirm,returnFocus}:{preview:DayImportPreview;error:string;working:boolean;onCancel:()=>void;onConfirm:(choice:'local'|'incoming')=>void;returnFocus?:FocusTarget}){
  const [conflict,setConflict]=useState<'local'|'incoming'>('local');
  const empty=preview.added===0&&preview.conflicts.length===0;
  return <TransferShell label="导入重要日子" onClose={()=>{if(!working)onCancel();}} returnFocus={returnFocus} footer={<>
    <button type="button" onClick={onCancel} disabled={working}>取消</button>
    <button type="button" className="day-primary" disabled={working} onClick={()=>{if(empty)onCancel();else onConfirm(conflict);}}>{
      working?'正在导入…':empty?'知道了':'确认导入'}</button>
  </>}>
    <div className="day-transfer-body">
      <p className="day-transfer-lead">即将导入：<b>{preview.added}</b> 条新增 · <b>{preview.duplicates}</b> 条重复{preview.conflicts.length>0&&<> · <b>{preview.conflicts.length}</b> 条冲突</>}</p>
      <p className="day-transfer-file">{preview.fileName}{preview.exportedAt?` · 导出于 ${dateText(preview.exportedAt)}`:''}</p>
      {error&&<p className="day-form-error" role="alert">{error}</p>}
      {preview.duplicates>0&&!empty&&<p className="day-form-help">完全相同的日子会跳过，不会重复创建。</p>}
      {preview.conflicts.length>0&&<section className="day-conflict">
        <h2>{preview.conflicts.length} 条日子与现有内容不同</h2>
        <p className="day-form-help">同一条日子的内容存在差异。请选择保留本地版本，或采用文件中的版本。</p>
        <div className="day-conflict-choice" role="group" aria-label="冲突日子的处理方式">
          <button type="button" aria-pressed={conflict==='local'} disabled={working} onClick={()=>setConflict('local')}>保留本地版本</button>
          <button type="button" aria-pressed={conflict==='incoming'} disabled={working} onClick={()=>setConflict('incoming')}>采用导入版本</button>
        </div>
        <ul className="day-conflict-list">{preview.conflicts.map((item,index)=><li key={index}>
          <strong>{item.title}</strong>
          {item.differences.map(difference=><span key={difference.field}><em>{difference.label}</em>本地 {difference.local} · 导入 {difference.incoming}</span>)}
        </li>)}</ul>
      </section>}
      {empty&&<p className="day-form-help">文件里的日子都已经存在，没有需要导入的内容。</p>}
      {!empty&&!preview.conflicts.length&&<p className="day-form-help">现有重要日子不会被删除，导入的内容会与本地合并。</p>}
    </div>
  </TransferShell>;
}
