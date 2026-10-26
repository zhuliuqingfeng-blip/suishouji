import {useEffect,useRef,useState} from 'react';
import type {Editor} from '@tiptap/react';
import {ListOrdered,ChevronDown,ArrowRight,RotateCcw} from 'lucide-react';
import {listContext,previousNumberedList} from './numbering';

export function NumberingControl({editor,disabled}:{editor:Editor|null;disabled:boolean}){
  const [open,setOpen]=useState(false),anchor=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const context=editor?listContext(editor.state):null,active=context?.list?.node.type.name==='orderedList';
  const canContinue=active&&!!editor&&!!previousNumberedList(editor.state);
  useEffect(()=>{
    if(!open)return;
    const close=(event:MouseEvent)=>{if(!anchor.current?.contains(event.target as Node))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();}};
    document.addEventListener('mousedown',close);document.addEventListener('keydown',escape,true);
    return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',escape,true);};
  },[open]);
  useEffect(()=>{setOpen(false);},[disabled,editor?.state.doc]);
  return <div className="numbering-control" ref={anchor}>
    <button type="button" className={`icon-button ${active?'active':''}`} title="编号列表：分散段落默认接着前面编号" aria-label="编号列表" aria-pressed={!!active} disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={()=>{setOpen(false);editor?.chain().focus().toggleOrderedList().run();}}><ListOrdered size={18}/></button>
    <button type="button" className="numbering-chevron" aria-label="编号选项" title="编号选项" ref={trigger} disabled={disabled} aria-haspopup="menu" aria-expanded={open} onMouseDown={e=>e.preventDefault()} onClick={()=>setOpen(value=>!value)}><ChevronDown size={11}/></button>
    {open&&<div className="numbering-menu" role="menu" aria-label="编号选项" onMouseDown={e=>e.preventDefault()}>
      <button role="menuitem" disabled={!canContinue} onClick={()=>{editor?.chain().focus().continueNumbering().run();setOpen(false);}}><ArrowRight size={14}/><span>继续前面编号</span></button>
      <button role="menuitem" disabled={!active} onClick={()=>{editor?.chain().focus().restartNumbering().run();setOpen(false);}}><RotateCcw size={14}/><span>本组从 1 开始</span></button>
      <p>{active?'中间可保留普通正文，接续的序号会自动更新。':'先点击左侧按钮，给当前段落添加编号。'}</p>
    </div>}
  </div>;
}
