import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { NotebookPen, Plus, Search, FolderOpen, Trash2, Pin, Tag, Settings2, ChevronDown, MoreHorizontal, ArrowUpRight, Paperclip, ImagePlus, Bold, Italic, Heading2, List, ListOrdered, Link, Undo2, Redo2, X, Check, CircleAlert, RotateCcw, Download, Upload, FileText, ArchiveRestore, HardDrive, LoaderCircle, CheckCheck, BookOpen, Maximize2 } from 'lucide-react';
import type { AppInfo, Attachment, Note, NoteDetail, NoteSummary, Overview, RichNode } from '../electron/shared';

const LocalImage = Image.extend({
  addAttributes() { return { ...this.parent?.(), assetId: { default: null }, width: { default: 560, renderHTML: attrs => ({ width: attrs.width, style: `max-width:100%;width:${attrs.width}px;height:auto` }) } }; }
});
const formatDate = (date: string) => new Date(date).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
const fullDate = (date: string) => new Date(date).toLocaleString('zh-CN', { hour12: false });
const titleFor = (n: { title: string; plainText: string }) => n.title.trim() || n.plainText.trim().split('\n')[0]?.slice(0, 60) || '未命名记录';
const sizeFor = (n: number) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n/1024).toFixed(0)} KB` : `${(n/1024**2).toFixed(1)} MB`;
const emptyOverview: Overview = { active: 0, trash: 0, tags: [] };

function IconButton({ title, active, disabled, onClick, children }: { title: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={`icon-button ${active ? 'active' : ''}`} title={title} aria-label={title} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={onClick}>{children}</button>;
}
export default function App() {
  const api = window.notes;
  const [list, setList] = useState<NoteSummary[]>([]), [overview, setOverview] = useState<Overview>(emptyOverview);
  const [detail, setDetail] = useState<NoteDetail | null>(null), [query, setQuery] = useState(''), [tag, setTag] = useState(''), [trash, setTrash] = useState(false);
  const [status, setStatus] = useState<'saved'|'dirty'|'saving'|'error'>('saved'), [operation, setOperation] = useState(false), [switching, setSwitching] = useState(true), [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null), [menu, setMenu] = useState(false), [noteMenu, setNoteMenu] = useState(false), [help, setHelp] = useState(false);
  const [info, setInfo] = useState<AppInfo | null>(null), [zoom, setZoom] = useState<string | null>(null), [tagInput, setTagInput] = useState(''), [, forceToolbar] = useState(0);
  const [linkValue, setLinkValue] = useState<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null), newNoteAction = useRef<() => void>(() => {});
  const current = useRef<NoteDetail | null>(null), rev = useRef(0), savedRev = useRef(0), saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null), saveQueue = useRef(Promise.resolve(true));
  const filterRef = useRef({ query, tag, trash }); filterRef.current = { query, tag, trash };
  const importTask = useRef<Promise<void> | null>(null), listRequest = useRef(0), selectVersion = useRef(0), initialized = useRef(false);
  const updateRef = useRef<(doc: RichNode) => void>(() => {}), pasteRef = useRef<(files: File[], isPaste: boolean) => void>(() => {}), flushRef = useRef<() => Promise<boolean>>(async () => true);
  const blocked = operation || switching || importing, readOnly = blocked || !!detail?.note.deletedAt;
  const notify = (message: string, error = false) => setToast({ message, error });
  const report = (e: unknown) => notify(e instanceof Error ? e.message : String(e), true);
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [1,2,3] }, link: { openOnClick: false, autolink: false, protocols: ['http','https'] } }), LocalImage, Placeholder.configure({ placeholder: '在这里写下想记住的事…\n也可以粘贴截图，或把文件拖进来。' })],
    editorProps: {
      attributes: { 'aria-label': '记录正文', class: 'note-prose' },
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
  function showDetail(next: NoteDetail | null) {
    current.current = next; rev.current = 0; savedRev.current = 0; setDetail(next); setTagInput(''); setStatus('saved'); setNoteMenu(false);
    editor?.commands.setContent(next?.note.document ?? { type:'doc', content:[{ type:'paragraph' }] }, { emitUpdate: false });
    if (next && !next.note.deletedAt) localStorage.setItem('suishouji:last-note', next.note.id);
  }
  async function refresh() {
    const sequence = ++listRequest.current; const f = { ...filterRef.current };
    const [rows, counts] = await Promise.all([api.list(f), api.overview()]);
    if (sequence === listRequest.current) { setList(rows); setOverview(counts); }
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
  async function selectNote(id: string) {
    if (blocked || id === current.current?.note.id) return;
    setSwitching(true); const seq = ++selectVersion.current;
    try { if (!await flush()) return; const next = await api.get(id); if (seq === selectVersion.current) showDetail(next); }
    catch (e) { report(e); } finally { setSwitching(false); }
  }
  async function newNote() {
    if (blocked) return;
    if (tagInput.trim()) commitTag();
    if (current.current && !current.current.note.deletedAt && !current.current.note.title.trim() && editor?.isEmpty && !current.current.attachments.length && !current.current.note.tags.length) {
      setQuery(''); editor.view.focus(); return;
    }
    setSwitching(true);
    try { if (!await flush()) return; setTrash(false); setTag(''); setQuery(''); filterRef.current = { trash:false, tag:'', query:'' }; showDetail(await api.create()); await refresh();
      // Focus before enabling the UI. A delayed focus can steal the first title keystrokes.
      editor?.setEditable(true, false); editor?.commands.setTextSelection(0); editor?.view.focus(); }
    catch (e) { report(e); } finally { setSwitching(false); }
  }
  newNoteAction.current = () => { void newNote(); };
  async function changeView(nextTrash: boolean, nextTag = '') {
    if (blocked) return; setSwitching(true);
    try { if (!await flush()) return; setTrash(nextTrash); setTag(nextTag); setQuery(''); filterRef.current = { trash:nextTrash, tag:nextTag, query:'' }; const rows = await refresh(); showDetail(rows[0] ? await api.get(rows[0].id) : null); }
    catch (e) { report(e); } finally { setSwitching(false); }
  }
  async function act(action: () => Promise<unknown>, success?: string, reload = false) {
    if (blocked) return; setSwitching(true); setMenu(false); setNoteMenu(false);
    try {
      if (!await flush()) return;
      const result = await action();
      if (reload) { const rows = await refresh(); const id = current.current?.note.id; const next = rows.find(n => n.id === id) ?? rows[0]; showDetail(next ? await api.get(next.id) : null); }
      else await refresh();
      if (success && result !== null && result !== false) notify(success);
      setInfo(await api.info());
    } catch (e) { report(e); } finally { setSwitching(false); }
  }
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
    void (async () => { try { const appInfo = await api.info(); setInfo(appInfo); if (appInfo.backupWarning) notify(appInfo.backupWarning, true); const rows = await refresh(); const last = rows.find(n => n.id === localStorage.getItem('suishouji:last-note')) ?? rows[0]; if (last) showDetail(await api.get(last.id)); } catch (e) { report(e); } finally { setSwitching(false); } })();
  }, [editor]);
  useEffect(() => { const timer = setTimeout(() => { void refresh().catch(report); }, 150); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    const offClose = api.onCloseRequested(() => { void (async () => { if (await flushRef.current()) await api.readyToClose(); })(); });
    const offOperation = api.onOperation(setOperation);
    return () => { offClose(); offOperation(); };
  }, []);
  useEffect(() => { if (!toast || toast.error) return; const timer = setTimeout(() => setToast(null), 4500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 's') { e.preventDefault(); void flushRef.current(); }
        if (!help && linkValue === null && !zoom && key === 'n') { e.preventDefault(); newNoteAction.current(); }
        if (!help && linkValue === null && !zoom && key === 'f') { e.preventDefault(); searchInput.current?.focus(); searchInput.current?.select(); }
      }
      if (e.key === 'Escape') { setZoom(null); setHelp(false); setLinkValue(null); setMenu(false); setNoteMenu(false); if (!help && linkValue === null && !zoom && document.activeElement === searchInput.current) setQuery(''); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [help, linkValue, zoom]);

  const note = detail?.note, files = detail?.attachments.filter(a => a.kind === 'file') ?? [];
  return <div className="app-shell" onClick={() => { if (menu) setMenu(false); if (noteMenu) setNoteMenu(false); }}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><NotebookPen size={23}/></div><div><strong>随手记<span className="brand-dot">.</span></strong><span className="brand-sub">给想法一个落脚点</span></div></div>
      <button className="new-button" title="新建记录 Ctrl+N" onClick={() => void newNote()} disabled={blocked}><Plus size={18}/> 新建记录 <kbd>Ctrl N</kbd></button>
      <div className="nav-caption">我的空间</div>
      <button className={`nav-item ${!trash && !tag ? 'selected' : ''}`} onClick={() => void changeView(false)} disabled={blocked}><NotebookPen size={17}/><span>全部记录</span><b>{overview.active}</b></button>
      <button className={`nav-item ${trash ? 'selected' : ''}`} onClick={() => void changeView(true)} disabled={blocked}><Trash2 size={17}/><span>回收站</span>{overview.trash > 0 && <b>{overview.trash}</b>}</button>
      <div className="nav-caption tag-caption">标签 <Tag size={13}/></div>
      <div className="tag-nav">{overview.tags.length ? overview.tags.map(t => <button key={t.name} className={`nav-item ${tag === t.name ? 'selected' : ''}`} disabled={blocked} onClick={() => void changeView(false, t.name)}><span className="hash">#</span><span className="truncate">{t.name}</span><b>{t.count}</b></button>) : <p className="sidebar-hint">为记录添加标签，<br/>让零散内容慢慢有序。</p>}</div>
      <div className="sidebar-footer">
        <div className="local-badge"><span/> 只在这台电脑保存 <HardDrive size={13}/></div>
        <div className="settings-anchor"><button className="settings-button" onClick={e => { e.stopPropagation(); setMenu(!menu); }} disabled={blocked}><Settings2 size={17}/> 数据与设置 <ChevronDown size={14}/></button>
          {menu && <div className="dropdown settings-menu" onClick={e => e.stopPropagation()}>
            <button onClick={() => void act(() => api.backup(), '备份已保存，可将备份复制到U盘') }><Download/>备份全部数据</button>
            <button onClick={() => void act(() => api.restoreBackup(), '备份已恢复', true)}><ArchiveRestore/>从备份恢复</button>
            <button onClick={() => void act(() => api.exportNotes(), '已导出为可直接查看的网页')}><Upload/>导出全部记录</button>
            <div className="menu-line"/>
            <button onClick={() => void api.openDataDir().catch(report)}><FolderOpen/>打开数据文件夹</button>
            <button onClick={() => { setMenu(false); setHelp(true); }}><BookOpen/>使用说明与数据位置</button>
          </div>}
        </div>
      </div>
    </aside>
    <section className="notes-panel">
      <header className="list-header"><div><span className="eyebrow">我的记录 / NOTES</span><h1>{trash ? '回收站' : tag ? `# ${tag}` : '全部记录'}<span>{list.length}</span></h1></div><IconButton title="新建记录" onClick={() => void newNote()} disabled={blocked}><Plus size={20}/></IconButton></header>
      <div className="search-box"><Search size={16}/><input ref={searchInput} aria-label="搜索记录" placeholder="搜索文字、标签或附件" value={query} disabled={blocked} onChange={e => setQuery(e.target.value)}/>{query ? <button aria-label="清除搜索" onClick={() => setQuery('')}><X size={14}/></button> : <kbd>Ctrl F</kbd>}</div>
      <div className="list-caption"><span>{query ? '搜索结果' : trash ? '删除的记录可以在这里找回' : '最近修改'}</span>{trash && overview.trash > 0 ? <button disabled={blocked} onClick={() => void act(() => api.emptyTrash(), undefined, true)}>清空</button> : <span className="sort-lines">≡</span>}</div>
      <div className="note-list">{list.map(n => <button className={`note-card ${note?.id === n.id ? 'selected' : ''}`} key={n.id} disabled={blocked} onClick={() => void selectNote(n.id)}>
        <div className="card-top"><span className="card-date">{formatDate(n.updatedAt)}</span>{n.pinned && <Pin size={12} className="pin-mark"/>}</div>
        <h3>{titleFor(n)}</h3><p>{n.plainText.replaceAll('\n',' ').slice(0,100) || (n.attachmentCount ? '已保存附件，点击查看' : '还没有写下内容')}</p>
        <div className="card-bottom"><div>{n.tags.slice(0,2).map(t => <span key={t}># {t}</span>)}</div>{n.attachmentCount > 0 && <span className="card-attachment"><Paperclip size={12}/>{n.attachmentCount}</span>}</div>
      </button>)}{!list.length && <div className="list-empty"><Search size={25}/><p>{query ? '没有找到相关记录' : trash ? '回收站是空的' : '从第一条记录开始'}</p><small>{query ? '换个关键词试试看' : trash ? '删除的记录会出现在这里' : '点击“新建记录”，留住此刻的想法'}</small></div>}</div>
      <footer className="list-footer"><span className="tiny-dot"/> 本地存储 · 自动保存</footer>
    </section>
    <main className="editor-panel" onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={e => { if ((e.target as HTMLElement).closest('.tiptap')) return; if (e.dataTransfer.files.length) { e.preventDefault(); ingest([...e.dataTransfer.files], false); } }}>
      {note ? <>
        <header className="editor-header"><div className={`save-state ${status}`}>
          {operation || importing || status === 'saving' ? <LoaderCircle size={14} className="spin"/> : status === 'error' ? <CircleAlert size={14}/> : <CheckCheck size={15}/>}
          {operation ? '正在处理数据…' : importing ? '正在保存附件…' : status === 'saved' ? '所有更改已保存' : status === 'dirty' ? '等待保存…' : status === 'saving' ? '正在保存…' : '保存失败'}
          {status === 'error' && <button onClick={() => void flush()}>重试</button>}</div>
          <div className="editor-actions">{!note.deletedAt && <button className="attachment-trigger" aria-label="添加图片或文件" disabled={blocked} onClick={() => void pickFiles()}><Paperclip size={16}/><span>图片 / 文件</span></button>}{note.deletedAt ? <button className="text-button" disabled={blocked} onClick={() => void act(() => api.restoreNote(note.id), '记录已恢复', true)}><RotateCcw size={15}/>恢复记录</button> : <IconButton title={note.pinned ? '取消置顶' : '置顶记录'} active={note.pinned} disabled={blocked} onClick={() => void act(async () => { await api.pin(note.id, !note.pinned); const updated = await api.get(note.id); current.current = updated; setDetail(updated); })}><Pin size={17}/></IconButton>}
            <div className="note-menu-anchor"><IconButton title="更多记录操作" onClick={() => setNoteMenu(!noteMenu)} disabled={blocked}><MoreHorizontal size={21}/></IconButton>{noteMenu && <div className="dropdown note-menu" onClick={e => e.stopPropagation()}>
              <button onClick={() => void act(() => api.exportNotes(note.id), '记录已导出')}><Upload/>导出这条记录</button>
              {note.deletedAt ? <button className="danger" onClick={() => void act(() => api.remove(note.id), undefined, true)}><Trash2/>永久删除</button> : <button className="danger" onClick={() => void act(() => api.trash(note.id), '已移到回收站', true)}><Trash2/>移到回收站</button>}
            </div>}</div>
          </div>
        </header>
        {note.deletedAt && <div className="trash-banner"><Trash2 size={15}/>这条记录在回收站中，恢复后可以继续编辑。</div>}
        <div className="editor-scroll"><article className="writing-area">
          <div className="record-meta"><span className="record-type"><span/> 随手记录</span><span>{fullDate(note.createdAt)} 创建</span></div>
          <input className="title-input" aria-label="记录标题" placeholder="无标题也没关系" maxLength={300} value={note.title} disabled={readOnly} onChange={e => markChanged({ title: e.target.value })}/>
          <div className="record-tags">{note.tags.map(t => <span className="tag-chip" key={t}># {t}{!readOnly && <button aria-label={`移除标签 ${t}`} onClick={() => markChanged({ tags:note.tags.filter(x => x !== t) })}><X size={11}/></button>}</span>)}{!readOnly && <div className="tag-input-wrap"><Tag size={12}/><input aria-label="添加标签" placeholder="添加标签" value={tagInput} maxLength={31} onChange={e => setTagInput(e.target.value)} onBlur={commitTag} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commitTag(); } }}/></div>}</div>
          <div className="toolbar" role="toolbar" aria-label="文字格式">
            <IconButton title="标题" active={editor?.isActive('heading')} disabled={readOnly} onClick={() => editor?.chain().focus().toggleHeading({level:2}).run()}><Heading2 size={18}/></IconButton>
            <IconButton title="加粗 Ctrl+B" active={editor?.isActive('bold')} disabled={readOnly} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold size={16}/></IconButton>
            <IconButton title="斜体 Ctrl+I" active={editor?.isActive('italic')} disabled={readOnly} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic size={16}/></IconButton><i/>
            <IconButton title="项目列表" active={editor?.isActive('bulletList')} disabled={readOnly} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List size={18}/></IconButton>
            <IconButton title="编号列表" active={editor?.isActive('orderedList')} disabled={readOnly} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered size={18}/></IconButton>
            <IconButton title="插入网页链接" active={editor?.isActive('link')} disabled={readOnly} onClick={() => setLinkValue(editor?.getAttributes('link').href ?? 'https://')}><Link size={16}/></IconButton><i/>
            <IconButton title="添加图片或附件" disabled={readOnly} onClick={() => void pickFiles()}><ImagePlus size={17}/></IconButton>
            <span className="toolbar-spacer"/>
            <IconButton title="撤销 Ctrl+Z" disabled={readOnly || !editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={16}/></IconButton>
            <IconButton title="重做 Ctrl+Y" disabled={readOnly || !editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={16}/></IconButton>
          </div>
          {editor?.isActive('image') && !readOnly && <div className="image-controls"><Maximize2 size={13}/><span>图片大小</span>{[280,560,800].map(w => <button key={w} onClick={() => editor.chain().focus().updateAttributes('image', {width:w}).run()}>{w === 280 ? '小' : w === 560 ? '中' : '大'}</button>)}<span>· 点击图片查看原图</span></div>}
          <EditorContent editor={editor}/>
          <section className="attachments-section"><div className="section-label"><Paperclip size={14}/><span>附件</span><b>{files.length || ''}</b>{!readOnly && <button onClick={() => void pickFiles()}><Plus size={13}/>添加附件</button>}</div>
            {files.length ? <div className="attachment-grid">{files.map(a => <button className="attachment-card" key={a.id} title={`打开 ${a.name}`} onClick={() => void api.openAttachment(a.id).catch(report)}><span className="file-icon"><FileText size={20}/></span><span><strong>{a.name}</strong><small>{sizeFor(a.size)} · 已保存副本</small></span><ArrowUpRight size={14}/></button>)}</div> : <p className="attachment-hint">把文件拖到这里，或点击添加。原文件移动后也能打开。</p>}
          </section>
        </article></div>
        <footer className="editor-footer"><span>{note.plainText.replace(/\s/g,'').length} 字<span className="footer-divider">·</span>{note.deletedAt ? '回收站' : '只属于你的记录'}</span><span><HardDrive size={12}/> 已保存在本地</span></footer>
      </> : <div className="welcome"><div className="welcome-illustration"><div className="paper paper-back"/><div className="paper paper-front"><NotebookPen size={43} strokeWidth={1.3}/><span/><span/><span/></div><div className="welcome-spark">✦</div></div><span className="eyebrow">A LITTLE SPACE FOR YOUR THOUGHTS</span><h2>{trash ? '让重要的记录回来' : '随时记下，慢慢整理。'}</h2><p>{trash ? '在左侧选择记录，即可查看或恢复。' : '一个想法、一张截图、一份文件，\n都可以安心放在这里。'}</p>{!trash && <button className="welcome-button" disabled={blocked} onClick={() => void newNote()}><Plus size={17}/>写下第一条记录</button>}<div className="welcome-features"><span><Check size={13}/>自动保存</span><span><HardDrive size={13}/>完全本地</span><span><FolderOpen size={13}/>随时搬走</span></div></div>}
    </main>
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleAlert size={17}/> : <Check size={17}/>}<span>{toast.message}</span><button aria-label="关闭提示" onClick={() => setToast(null)}><X size={15}/></button></div>}
    {operation && <div className="busy-overlay"><LoaderCircle size={28} className="spin"/><strong>正在处理本地数据</strong><span>请稍候，完成后就可以继续记录。</span></div>}
    {zoom && <div className="image-modal" role="dialog" aria-label="查看图片" onClick={() => setZoom(null)}><button aria-label="关闭图片"><X size={24}/></button><img src={zoom} alt="记录中的图片"/><span>点击任意位置或按 Esc 关闭</span></div>}
    {linkValue !== null && <div className="modal-backdrop" onClick={() => setLinkValue(null)}><div className="help-dialog" role="dialog" aria-label="插入网页链接" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="关闭链接设置" onClick={() => setLinkValue(null)}><X size={19}/></button><h2>添加一个网页链接</h2><p>输入 http:// 或 https:// 开头的网址。留空可以移除当前链接。</p><form className="link-form" onSubmit={e => { e.preventDefault(); const href = linkValue.trim(); if (!href) editor?.chain().focus().extendMarkRange('link').unsetLink().run(); else if (/^https?:\/\//i.test(href)) editor?.chain().focus().extendMarkRange('link').setLink({href}).run(); else { notify('请输入 http:// 或 https:// 开头的网页地址', true); return; } setLinkValue(null); }}><input aria-label="网页地址" autoFocus value={linkValue} onChange={e => setLinkValue(e.target.value)}/><button type="submit">确定</button></form></div></div>}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><div className="help-dialog" role="dialog" aria-label="使用说明" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="关闭说明" onClick={() => setHelp(false)}><X size={19}/></button><div className="brand-icon"><NotebookPen size={24}/></div><h2>用起来，就这么简单。</h2><p>点击新建，直接输入。文字自动保存；截图可以粘贴，图片和文件可以拖入。标签输入后按回车即可添加。</p><div className="shortcut-help"><span><kbd>Ctrl N</kbd> 新建记录</span><span><kbd>Ctrl F</kbd> 搜索记录</span><span><kbd>Ctrl S</kbd> 立即保存</span></div><p>再次打开会回到上次查看的记录。连续点击新建时，会继续使用当前的空白记录。</p><p>关闭窗口就会退出软件。换电脑前，先关闭软件，再复制<strong>整个软件文件夹</strong>，包含里面的“我的数据”。</p><p>每天首次打开时自动备份，保留最近七份。也可以在“数据与设置”中手动备份到U盘。恢复前会校验文件，并备份现有记录。</p><p>导出后，双击“打开我的记录.html”即可用浏览器查看。搜索范围为标题、正文、标签和附件名称。</p><div className="data-location"><span>你的数据位置</span><code>{info?.dataDir}</code><button onClick={() => void api.openDataDir().catch(report)}><FolderOpen size={14}/>打开文件夹</button></div><small>随手记 {info?.version} · {info?.lastBackup ? `最近备份：${info.lastBackup}` : '尚无手动备份'}</small></div></div>}
  </div>;
}
