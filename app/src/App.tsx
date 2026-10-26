import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { EditorState } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Plus, Search, FolderOpen, Trash2, Pin, Settings2, ChevronDown, MoreHorizontal, ArrowUpRight, ArrowLeft, ArrowRight, SlidersHorizontal, PanelLeft, PanelTopClose, PanelTopOpen, Paperclip, ImagePlus, Bold, Italic, Heading2, List, ListOrdered, Link, Undo2, Redo2, X, Check, CircleAlert, RotateCcw, Download, Upload, FileText, ArchiveRestore, HardDrive, LoaderCircle, BookOpen, Maximize2, Focus, CheckSquare, ClipboardType, Copy } from 'lucide-react';
import appMark from '../assets/icon.svg';
import type { AppInfo, Attachment, Filter, Note, NoteDetail, NoteSummary, Overview, RichNode,SortOrder,TextMenuAction } from '../electron/shared';
import {usePanels,Splitter,LibraryHeightSplitter,LIBRARY_HEADER,rangeSelection} from './layout';
import {insertPlainText,notePlainText,plainText} from './plain-text';
import {Home} from './Home';
import {homeSnapshot,noteTitle} from './home-model';
import {ImportantDaysPage,ImportantDayDialog,useImportantDays,type DayCloseHandler} from './ImportantDays';
import type {ImportantDay} from '../electron/shared';
import {dayDistance,occurrence} from '../electron/important-days';
import {ContinuousOrderedList} from './numbering';
import {NumberingControl} from './NumberingControl';
import {HelpDialog} from './HelpDialog';

const LocalImage = Image.extend({
  addAttributes() { return { ...this.parent?.(), assetId: { default: null }, width: { default: 560, renderHTML: attrs => ({ width: attrs.width, style: `max-width:100%;width:${attrs.width}px;height:auto` }) } }; }
});
const formatDate = (date: string) => new Date(date).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
const fullDate = (date: string) => new Date(date).toLocaleString('zh-CN', { hour12: false });
const titleFor = noteTitle;
const sizeFor = (n: number) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n/1024).toFixed(0)} KB` : `${(n/1024**2).toFixed(1)} MB`;
const emptyOverview: Overview = { active: 0, trash: 0, tags: [] };
const filterKey=(filter:Filter)=>JSON.stringify([filter.query??'',filter.tag??'',!!filter.trash,filter.sort??'updated']);

function IconButton({ title, active, disabled, onClick, children }: { title: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={`icon-button ${active ? 'active' : ''}`} title={title} aria-label={title} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={onClick}>{children}</button>;
}
export default function App() {
  const api = window.notes;
  const [list, setList] = useState<NoteSummary[]>([]), [overview, setOverview] = useState<Overview>(emptyOverview);
  const [homeNotes,setHomeNotes]=useState<NoteSummary[]>([]),[homeLoaded,setHomeLoaded]=useState(false);
  const [lastOpened,setLastOpened]=useState(()=>localStorage.getItem('suishouji:last-note'));
  const [listFilterKey,setListFilterKey]=useState('');
  const [detail, setDetail] = useState<NoteDetail | null>(null), [query, setQuery] = useState(''), [tag, setTag] = useState(''), [trash, setTrash] = useState(false);
  const [status, setStatus] = useState<'saved'|'dirty'|'saving'|'error'>('saved'), [operation, setOperation] = useState(false), [switching, setSwitching] = useState(true), [importing, setImporting] = useState(false);
  const days=useImportantDays(api,operation);
  const [dayDialog,setDayDialog]=useState<ImportantDay|'new'|null>(null);
  const dayCloseRequest=useRef<DayCloseHandler|null>(null);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null), [menu, setMenu] = useState(false), [noteMenu, setNoteMenu] = useState(false), [help, setHelp] = useState(false);
  const [info, setInfo] = useState<AppInfo | null>(null), [zoom, setZoom] = useState<string | null>(null), [tagInput, setTagInput] = useState(''), [, forceToolbar] = useState(0);
  const [linkValue, setLinkValue] = useState<string | null>(null);
  const [clipboardBusy,setClipboardBusy] = useState(false), [textMenuOpen,setTextMenuOpen] = useState(false);
  const textActionRef = useRef<(action: TextMenuAction) => void>(() => {});
  const textMenuRef = useRef<(mode:'context'|'toolbar',x:number,y:number) => void>(() => {});
  const {preferences:layout,setPreferences:setLayout,sizes,style:layoutStyle}=usePanels();
  const focusEditor=useRef(false);
  const libraryHeading=useRef<HTMLDivElement>(null);
  const [sort,setSort]=useState<SortOrder>(()=>{const s=localStorage.getItem('suishouji:sort');return s==='title'||s==='created'?s:'updated';});
  const [selecting,setSelecting]=useState(false),[checked,setChecked]=useState<Set<string>>(new Set());
  const anchor=useRef<string|null>(null),listArea=useRef<HTMLDivElement>(null),searchPending=useRef(false);
  const [context,setContext]=useState<{x:number;y:number;ids:string[]}|null>(null);
  const [undo,setUndo]=useState<{token:string;expiresAt:number;count:number}|null>(null),[undoSeconds,setUndoSeconds]=useState(10);
  const searchInput = useRef<HTMLInputElement>(null), newNoteAction = useRef<() => void>(() => {});
  const current = useRef<NoteDetail | null>(null), rev = useRef(0), savedRev = useRef(0), saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null), saveQueue = useRef(Promise.resolve(true));
  const filterRef = useRef({ query, tag, trash,sort }); filterRef.current = { query, tag, trash,sort };
  const importTask = useRef<Promise<void> | null>(null), listRequest = useRef(0), selectVersion = useRef(0), initialized = useRef(false);
  const updateRef = useRef<(doc: RichNode) => void>(() => {}), pasteRef = useRef<(files: File[], isPaste: boolean) => void>(() => {}), flushRef = useRef<() => Promise<boolean>>(async () => true);
  const blocked = operation || switching || importing, readOnly = blocked || !!detail?.note.deletedAt;
  const listPending=listFilterKey!==filterKey(filterRef.current);
  const notify = (message: string, error = false) => setToast({ message, error });
  const report = (e: unknown) => notify(e instanceof Error ? e.message : String(e), true);
  function clearSelection(){setSelecting(false);setChecked(new Set());anchor.current=null;}
  function toggleSelection(id:string,range=false){if(listPending)return;setSelecting(true);setChecked(previous=>rangeSelection(list.map(n=>n.id),previous,id,anchor.current,range));if(!range||!anchor.current)anchor.current=id;}
  function openContext(event:React.MouseEvent,id:string){event.preventDefault();event.stopPropagation();if(blocked||listPending)return;const ids=selecting&&checked.has(id)?[...checked]:[id];if(selecting&&!checked.has(id))setChecked(new Set([id]));setContext({x:Math.min(event.clientX,window.innerWidth-230),y:Math.min(event.clientY,window.innerHeight-240),ids});}
  const editor = useEditor({
    extensions: [StarterKit.configure({ orderedList:false,heading: { levels: [1,2,3] }, link: { openOnClick: false, autolink: false, protocols: ['http','https'] } }),ContinuousOrderedList, LocalImage, Placeholder.configure({ placeholder: '在这里写下想记住的事…\n也可以粘贴截图，或把文件拖进来。' })],
    editorProps: {
      attributes: { 'aria-label': '记录正文', class: 'note-prose', tabindex: '0' },
      scrollThreshold: { top: 30, bottom: 24, left: 10, right: 10 },
      scrollMargin: { top: 30, bottom: 24, left: 10, right: 10 },
      handleDOMEvents: {
        keydown: (_view,event) => {
          if (event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey) || !event.shiftKey) return false;
          const key = event.key.toLowerCase();
          if (key !== 'c' && key !== 'v') return false;
          event.preventDefault(); event.stopPropagation();
          textActionRef.current(key === 'c' ? 'copyPlain' : 'pastePlain'); return true;
        },
        contextmenu: (_view,event) => {
          event.preventDefault(); textMenuRef.current('context',event.clientX,event.clientY); return true;
        }
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length) { event.preventDefault(); pasteRef.current(files, true); return true; }
        // Remote images and unsupported HTML never become hidden network requests.
        const html = event.clipboardData?.getData('text/html');
        if (html && /<img\b/i.test(html)) { event.preventDefault(); const text = event.clipboardData?.getData('text/plain') ?? ''; editor?.commands.insertContent(text.split('\n').map(line => ({ type: 'paragraph', content: line ? [{ type:'text', text:line }] : [] }))); return true; }
        return false;
      },
      handleDrop: (_view, event, _slice, moved) => {
        if (moved) return false; const files = [...(event.dataTransfer?.files ?? [])];
        if (files.length) { event.preventDefault(); pasteRef.current(files, false); return true; } return false;
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement;
        if (target.tagName === 'IMG') { editor?.commands.setNodeSelection(_view.posAtDOM(target, 0)); setZoom(target.getAttribute('src')); return true; }
        const a = target.closest('a'); if (a) { event.preventDefault(); void api.openLink(a.href).catch(report); return true; } return false;
      }
    },
    onUpdate: ({ editor }) => updateRef.current(editor.getJSON()),
    onSelectionUpdate: () => forceToolbar(n => n + 1),
    onTransaction: () => forceToolbar(n => n + 1)
  });
  useEffect(() => { editor?.setEditable(!readOnly, false); }, [editor, readOnly]);
  function textTarget() {
    if (!editor || !current.current) return null;
    return { id:current.current.note.id, title:current.current.note.title, doc:editor.state.doc, selection:editor.state.selection };
  }
  async function textAction(action:TextMenuAction,target=textTarget()) {
    if (!editor || !target || blocked || clipboardBusy) return;
    if (current.current?.note.id !== target.id) return;
    if (action === 'pastePlain' && readOnly) return;
    setClipboardBusy(true);
    try {
      if (action === 'pastePlain') {
        const text = await api.readClipboardText();
        // Clipboard IPC is async: never insert into another note/cursor if the
        // user changed the editing target while the OS was responding.
        if (editor.isDestroyed || current.current?.note.id !== target.id || editor.state.doc !== target.doc || !editor.state.selection.eq(target.selection) || !editor.isEditable) return;
        if (!text) { notify('剪贴板里没有可粘贴的文字'); return; }
        insertPlainText(editor.view,text); notify('已粘贴为纯文本');
      } else {
        const text = action === 'copyAllPlain' ? notePlainText(target.title,plainText(target.doc)) : plainText(target.doc,target.selection.from,target.selection.to);
        if (!text.length) { notify(action === 'copyAllPlain' ? '这条记录还没有可复制的文字' : '请先在正文中选中文字'); return; }
        await api.writeClipboardText(text);
        notify(action === 'copyAllPlain' ? '已复制全文纯文本，包含标题和正文' : '已复制为纯文本');
      }
    } catch (e) { report(e); } finally { setClipboardBusy(false); }
  }
  textActionRef.current = action => { void textAction(action); };
  async function showTextMenu(mode:'context'|'toolbar',x:number,y:number) {
    const target = textTarget(); if (!editor || !target || blocked || clipboardBusy || textMenuOpen) return;
    setMenu(false); setNoteMenu(false); setContext(null); setTextMenuOpen(true);
    editor.view.focus();
    try {
      const action = await api.showTextMenu({mode,x,y,hasSelection:!target.selection.empty,
        hasText:!!plainText(target.doc,target.selection.from,target.selection.to).length,editable:!readOnly});
      if (action) await textAction(action,target);
    } catch (e) { report(e); } finally { setTextMenuOpen(false); }
  }
  textMenuRef.current = (mode,x,y) => { void showTextMenu(mode,x,y); };
  function showDetail(next: NoteDetail | null) {
    current.current = next; rev.current = 0; savedRev.current = 0; setDetail(next); setTagInput(''); setStatus('saved'); setNoteMenu(false);
    editor?.commands.setContent(next?.note.document ?? { type:'doc', content:[{ type:'paragraph' }] }, { emitUpdate: false });
    // Each record has its own editing session. setContent alone keeps undo
    // history, which could otherwise restore a previous record into this one.
    if (editor) editor.view.updateState(EditorState.create({ schema:editor.schema, doc:editor.state.doc, plugins:editor.state.plugins }));
  }
  function rememberOpened(next:NoteDetail|null){if(next&&!next.note.deletedAt){localStorage.setItem('suishouji:last-note',next.note.id);setLastOpened(next.note.id);}}
  async function refresh() {
    const sequence = ++listRequest.current; const f = { ...filterRef.current };
    const rowsTask=api.list(f);
    const [rows, counts,allNotes] = await Promise.all([rowsTask,api.overview(),!f.trash&&!f.query&&!f.tag?rowsTask:api.list({sort:'updated'})]);
    if (sequence === listRequest.current) { setList(rows); setOverview(counts);setListFilterKey(filterKey(f));setHomeNotes(allNotes);setHomeLoaded(true); }
    return rows;
  }
  function markChanged(change: Partial<Note>) {
    if (!current.current || current.current.note.deletedAt) return;
    const next = { ...current.current, note: { ...current.current.note, ...change } }; current.current = next; setDetail(next); rev.current++; setStatus('dirty');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushRef.current(); }, 500);
  }
  updateRef.current = document => markChanged({ document });
  async function flush(): Promise<boolean> {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (importTask.current) await importTask.current;
    const task = saveQueue.current.then(async () => {
      while (current.current && savedRev.current < rev.current) {
        const snapshot = current.current.note, revision = rev.current; setStatus('saving');
        try {
          const saved = await api.save({ id: snapshot.id, title: snapshot.title, document: snapshot.document, tags: snapshot.tags });
          if (current.current?.note.id === saved.id) {
            savedRev.current = revision;
            current.current = { ...current.current, note: { ...current.current.note, updatedAt: saved.updatedAt, plainText: saved.plainText } }; setDetail({ ...current.current });
          }
        } catch (e) { setStatus('error'); report(e); return false; }
      }
      setStatus('saved'); await refresh().catch(report); return true;
    }).catch(e => { setStatus('error'); report(e); return false; });
    saveQueue.current = task; return task;
  }
  flushRef.current = flush;
  async function selectNote(id: string,allRecords=false) {
    if (blocked) return false;
    if (id === current.current?.note.id&&!allRecords) return true;
    setSwitching(true); const seq = ++selectVersion.current;
    try { if (!await flush()) return false; const next = await api.get(id);if(allRecords){if(next.note.deletedAt){await refresh();throw new Error('这条记录已移入回收站，请到回收站查看');}setTrash(false);setTag('');setQuery('');filterRef.current={trash:false,tag:'',query:'',sort};await refresh();} if (seq === selectVersion.current) {showDetail(next);return true;} }
    catch (e) { report(e); } finally { setSwitching(false); }
    return false;
  }
  async function openNote(id:string,allRecords=layout.view==='home'){if(await selectNote(id,allRecords)){rememberOpened(current.current);setLayout(p=>({...p,view:'document',focused:false}));}}
  async function openLibrary(){if(blocked||!await flush())return;clearSelection();setLayout(p=>({...p,view:'library',focused:false}));}
  async function openHome(){
    if(blocked)return;setSwitching(true);
    try{if(!await flush())return;clearSelection();setContext(null);setNoteMenu(false);setLayout(p=>({...p,view:'home',focused:false}));setInfo(await api.info());}catch(e){report(e);}finally{setSwitching(false);}
  }
  async function openImportantDays(entry?:ImportantDay){
    if(blocked)return;setSwitching(true);
    try{if(!await flush())return;clearSelection();setMenu(false);setContext(null);setNoteMenu(false);setLayout(p=>({...p,view:'days',focused:false}));if(entry)setDayDialog(entry);await days.refresh();}catch(e){report(e);}finally{setSwitching(false);}
  }
  async function newNote() {
    if (blocked) return;
    clearSelection();setContext(null);
    if (tagInput.trim()) commitTag();
    if (current.current && !current.current.note.deletedAt && !current.current.note.title.trim() && editor?.isEmpty && !current.current.attachments.length && !current.current.note.tags.length) {
      setTrash(false);setTag('');setQuery('');filterRef.current={trash:false,tag:'',query:'',sort};rememberOpened(current.current);searchPending.current=false;focusEditor.current=layout.view!=='document'||layout.focused;setLayout(p=>({...p,view:'document',focused:false}));editor.view.focus();void refresh().catch(report);return;
    }
    setSwitching(true);
    try { if (!await flush()) return; setTrash(false); setTag(''); setQuery(''); filterRef.current = { trash:false, tag:'', query:'',sort }; showDetail(await api.create()); await refresh();
      // Focus before enabling the UI. A delayed focus can steal the first title keystrokes.
      rememberOpened(current.current);focusEditor.current=true;setLayout(p=>({...p,view:'document',focused:false}));editor?.setEditable(true, false); editor?.commands.setTextSelection(0); editor?.view.focus(); }
    catch (e) { report(e); } finally { setSwitching(false); }
  }
  newNoteAction.current = () => { void newNote(); };
  async function changeView(nextTrash: boolean, nextTag = '',browse=false) {
    if (blocked) return; setSwitching(true);
    try { if (!await flush()) return false; clearSelection();setTrash(nextTrash); setTag(nextTag); setQuery(''); filterRef.current = { trash:nextTrash, tag:nextTag, query:'',sort }; const rows = await refresh(); showDetail(rows[0] ? await api.get(rows[0].id) : null);if(browse)setLayout(p=>({...p,view:'library',focused:false}));return true; }
    catch (e) { report(e); } finally { setSwitching(false); }
  }
  async function searchRecords(){
    if(blocked)return;focusEditor.current=false;
    if(layout.view==='home'||layout.view==='days'){searchPending.current=true;if(!await changeView(false,'',true))searchPending.current=false;}
    else if(layout.view==='document'&&(layout.focused||layout.indexHidden)){searchPending.current=true;setLayout(p=>({...p,focused:false,indexHidden:false}));}
    else{searchInput.current?.focus();searchInput.current?.select();}
  }
  async function act(action: () => Promise<unknown>, success?: string, reload = false) {
    if (blocked) return; setSwitching(true); setMenu(false); setNoteMenu(false);setContext(null);
    try {
      if (!await flush()) return;
      const result = await action();
      if (reload) { const rows = await refresh(); const id = current.current?.note.id; const previous = id ? await api.get(id).catch(()=>null) : null; showDetail(previous&&!!previous.note.deletedAt===filterRef.current.trash?previous:rows[0]?await api.get(rows[0].id):null); }
      else await refresh();
      if (success && result !== null && result !== false) notify(success);
      setInfo(await api.info());
    } catch (e) { report(e); } finally { setSwitching(false); }
  }
  async function batchAction(kind:'delete'|'restore'|'remove',ids:string[]){
    if(blocked||listPending||!ids.length)return;setSwitching(true);setContext(null);setNoteMenu(false);
    try{
      if(!await flush())return;
      const oldList=[...list],oldId=current.current?.note.id,oldIndex=oldList.findIndex(n=>n.id===oldId);
      const result=await (kind==='delete'?api.trashMany(ids):kind==='restore'?api.restoreMany(ids):api.removeMany(ids));
      if(result.cancelled)return;
      const rows=await refresh();
      if((!oldId||result.succeeded.includes(oldId))&&!rows.some(n=>n.id===oldId)){
        const nearby=[...oldList.slice(oldIndex+1),...oldList.slice(0,Math.max(0,oldIndex)).reverse()].find(n=>rows.some(r=>r.id===n.id))??rows[0];
        showDetail(nearby?await api.get(nearby.id):null);
      }
      if(result.failed.length){setSelecting(true);setChecked(new Set(result.failed.map(f=>f.id)));setLayout(p=>({...p,indexHidden:false,focused:false}));notify(`成功 ${result.succeeded.length} 条，失败 ${result.failed.length} 条：${result.failed[0].error}`,true);}
      else clearSelection();
      if(kind!=='delete'&&result.succeeded.length)setUndo(null);
      if(result.undo){setUndo({...result.undo,count:result.succeeded.length});setUndoSeconds(10);}
      else if(!result.failed.length)notify(`已${kind==='restore'?'恢复':'永久删除'} ${result.succeeded.length} 条记录`);
      if(result.warnings?.length)notify(result.warnings[0],true);
    }catch(e){report(e);}finally{setSwitching(false);}
  }
  async function undoDeletion(){if(!undo||blocked)return;const token=undo.token;await act(async()=>{const result=await api.undoDelete(token);setUndo(null);notify(`已撤销删除，恢复 ${result.succeeded.length} 条记录`);},undefined,true);}
  function contextPin(id:string){void act(async()=>{const target=list.find(n=>n.id===id);if(!target)return;await api.pin(id,!target.pinned);if(current.current?.note.id===id){const next=await api.get(id);current.current=next;setDetail(next);}});}
  function addAssets(assets: Attachment[]) {
    const now = current.current; if (!now || !editor) return;
    current.current = { ...now, attachments: [...now.attachments, ...assets] }; setDetail(current.current);
    for (const a of assets.filter(a => a.kind === 'image')) editor.chain().focus().insertContent({ type:'image', attrs:{ src:`app-asset://media/${a.id}`, assetId:a.id, alt:a.name, width:560 } }).run();
  }
  function ingest(files: File[], isPaste: boolean) {
    if (!current.current || current.current.note.deletedAt || blocked || importTask.current) return;
    const noteId = current.current.note.id; setImporting(true);
    const task = (async () => {
      try {
        const paths = api.pathsForFiles(files);
        if (!isPaste && paths.length === files.length) addAssets(await api.importPaths(noteId, paths));
        else for (const file of files) {
          if (file.type.startsWith('image/')) addAssets([await api.pasteImage(noteId, new Uint8Array(await file.arrayBuffer()), file.type)]);
          else { const filePaths = api.pathsForFiles([file]); if (filePaths.length) addAssets(await api.importPaths(noteId, filePaths)); else throw new Error('请把文件从资源管理器拖入，或点击“添加附件”'); }
        }
        notify(`已保存 ${files.length} 个文件的副本`); await refresh();
      } catch (e) { report(e); }
      finally { setImporting(false); importTask.current = null; }
    })(); importTask.current = task;
  }
  pasteRef.current = ingest;
  async function pickFiles() {
    if (!current.current || blocked) return; const id = current.current.note.id;
    setImporting(true);
    const task = (async () => { try { addAssets(await api.pickFiles(id)); await refresh(); } catch (e) { report(e); } finally { setImporting(false); importTask.current = null; } })();
    importTask.current = task;
  }
  function commitTag() {
    const value = tagInput.trim().replace(/^#/, ''); if (!value || !detail) { setTagInput(''); return; }
    if (value.length > 30 || detail.note.tags.length >= 30) { notify('每个标签最多30字，一条记录最多30个标签', true); return; }
    markChanged({ tags: [...new Set([...detail.note.tags, value])] }); setTagInput('');
  }
  useEffect(() => {
    if (!editor || initialized.current) return; initialized.current = true;
    void (async () => { try { const appInfo = await api.info(); setInfo(appInfo); if (appInfo.backupWarning) notify(appInfo.backupWarning, true); const rows = await refresh(); const last = rows.find(n => n.id === localStorage.getItem('suishouji:last-note')); if (last) showDetail(await api.get(last.id)); } catch (e) { report(e); } finally { setSwitching(false); } })();
  }, [editor]);
  useEffect(() => { const timer = setTimeout(() => { void refresh().catch(report); }, 150); return () => clearTimeout(timer); }, [query,sort]);
  useEffect(()=>{clearSelection();setContext(null);},[query,tag,trash]);
  useEffect(()=>{const visible=new Set(list.map(n=>n.id));setChecked(previous=>{const next=new Set([...previous].filter(id=>visible.has(id)));return next.size===previous.size?previous:next;});},[list]);
  useEffect(()=>{localStorage.setItem('suishouji:sort',sort);anchor.current=null;},[sort]);
  useEffect(()=>{if(!undo)return;const tick=()=>{const seconds=Math.max(0,Math.ceil((undo.expiresAt-Date.now())/1000));setUndoSeconds(seconds);if(!seconds)setUndo(null);};tick();const timer=setInterval(tick,250);return()=>clearInterval(timer);},[undo]);
  useLayoutEffect(()=>{if(searchPending.current&&layout.view!=='home'&&!switching){searchPending.current=false;focusEditor.current=false;searchInput.current?.focus();searchInput.current?.select();return;}if(focusEditor.current&&layout.view==='document'&&!switching){focusEditor.current=false;editor?.view.focus();}},[layout.focused,layout.indexHidden,layout.view,switching,editor]);
  useEffect(()=>{if(!context)return;const close=()=>setContext(null);window.addEventListener('resize',close);listArea.current?.addEventListener('scroll',close);return()=>{window.removeEventListener('resize',close);listArea.current?.removeEventListener('scroll',close);};},[context]);
  useEffect(() => {
    const offClose = api.onCloseRequested(() => { const close=()=>{void (async () => { if (await flushRef.current()) await api.readyToClose(); })();};if(dayCloseRequest.current)dayCloseRequest.current(close);else close(); });
    const offOperation = api.onOperation(setOperation);
    return () => { offClose(); offOperation(); };
  }, []);
  useEffect(() => { if (!toast || toast.error) return; const timer = setTimeout(() => setToast(null), 4500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if(dayCloseRequest.current)return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 's') { e.preventDefault(); void flushRef.current(); }
        if (!help && linkValue === null && !zoom && key === 'n') { e.preventDefault(); newNoteAction.current(); }
        if (!help && linkValue === null && !zoom && key === 'f') { e.preventDefault();void searchRecords(); }
      }
      if (e.key === 'Escape') { setZoom(null); setHelp(false); setLinkValue(null); setMenu(false); setNoteMenu(false);setContext(null);if(!help&&linkValue===null&&!zoom)clearSelection(); if (!help && linkValue === null && !zoom && document.activeElement === searchInput.current) setQuery(''); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [help, linkValue, zoom,layout.focused,layout.indexHidden,layout.view,blocked]);

  const note = detail?.note, files = detail?.attachments.filter(a => a.kind === 'file') ?? [];
  const resumeNote=homeNotes.find(n=>n.id===lastOpened);
  const inHome=layout.view==='home',inDays=layout.view==='days',inLibrary=layout.view==='library',inDocument=layout.view==='document',indexVisible=inLibrary||(inDocument&&!layout.indexHidden&&!layout.focused);
  useEffect(()=>{
    if((!inHome&&!inDays)||!days.pending.length||operation||document.visibilityState==='hidden'||!document.hasFocus())return;
    void days.acknowledge(days.pending.map(r=>r.key)).catch(report);
  },[inHome,inDays,days.pending,days.now,operation]);
  const reminderEntry=days.entries.find(d=>d.id===days.pending[0]?.dayId);
  const compactLibrary=layout.libraryHeaderHeight<=LIBRARY_HEADER.compactBelow;
  const saveStatus=<div className={`save-state ${status}`} role="status" aria-live="polite">
    {operation||importing||status==='saving'?<LoaderCircle size={13} className="spin"/>:status==='error'?<CircleAlert size={13}/>:<Check size={13}/>}
    <span>{operation?'正在处理数据…':importing?'正在保存附件…':status==='saved'?'所有更改已保存':status==='dirty'?'等待保存…':status==='saving'?'正在保存…':'保存失败'}</span>
    {status==='error'&&<button onClick={()=>void flush()}>重试保存</button>}
  </div>;
  return <div className={`app-shell ${inHome?'home-mode':inDays?'days-mode':inLibrary?'library-mode':'document-mode'} ${inDocument&&layout.focused?'is-focused':''} ${layout.filtersCollapsed?'filters-collapsed':''} ${compactLibrary?'library-compact':''}`} style={layoutStyle} onClick={()=>{if(menu)setMenu(false);if(noteMenu)setNoteMenu(false);if(context)setContext(null);}}>
    <header className="app-navigation" aria-label="主导航">
      <div className="app-brand"><img src={appMark} alt="" draggable={false}/><strong>随手记</strong></div>
      <nav className="space-tabs" aria-label="记录空间">
        <button aria-label="首页" aria-current={inHome?'page':undefined} className={inHome?'current':''} disabled={blocked} onClick={()=>void openHome()}>首页</button>
        <button aria-label="全部记录" aria-current={(inLibrary||inDocument)?'page':undefined} className={inLibrary||inDocument?'current':''} disabled={blocked} onClick={()=>void changeView(false,'',true)}>手记库 {(inLibrary||inDocument)&&<small>{overview.active}</small>}</button>
        <button aria-label="重要日子" aria-current={inDays?'page':undefined} className={inDays?'current':''} disabled={blocked} onClick={()=>void openImportantDays()}>重要日子</button>
      </nav>
      <div className="navigation-tools">
        {(inLibrary||inDocument)&&<button className="new-button" aria-label="新建记录" title="新建记录 Ctrl+N" disabled={blocked} onClick={()=>void newNote()}><Plus size={17}/><span>新建记录</span><kbd>Ctrl N</kbd></button>}
        <div className="settings-anchor"><IconButton title="数据与设置" disabled={blocked} onClick={()=>setMenu(!menu)}><Settings2 size={19}/></IconButton>
          {menu&&<div className="dropdown settings-menu" onClick={e=>e.stopPropagation()}>
            <div className="menu-heading">本地资料管理</div>
            <div className="settings-summary" aria-label="资料近况"><span><b data-testid="settings-total">{overview.active}</b> 条手记 · 近7天更新 <b data-testid="home-week">{homeSnapshot(homeNotes,lastOpened,new Date()).updatedThisWeek}</b> 条</span><span className="settings-backup-state">{info?.lastBackup?`最近备份：${fullDate(info.lastBackup)}`:'暂无备份'}</span>{info?.backupWarning&&<p className="danger">{info.backupWarning}</p>}</div>
            <button onClick={()=>void act(()=>api.backup(),'备份已保存，可将备份复制到U盘')}><Download/>备份全部数据</button>
            <button onClick={()=>void act(async()=>{const restored=await api.restoreBackup();if(restored){setUndo(null);clearSelection();await days.refresh();}return restored;},'备份已恢复',true)}><ArchiveRestore/>从备份恢复</button>
            <button onClick={()=>void act(()=>api.exportNotes(),'已导出为可直接查看的网页')}><Upload/>导出全部记录</button><div className="menu-line"/>
            <button onClick={()=>{setMenu(false);void changeView(true,'',true);}}><Trash2/>查看回收站{overview.trash>0?`（${overview.trash} 条）`:''}</button>
            <button onClick={()=>void api.openDataDir().catch(report)}><FolderOpen/>打开数据文件夹</button>
            <button aria-label="使用说明与数据位置" onClick={()=>{setMenu(false);setHelp(true);}}><BookOpen/>使用说明</button>
          </div>}
        </div>
      </div>
    </header>
    <div className="workbench">
      {inHome&&<Home notes={homeNotes} lastId={lastOpened} info={info} busy={blocked} loaded={homeLoaded} onOpen={id=>void openNote(id)} onNew={()=>void newNote()} onBrowse={()=>void changeView(false,'',true)} onRetry={()=>void openHome()} days={days.entries} dayNow={days.now} onDay={entry=>void openImportantDays(entry)}/>}
      {inDays&&<ImportantDaysPage entries={days.entries} now={days.now} error={days.error} loaded={days.loaded} busy={blocked} onAdd={()=>setDayDialog('new')} onOpen={setDayDialog} onRetry={()=>void days.refresh()}/>}
      <section className="notes-panel" aria-label={inLibrary?'手记库':'记录目录'} hidden={!indexVisible}>
        <div className="collection-heading" ref={libraryHeading}>
          <div><div className="section-overline">{trash?'已删除的记录':'文字 · 图片 · 文件'}</div><h1 title={tag||undefined}>{trash?'回收站':tag?tag:'手记库'}<span>{list.length} 条记录</span></h1><p>{trash?'留在这里，仍然可以找回。':'把值得留下的，放在一起。'}</p></div>
          {!inLibrary&&<div className="index-heading-actions"><IconButton title="展开手记库" onClick={()=>void openLibrary()}><Maximize2 size={16}/></IconButton><IconButton title="关闭记录目录" onClick={()=>setLayout(p=>({...p,indexHidden:true}))}><X size={17}/></IconButton></div>}
          {inLibrary&&!trash&&resumeNote&&<button className="resume-note" disabled={blocked} onClick={()=>void openNote(resumeNote.id,true)}><span>继续上次的记录</span><strong>{titleFor(resumeNote)}</strong><ArrowUpRight size={18}/></button>}
        </div>
        <div className="collection-tools">
          <div className="search-box"><Search size={17}/><input ref={searchInput} aria-label="搜索记录" placeholder="查找标题、正文或文件…" value={query} disabled={blocked} onChange={e=>setQuery(e.target.value)}/>{query?<button aria-label="清除搜索" onClick={()=>setQuery('')}><X size={15}/></button>:<kbd>Ctrl F</kbd>}</div>
          <div className="index-options"><select aria-label="记录排序" value={sort} disabled={blocked} onChange={e=>setSort(e.target.value as SortOrder)}><option value="updated">最近修改</option><option value="created">最近创建</option><option value="title">标题排序</option></select>{inLibrary&&<button className="header-toggle" aria-pressed={compactLibrary} title={compactLibrary?'恢复顶部标题和常规行距':'缩小顶部标题和记录行距，显示更多记录'} onClick={()=>setLayout(p=>({...p,libraryHeaderHeight:compactLibrary?LIBRARY_HEADER.default:LIBRARY_HEADER.min}))}>{compactLibrary?<PanelTopOpen size={15}/>:<PanelTopClose size={15}/>}<span>{compactLibrary?'舒展视图':'紧凑视图'}</span></button>}<button className="filter-toggle" aria-label={layout.filtersCollapsed?'展开标签筛选':'收起标签筛选'} aria-expanded={!layout.filtersCollapsed} onClick={()=>setLayout(p=>({...p,filtersCollapsed:!p.filtersCollapsed}))}><SlidersHorizontal size={15}/><span>筛选</span></button><button className="multi-toggle" aria-pressed={selecting} disabled={blocked||listPending||!list.length} onClick={()=>{if(selecting)clearSelection();else setSelecting(true);}}><CheckSquare size={15}/>{selecting?'退出多选':'多选'}</button></div>
        </div>
        <div className="collection-filters" hidden={layout.filtersCollapsed} aria-label="标签筛选"><span>标签</span><button disabled={blocked} className={!tag?'chosen':''} onClick={()=>void changeView(trash)}>全部</button>{overview.tags.map(t=><button disabled={blocked} key={t.name} className={tag===t.name?'chosen':''} onClick={()=>void changeView(false,t.name)}>{t.name}<small>{t.count}</small></button>)}{!overview.tags.length&&<span className="filter-empty">在记录中添加标签，即可在这里筛选</span>}</div>
        {selecting?<div className="selection-bar" aria-label="批量操作"><strong>已选 {checked.size} 条</strong><button disabled={blocked||listPending} onClick={()=>{setChecked(new Set(list.map(n=>n.id)));anchor.current=list[0]?.id??null;}}>全选当前结果</button><button disabled={blocked} onClick={clearSelection}>取消选择</button><div>{trash&&<button disabled={blocked||listPending||!checked.size} onClick={()=>void batchAction('restore',[...checked])}><RotateCcw size={14}/>恢复所选</button>}<button className="danger" disabled={blocked||listPending||!checked.size} onClick={()=>void batchAction(trash?'remove':'delete',[...checked])}><Trash2 size={14}/>{trash?'永久删除所选':'删除所选'}</button></div></div>:trash&&overview.trash>0?<div className="trash-list-actions"><span>恢复后可继续编辑</span><button disabled={blocked} onClick={()=>void act(async()=>{await api.emptyTrash();if(!(await api.overview()).trash)setUndo(null);},undefined,true)}>清空回收站</button></div>:null}
        <div className="index-columns" aria-hidden="true"><span>序</span><span>记录</span><span>标签</span><span>附件</span><span>{sort==='created'?'创建时间':'修改时间'}</span><span/></div>
        {inLibrary&&<LibraryHeightSplitter heading={libraryHeading} list={listArea} onChange={libraryHeaderHeight=>setLayout(p=>({...p,libraryHeaderHeight}))}/>}
        <div className="note-list" ref={listArea} tabIndex={0} aria-label="记录列表" aria-busy={listPending} onKeyDown={e=>{
          if(e.nativeEvent.isComposing||(e.target as HTMLElement).closest('input:not([type=checkbox]),textarea,[contenteditable=true]'))return;
          if(blocked||listPending){if(e.key==='Delete'||(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();e.stopPropagation();}return;}
          if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();e.stopPropagation();setSelecting(true);setChecked(new Set(list.map(n=>n.id)));}
          if(e.key==='Delete'){e.preventDefault();e.stopPropagation();const id=(e.target as HTMLElement).closest('[data-note-id]')?.getAttribute('data-note-id');void batchAction(trash?'remove':'delete',selecting?[...checked]:id?[id]:[]);}
        }}>
          {list.map((n,i)=><div className={`note-row ${checked.has(n.id)?'is-checked':''}`} data-note-id={n.id} key={n.id} onContextMenu={e=>openContext(e,n.id)}>
            {selecting&&<input className="note-checkbox" type="checkbox" aria-label={`选择 ${titleFor(n)}`} checked={checked.has(n.id)} disabled={blocked||listPending} onChange={e=>toggleSelection(n.id,!!(e.nativeEvent as MouseEvent).shiftKey)} onClick={e=>e.stopPropagation()}/>}
            <button className={`index-entry note-card ${note?.id===n.id?'selected':''}`} disabled={blocked||listPending} onClick={e=>{if(selecting||e.ctrlKey||e.metaKey||e.shiftKey)toggleSelection(n.id,e.shiftKey);else void openNote(n.id);}}>
              <span className="entry-number">{n.pinned?<Pin size={13} aria-label="已置顶"/>:String(i+1).padStart(2,'0')}</span>
              <span className="entry-content"><strong>{titleFor(n)}</strong><span>{n.plainText.replaceAll('\n',' ').slice(0,140)||(n.attachmentCount?'已保存图片或文件':'还没有写下内容')}</span></span>
              <span className="entry-tags">{n.tags.slice(0,2).map(t=><span key={t}>{t}</span>)}</span>
              <span className="entry-files">{n.attachmentCount>0?<><Paperclip size={13}/>{n.attachmentCount}</>:<span>—</span>}</span>
              <time className="entry-date" dateTime={sort==='created'?n.createdAt:n.updatedAt}>{formatDate(sort==='created'?n.createdAt:n.updatedAt)}</time><ArrowUpRight size={16} className="entry-arrow"/>
            </button>
          </div>)}
          {!list.length&&<div className="list-empty"><div className="empty-rule"/><span className="section-overline">{query?'没有匹配的记录':trash?'这里是空的':'从一条记录开始'}</span><h2>{query?'换一个关键词试试。':trash?'暂时没有需要找回的记录。':'给零散的想法，一个位置。'}</h2><p>{query?'可以搜索标题、正文、标签和附件名称。':trash?'删除的记录会保留在这里，需要时可以恢复。':'写一段文字，粘贴一张截图，或拖入一份文件。'}</p>{!query&&!trash&&<button className="empty-create" disabled={blocked} onClick={()=>void newNote()}>新建第一条记录 <ArrowRight size={16}/></button>}</div>}
        </div>
        <footer className="index-footer"><span>{query?`“${query}” 的搜索结果`:tag?`标签：${tag}`:trash?'回收站中的记录可恢复':'你的资料只保存在这台电脑'}</span><span>{list.length} 条</span></footer>
      </section>
      <Splitter name="记录列表宽度" value={sizes.index} min={280} max={520} reset={350} hidden={!inDocument||!sizes.handle} onChange={indexWidth=>setLayout(p=>({...p,indexWidth}))}/>
      <main className="editor-panel" hidden={!inDocument} onDragOver={e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();}} onDrop={e=>{if((e.target as HTMLElement).closest('.tiptap'))return;if(e.dataTransfer.files.length){e.preventDefault();ingest([...e.dataTransfer.files],false);}}}>
        <header className="document-command" aria-label="记录操作">
          <div className="document-navigation"><button className="back-library" aria-label="返回手记库" disabled={blocked} onClick={()=>void openLibrary()}><ArrowLeft size={15}/><span>手记库</span></button><span className="command-divider"/><IconButton title={layout.focused||layout.indexHidden?'显示记录列表':'隐藏记录列表'} active={!layout.indexHidden&&!layout.focused} onClick={()=>setLayout(p=>({...p,focused:false,indexHidden:p.focused?false:!p.indexHidden}))}><PanelLeft size={17}/></IconButton><IconButton title={layout.focused?'退出专注模式':'进入专注模式'} active={layout.focused} onClick={()=>setLayout(p=>({...p,focused:!p.focused}))}><Focus size={17}/></IconButton></div>
          <div className="editor-actions">{note&&!note.deletedAt&&<button className="attachment-trigger" aria-label="添加图片或文件" disabled={blocked} onClick={()=>void pickFiles()}><Plus size={14}/><span>图片 / 文件</span></button>}{note&&(note.deletedAt?<button className="restore-button" disabled={blocked} onClick={()=>void batchAction('restore',[note.id])}><RotateCcw size={15}/>恢复记录</button>:<IconButton title={note.pinned?'取消置顶':'置顶记录'} active={note.pinned} disabled={blocked} onClick={()=>void act(async()=>{await api.pin(note.id,!note.pinned);const next=await api.get(note.id);current.current=next;setDetail(next);})}><Pin size={16}/></IconButton>)}
            {note&&<div className="note-menu-anchor"><IconButton title="更多记录操作" disabled={blocked} onClick={()=>setNoteMenu(!noteMenu)}><MoreHorizontal size={20}/></IconButton>{noteMenu&&<div className="dropdown note-menu" onClick={e=>e.stopPropagation()}><button disabled={clipboardBusy} onClick={()=>{setNoteMenu(false);void textAction('copyAllPlain');}}><Copy/>复制全文为纯文本</button><button onClick={()=>void act(()=>api.exportNotes(note.id),'记录已导出')}><Upload/>导出这条记录</button><div className="menu-line"/><button className="danger" onClick={()=>void batchAction(note.deletedAt?'remove':'delete',[note.id])}><Trash2/>{note.deletedAt?'永久删除':'移到回收站'}</button></div>}</div>}
          </div>
        </header>
        {note?<>
          <div className="toolbar" role="toolbar" aria-label="文字格式">
            <span className="tool-label">文字</span><IconButton title="标题" active={editor?.isActive('heading')} disabled={readOnly} onClick={()=>editor?.chain().focus().toggleHeading({level:2}).run()}><Heading2 size={18}/></IconButton><IconButton title="加粗 Ctrl+B" active={editor?.isActive('bold')} disabled={readOnly} onClick={()=>editor?.chain().focus().toggleBold().run()}><Bold size={16}/></IconButton><IconButton title="斜体 Ctrl+I" active={editor?.isActive('italic')} disabled={readOnly} onClick={()=>editor?.chain().focus().toggleItalic().run()}><Italic size={16}/></IconButton><i/>
            <span className="tool-label">段落</span><IconButton title="项目列表" active={editor?.isActive('bulletList')} disabled={readOnly} onClick={()=>editor?.chain().focus().toggleBulletList().run()}><List size={18}/></IconButton><NumberingControl editor={editor} disabled={readOnly}/><IconButton title="插入网页链接" active={editor?.isActive('link')} disabled={readOnly} onClick={()=>setLinkValue(editor?.getAttributes('link').href??'https://')}><Link size={16}/></IconButton><i/>
            <IconButton title="添加图片或附件" disabled={readOnly} onClick={()=>void pickFiles()}><ImagePlus size={17}/></IconButton><button type="button" className="plain-text-trigger" aria-label="纯文本复制与粘贴" title="纯文本复制与粘贴" aria-haspopup="menu" aria-expanded={textMenuOpen} disabled={blocked||clipboardBusy} onMouseDown={e=>e.preventDefault()} onClick={e=>{e.stopPropagation();const r=e.currentTarget.getBoundingClientRect();void showTextMenu('toolbar',r.left,r.bottom+4);}}><ClipboardType size={16}/><span>纯文本</span><ChevronDown size={12}/></button>
            <span className="toolbar-spacer"/><div className="toolbar-history"><IconButton title="撤销 Ctrl+Z" disabled={readOnly||!editor?.can().undo()} onClick={()=>editor?.chain().focus().undo().run()}><Undo2 size={16}/></IconButton><IconButton title="重做 Ctrl+Y" disabled={readOnly||!editor?.can().redo()} onClick={()=>editor?.chain().focus().redo().run()}><Redo2 size={16}/></IconButton></div>
          </div>
          {note.deletedAt&&<div className="trash-banner"><Trash2 size={14}/>回收站中的记录只供查看，恢复后可以继续编辑。</div>}
          <div className="editor-scroll"><div className="document-desk"><article className="writing-area">
            <header className="page-heading"><div className="record-type">{note.deletedAt?'回收站 / 只读':'随手记录'}</div><input className="title-input" aria-label="记录标题" placeholder="给这条记录起个名字" maxLength={300} value={note.title} disabled={readOnly} onChange={e=>markChanged({title:e.target.value})}/><div className="record-tags">{note.tags.map(t=><span className="tag-chip" key={t}># {t}{!readOnly&&<button aria-label={`移除标签 ${t}`} onClick={()=>markChanged({tags:note.tags.filter(x=>x!==t)})}><X size={11}/></button>}</span>)}{!readOnly&&<div className="tag-input-wrap"><Plus size={12}/><input aria-label="添加标签" placeholder="添加标签" value={tagInput} maxLength={31} onChange={e=>setTagInput(e.target.value)} onBlur={commitTag} onKeyDown={e=>{if(e.key==='Enter'||e.key===','){e.preventDefault();commitTag();}}}/></div>}</div></header>
            {editor?.isActive('image')&&!readOnly&&<div className="image-controls"><span>图片宽度</span>{[280,560,800].map(w=><button key={w} onClick={()=>editor.chain().focus().updateAttributes('image',{width:w}).run()}>{w===280?'小':w===560?'中':'大'}</button>)}<span>点击图片查看原图</span></div>}
            <EditorContent editor={editor}/>
            <section className="attachments-section"><div className="section-label"><h2>随附文件 <span>{files.length||''}</span></h2>{!readOnly&&<button onClick={()=>void pickFiles()}><Plus size={14}/>添加附件</button>}</div>{files.length?<div className="attachment-grid">{files.map(a=><button className="attachment-card" key={a.id} title={`打开 ${a.name}`} onClick={()=>void api.openAttachment(a.id).catch(report)}><FileText size={22}/><span><strong>{a.name}</strong><small>{sizeFor(a.size)} · 已保存副本</small></span><ArrowUpRight size={16}/></button>)}</div>:<p className="attachment-hint">拖入文件或点击添加，副本会随这条记录一起保存。</p>}</section>
            <div className="page-end"><span>—</span><small>{note.plainText.replace(/\s/g,'').length} 字</small></div>
          </article><aside className="page-details" aria-label="记录信息"><span className="section-overline">关于这条记录</span><dl><div><dt>创建于</dt><dd>{fullDate(note.createdAt)}</dd></div><div><dt>最近修改</dt><dd>{fullDate(note.updatedAt)}</dd></div><div><dt>内容</dt><dd>{note.plainText.replace(/\s/g,'').length} 字 · {detail?.attachments.length??0} 个图片及文件</dd></div></dl><div className="local-note"><HardDrive size={15}/><p>保存在本地<br/><span>记录仅属于你</span></p></div></aside></div></div>
        </>:<div className="document-empty"><span className="section-overline">书写页</span><h2>准备记点什么？</h2><p>从手记库选择一条记录，或新建一页。</p><button onClick={()=>void newNote()} disabled={blocked}>新建记录 <ArrowRight size={16}/></button></div>}
      </main>
    </div>
    <footer className="app-status"><span><HardDrive size={12}/><span>本地存储</span><b>·</b>{inHome?'首页':inDays?'重要日子':inLibrary?(trash?'回收站':'手记库'):layout.focused?'专注书写':'书写页'}</span>{saveStatus}<span className="status-hint">{inDays?'':inHome||inLibrary?'Ctrl N 新建 · Ctrl F 查找':note?.deletedAt?'回收站 · 只读':`${note?.plainText.replace(/\s/g,'').length??0} 字 · Ctrl S 保存`}</span></footer>
    {dayDialog&&<ImportantDayDialog entry={dayDialog} api={api} closeRequest={dayCloseRequest} onSaved={days.refresh} onClose={()=>setDayDialog(null)}/>}
    {!inHome&&!inDays&&!dayDialog&&!operation&&!toast&&!undo&&reminderEntry&&<div className="day-reminder" role="status"><button onClick={()=>void openImportantDays(reminderEntry)}><span>{reminderEntry.name} · {dayDistance(occurrence(reminderEntry,days.now).days)}{days.pending.length>1?`，另有${days.pending.length-1}个重要日子`:''}</span><ArrowUpRight size={14}/></button><button aria-label="收起日子提醒" onClick={()=>void days.acknowledge(days.pending.map(r=>r.key)).catch(report)}><X size={14}/></button></div>}

    {context&&<div className="dropdown context-menu" role="menu" aria-label="记录右键菜单" style={{left:Math.max(8,context.x),top:Math.max(8,context.y)}} onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const buttons=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],at=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(at+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}}}>
      {!trash&&context.ids.length===1&&<><button role="menuitem" onClick={()=>contextPin(context.ids[0])}><Pin/>{list.find(n=>n.id===context.ids[0])?.pinned?'取消置顶':'置顶记录'}</button><button role="menuitem" onClick={()=>void act(()=>api.exportNotes(context.ids[0]),'记录已导出')}><Upload/>导出记录</button></>}
      <button role="menuitem" onClick={()=>{setSelecting(true);setChecked(new Set(context.ids));setContext(null);}}><CheckSquare/>选择记录</button>
      {trash&&<button role="menuitem" onClick={()=>void batchAction('restore',context.ids)}><RotateCcw/>恢复{context.ids.length>1?`所选 ${context.ids.length} 条`:'记录'}</button>}
      <button role="menuitem" className="danger" onClick={()=>void batchAction(trash?'remove':'delete',context.ids)}><Trash2/>{trash?'永久删除':'移到回收站'}{context.ids.length>1?`（${context.ids.length} 条）`:''}</button>
    </div>}
    {undo&&<div className="undo-toast" role="status"><Trash2 size={16}/><span>已将 {undo.count} 条记录移到回收站</span><button disabled={blocked} onClick={()=>void undoDeletion()}><Undo2 size={14}/>撤销 <small>{undoSeconds}s</small></button><button aria-label="关闭撤销提示" onClick={()=>setUndo(null)}><X size={14}/></button></div>}
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleAlert size={17}/> : <Check size={17}/>}<span>{toast.message}</span><button aria-label="关闭提示" onClick={() => setToast(null)}><X size={15}/></button></div>}
    {operation && <div className="busy-overlay"><LoaderCircle size={28} className="spin"/><strong>正在处理本地数据</strong><span>请稍候，完成后就可以继续记录。</span></div>}
    {zoom && <div className="image-modal" role="dialog" aria-label="查看图片" onClick={() => setZoom(null)}><button aria-label="关闭图片"><X size={24}/></button><img src={zoom} alt="记录中的图片"/><span>点击任意位置或按 Esc 关闭</span></div>}
    {linkValue !== null && <div className="modal-backdrop" onClick={() => setLinkValue(null)}><div className="help-dialog" role="dialog" aria-label="插入网页链接" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="关闭链接设置" onClick={() => setLinkValue(null)}><X size={19}/></button><h2>添加一个网页链接</h2><p>输入 http:// 或 https:// 开头的网址。留空可以移除当前链接。</p><form className="link-form" onSubmit={e => { e.preventDefault(); const href = linkValue.trim(); if (!href) editor?.chain().focus().extendMarkRange('link').unsetLink().run(); else if (/^https?:\/\//i.test(href)) editor?.chain().focus().extendMarkRange('link').setLink({href}).run(); else { notify('请输入 http:// 或 https:// 开头的网页地址', true); return; } setLinkValue(null); }}><input aria-label="网页地址" autoFocus value={linkValue} onChange={e => setLinkValue(e.target.value)}/><button type="submit">确定</button></form></div></div>}
    {help && <HelpDialog info={info} onClose={()=>setHelp(false)} onOpenDataDir={()=>api.openDataDir()}/>}
  </div>;
}
