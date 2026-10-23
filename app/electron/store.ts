import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Attachment, BatchResult, Filter, Note, NoteDetail, NoteInput, NoteSummary, Overview, RichNode } from './shared.js';
import type {ImportantDay,ImportantDayInput,DayReminder} from './shared.js';
import {validateImportantDay,reminderFor,orderedDays} from './important-days.js';

export const EMPTY_DOC: RichNode = { type: 'doc', content: [{ type: 'paragraph' }] };
export const imageMime: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' };
function assertId(id: string) { if (typeof id !== 'string' || !/^[a-f\d-]{36}$/.test(id)) throw new Error('记录编号无效'); }
export function plainText(doc: RichNode): string {
  if (doc.text) return doc.text;
  const result = (doc.content ?? []).map(plainText).join(['doc', 'bulletList', 'orderedList'].includes(doc.type ?? '') ? '\n' : '');
  return result + (['paragraph', 'heading', 'listItem'].includes(doc.type ?? '') ? '\n' : '');
}
export function displayTitle(note: Pick<Note, 'title' | 'plainText'>) { return note.title.trim() || note.plainText.trim().split('\n')[0]?.slice(0, 60) || '未命名记录'; }
export function normalizeDocument(doc: RichNode, assets: Set<string>): RichNode {
  const allowed = new Set(['doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'hardBreak', 'horizontalRule', 'image', 'codeBlock']);
  let count = 0;
  function walk(node: RichNode, depth = 0): RichNode {
    if (++count > 100000 || depth > 100 || !node || !allowed.has(node.type ?? '')) throw new Error('记录内容格式无效或过长');
    const clean: RichNode = { type: node.type };
    if (node.type === 'text') { if (typeof node.text !== 'string') throw new Error('文字格式无效'); clean.text = node.text; }
    if (node.type === 'image') {
      const id = String(node.attrs?.assetId ?? '');
      if (!assets.has(id)) throw new Error('图片尚未保存，请重新添加图片');
      clean.attrs = { assetId: id, src: `app-asset://media/${id}`, alt: String(node.attrs?.alt ?? ''), width: Math.max(80, Math.min(1600, Number(node.attrs?.width) || 560)) };
    } else if (node.type === 'heading') clean.attrs = { level: Math.max(1, Math.min(3, Number(node.attrs?.level) || 2)) };
    else if (node.type === 'orderedList') clean.attrs = { start: Math.max(1, Number(node.attrs?.start) || 1) };
    if (node.marks) clean.marks = node.marks.filter(m => ['bold', 'italic', 'strike', 'code', 'underline', 'link'].includes(m.type)).flatMap(m => {
      if (m.type !== 'link') return [{ type: m.type }];
      const href = String(m.attrs?.href ?? '');
      return /^https?:\/\//i.test(href) ? [{ type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer' } }] : [];
    });
    if (node.content) { if (!Array.isArray(node.content)) throw new Error('记录格式无效'); clean.content = node.content.map(n => walk(n, depth + 1)); }
    return clean;
  }
  if (doc?.type !== 'doc' || JSON.stringify(doc).length > 10_000_000) throw new Error('记录内容格式无效或超过10MB');
  return walk(doc);
}

export class Store {
  db: DatabaseSync;
  private deletionClock = 0;
  private undoBatches = new Map<string, { ids: string[]; timestamp: string; expiresAt: number }>();
  readonly databasePath: string;
  constructor(readonly root: string) {
    fs.mkdirSync(path.join(root, 'attachments'), { recursive: true });
    this.databasePath = path.join(root, 'notes.sqlite');
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version > 3) { this.db.close(); throw new Error('数据来自更新版本，请使用更新的随手记打开'); }
    try {this.transaction(()=>{
    this.db.exec(`CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, document TEXT NOT NULL, plainText TEXT NOT NULL,
      tags TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, deletedAt TEXT);
      CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, noteId TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, kind TEXT NOT NULL, relativePath TEXT NOT NULL UNIQUE);
      CREATE INDEX IF NOT EXISTS attachment_note ON attachments(noteId);
      CREATE TABLE IF NOT EXISTS important_days (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, calendar TEXT NOT NULL, year INTEGER, month INTEGER NOT NULL, day INTEGER NOT NULL,
      yearly INTEGER NOT NULL, reminderDays INTEGER NOT NULL, note TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS day_reminders (
      key TEXT PRIMARY KEY, dayId TEXT NOT NULL REFERENCES important_days(id) ON DELETE CASCADE, seenAt TEXT NOT NULL);`);
    const columns=this.db.prepare('PRAGMA table_info(important_days)').all();
    if(!columns.some(c=>c.name==='isLeapMonth'))this.db.exec('ALTER TABLE important_days ADD COLUMN isLeapMonth INTEGER NOT NULL DEFAULT 0 CHECK(isLeapMonth IN (0,1));');
    this.db.exec('PRAGMA user_version=3;');
    });}catch(error){this.db.close();throw error;}
    if ((this.db.prepare('PRAGMA quick_check').get() as Record<string, string>).quick_check !== 'ok') throw new Error('数据检查未通过，请从备份恢复，原数据已保留');
    this.recoverDeletions();
  }
  close() { this.db.close(); }
  listImportantDays():ImportantDay[] {
    return this.db.prepare('SELECT * FROM important_days ORDER BY createdAt,id').all().map(row=>{
      if(row.yearly!==0&&row.yearly!==1||row.isLeapMonth!==0&&row.isLeapMonth!==1)throw new Error('重要日子的重复或闰月数据无效');
      return {...row,yearly:Boolean(row.yearly),isLeapMonth:Boolean(row.isLeapMonth)} as unknown as ImportantDay;
    });
  }
  saveImportantDay(input:ImportantDayInput):ImportantDay {
    const value=validateImportantDay(input),now=new Date().toISOString(),id=input.id??randomUUID();assertId(id);
    const old=this.listImportantDays().find(d=>d.id===id);
    if(input.id&&!old)throw new Error('找不到这个重要日子，请重新读取');
    this.transaction(()=>{
      this.db.prepare(`INSERT INTO important_days(id,name,calendar,year,month,day,isLeapMonth,yearly,reminderDays,note,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,calendar=excluded.calendar,year=excluded.year,month=excluded.month,day=excluded.day,isLeapMonth=excluded.isLeapMonth,yearly=excluded.yearly,reminderDays=excluded.reminderDays,note=excluded.note,updatedAt=excluded.updatedAt`)
        .run(id,value.name,value.calendar,value.year,value.month,value.day,Number(value.isLeapMonth),Number(value.yearly),value.reminderDays,value.note,old?.createdAt??now,now);
      if(old&&['calendar','year','month','day','isLeapMonth','yearly','reminderDays'].some(k=>old[k as keyof ImportantDay]!==value[k as keyof ImportantDayInput]))this.db.prepare('DELETE FROM day_reminders WHERE dayId=?').run(id);
    });
    return this.listImportantDays().find(d=>d.id===id)!;
  }
  removeImportantDay(id:string) {assertId(id);if(!this.db.prepare('DELETE FROM important_days WHERE id=?').run(id).changes)throw new Error('找不到这个重要日子');}
  pendingDayReminders(now=new Date()):DayReminder[] {
    return orderedDays(this.listImportantDays(),now).map(o=>reminderFor(o.entry,now)).filter((r):r is DayReminder=>!!r&&!this.db.prepare('SELECT key FROM day_reminders WHERE key=?').get(r.key));
  }
  acknowledgeDayReminders(keys:string[],now=new Date()) {
    if(!Array.isArray(keys)||keys.some(k=>typeof k!=='string'))throw new Error('提醒编号无效');
    const pending=this.pendingDayReminders(now).filter(r=>keys.includes(r.key));
    this.transaction(()=>{const stmt=this.db.prepare('INSERT OR IGNORE INTO day_reminders(key,dayId,seenAt) VALUES(?,?,?)');for(const r of pending)stmt.run(r.key,r.dayId,now.toISOString());});
  }
  private decode(row: Record<string, unknown>): Note {
    return { ...row, document: JSON.parse(String(row.document)), tags: JSON.parse(String(row.tags)), pinned: Boolean(row.pinned) } as unknown as Note;
  }
  get(id: string): NoteDetail {
    assertId(id);
    const row = this.db.prepare('SELECT * FROM notes WHERE id=?').get(id);
    if (!row) throw new Error('找不到这条记录');
    return { note: this.decode(row), attachments: this.db.prepare('SELECT * FROM attachments WHERE noteId=? ORDER BY rowid').all(id) as unknown as Attachment[] };
  }
  list(filter: Filter = {}): NoteSummary[] {
    const query = String(filter.query ?? '').trim().toLocaleLowerCase();
    const rows = this.db.prepare(`SELECT n.*, (SELECT count(*) FROM attachments a WHERE a.noteId=n.id AND a.kind='file') attachmentCount FROM notes n
      WHERE deletedAt IS ${filter.trash ? 'NOT ' : ''}NULL ORDER BY pinned DESC, updatedAt DESC`).all();
    return rows.map(row => { const { document: _, ...note } = this.decode(row); return { ...note, attachmentCount: Number(row.attachmentCount) }; })
      .filter(n => !filter.tag || n.tags.includes(filter.tag))
      .filter(n => !query || `${n.title}\n${n.plainText}\n${n.tags.join(' ')}\n${this.db.prepare('SELECT name FROM attachments WHERE noteId=?').all(n.id).map(a => a.name).join('\n')}`.toLocaleLowerCase().includes(query))
      .sort((a,b) => Number(b.pinned)-Number(a.pinned) || (filter.sort === 'title' ? displayTitle(a).localeCompare(displayTitle(b),'zh-CN') : filter.sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt)) || a.id.localeCompare(b.id));
  }
  overview(): Overview {
    const rows = this.list(); const tags = new Map<string, number>();
    for (const n of rows) for (const tag of n.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    return { active: rows.length, trash: this.list({ trash: true }).length, tags: [...tags].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN')).map(([name, count]) => ({ name, count })) };
  }
  create(): NoteDetail {
    const id = randomUUID(), now = new Date().toISOString();
    this.db.prepare('INSERT INTO notes(id,title,document,plainText,tags,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)').run(id, '', JSON.stringify(EMPTY_DOC), '', '[]', now, now);
    return this.get(id);
  }
  save(input: NoteInput): Note {
    const current = this.get(input.id); if (current.note.deletedAt) throw new Error('请先从回收站恢复记录');
    if (typeof input.title !== 'string' || input.title.length > 300) throw new Error('标题最多300字');
    if (!Array.isArray(input.tags) || input.tags.some(t => typeof t !== 'string')) throw new Error('标签格式无效');
    const tags = [...new Set(input.tags.map(t => t.trim()).filter(Boolean))];
    if (tags.length > 30 || tags.some(t => t.length > 30)) throw new Error('最多30个标签，每个标签最多30字');
    const document = normalizeDocument(input.document, new Set(current.attachments.filter(a => a.kind === 'image').map(a => a.id)));
    this.db.prepare('UPDATE notes SET title=?,document=?,plainText=?,tags=?,updatedAt=? WHERE id=?').run(input.title, JSON.stringify(document), plainText(document).trim(), JSON.stringify(tags), new Date().toISOString(), input.id);
    return this.get(input.id).note;
  }
  pin(id: string, pinned: boolean) { this.get(id); this.db.prepare('UPDATE notes SET pinned=? WHERE id=?').run(pinned ? 1 : 0, id); }
  trash(id: string) { this.trashMany([id]); }
  restore(id: string) { this.get(id); this.db.prepare('UPDATE notes SET deletedAt=NULL WHERE id=?').run(id); }
  validateBatch(ids: string[], deleted: boolean): string[] {
    if (!Array.isArray(ids) || !ids.length) throw new Error('请先选择记录');
    const unique = [...new Set(ids)];
    for (const id of unique) { const {note}=this.get(id); if (!!note.deletedAt !== deleted) throw new Error('记录状态已变化，请刷新列表后重试'); }
    return unique;
  }
  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN'); try { const result=action(); this.db.exec('COMMIT'); return result; } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  trashMany(ids: string[]): BatchResult {
    const unique=this.validateBatch(ids,false); this.deletionClock=Math.max(Date.now(),this.deletionClock+1);
    const timestamp=new Date(this.deletionClock).toISOString();
    this.transaction(()=>{const stmt=this.db.prepare('UPDATE notes SET deletedAt=? WHERE id=?'); for(const id of unique)stmt.run(timestamp,id);});
    for(const [key,value] of this.undoBatches)if(value.expiresAt<Date.now())this.undoBatches.delete(key);
    const token=randomUUID(),expiresAt=Date.now()+10000;this.undoBatches.set(token,{ids:unique,timestamp,expiresAt});
    return {succeeded:unique,failed:[],undo:{token,expiresAt}};
  }
  restoreMany(ids: string[]): BatchResult {
    const unique=this.validateBatch(ids,true);this.transaction(()=>{const stmt=this.db.prepare('UPDATE notes SET deletedAt=NULL WHERE id=?');for(const id of unique)stmt.run(id);});
    return {succeeded:unique,failed:[]};
  }
  undoDelete(token: string): BatchResult {
    const batch=this.undoBatches.get(token);this.undoBatches.delete(token);
    if(!batch||batch.expiresAt<Date.now())throw new Error('撤销时间已过，仍可在回收站中恢复记录');
    const succeeded:string[]=[];this.transaction(()=>{const stmt=this.db.prepare('UPDATE notes SET deletedAt=NULL WHERE id=? AND deletedAt=?');for(const id of batch.ids)if(stmt.run(id,batch.timestamp).changes)succeeded.push(id);});
    return {succeeded,failed:[]};
  }
  remove(id: string) { this.removeOne(id); }
  private removeOne(id: string): string | undefined {
    const detail=this.get(id);if(!detail.note.deletedAt)throw new Error('只有回收站中的记录可以永久删除');
    const stage=path.join(this.root,'.delete-pending',id);fs.mkdirSync(stage,{recursive:true});
    const moved:{source:string;target:string}[]=[];
    try {
      for(const a of detail.attachments){const source=this.assetPath(a);if(!fs.existsSync(source))continue;const target=path.join(stage,path.basename(source));fs.renameSync(source,target);moved.push({source,target});}
      this.transaction(()=>this.db.prepare('DELETE FROM notes WHERE id=?').run(id));
    }catch(error){for(const file of moved.reverse())fs.renameSync(file.target,file.source);fs.rmSync(stage,{recursive:true,force:true});throw error;}
    try{fs.rmSync(stage,{recursive:true,force:true});}catch{return '记录已删除，部分临时附件占用空间将在下次启动时清理';}
  }
  removeMany(ids: string[]): BatchResult {
    const unique=this.validateBatch(ids,true),result:BatchResult={succeeded:[],failed:[],warnings:[]};
    for(const id of unique)try{const warning=this.removeOne(id);result.succeeded.push(id);if(warning)result.warnings!.push(warning);}catch(error){result.failed.push({id,error:error instanceof Error?error.message:String(error)});}
    return result;
  }
  private recoverDeletions() {
    const root=path.join(this.root,'.delete-pending');if(!fs.existsSync(root))return;
    for(const id of fs.readdirSync(root)){
      if(!/^[a-f\d-]{36}$/.test(id))continue;
      const stage=path.join(root,id);if(!fs.statSync(stage).isDirectory())continue;
      if(this.db.prepare('SELECT id FROM notes WHERE id=?').get(id)){
        for(const a of this.get(id).attachments){const source=path.join(stage,path.basename(a.relativePath)),target=this.assetPath(a);if(fs.existsSync(source)&&!fs.existsSync(target))fs.renameSync(source,target);}
      }
      try{fs.rmSync(stage,{recursive:true,force:true});}catch{/* Retry committed file cleanup at next startup. */}
    }
  }
  attachment(id: string): Attachment {
    assertId(id); const row = this.db.prepare('SELECT * FROM attachments WHERE id=?').get(id);
    if (!row) throw new Error('找不到附件'); return row as unknown as Attachment;
  }
  assetPath(asset: Attachment): string {
    if (!/^attachments\/[a-f\d-]{36}\.[a-z0-9]{1,10}$/.test(asset.relativePath)) throw new Error('附件路径无效');
    return path.join(this.root, ...asset.relativePath.split('/'));
  }
  addFile(noteId: string, source: string): Attachment {
    if (!path.isAbsolute(source)) throw new Error('文件路径无效');
    const stat = fs.statSync(source); if (!stat.isFile()) throw new Error('暂不支持添加文件夹，请先压缩文件夹');
    const ext = path.extname(source).toLowerCase();
    return this.addAsset(noteId, path.basename(source), imageMime[ext] ?? 'application/octet-stream', stat.size, target => fs.copyFileSync(source, target));
  }
  addFiles(noteId: string, sources: string[]): Attachment[] {
    if (!Array.isArray(sources) || sources.length > 100) throw new Error('一次最多添加100个文件');
    const imported: Attachment[] = []; this.db.exec('BEGIN');
    try { for (const source of sources) imported.push(this.addFile(noteId, source)); this.db.exec('COMMIT'); return imported; }
    catch (error) { this.db.exec('ROLLBACK'); for (const a of imported) fs.rmSync(this.assetPath(a), { force: true }); throw error; }
  }
  addImage(noteId: string, bytes: Uint8Array, mime: string): Attachment {
    const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' } as Record<string, string>)[mime];
    if (!ext || !bytes.length || bytes.length > 100 * 1024 * 1024) throw new Error('图片格式不支持，或图片超过100MB');
    return this.addAsset(noteId, `粘贴图片-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`, mime, bytes.length, target => fs.writeFileSync(target, bytes));
  }
  private addAsset(noteId: string, name: string, mime: string, size: number, write: (target: string) => void): Attachment {
    if (this.get(noteId).note.deletedAt) throw new Error('回收站中的记录不能添加附件');
    const id = randomUUID(); const ext = path.extname(name).slice(1).toLowerCase();
    const relativePath = `attachments/${id}.${/^[a-z0-9]{1,10}$/.test(ext) ? ext : 'bin'}`;
    const asset: Attachment = { id, noteId, name, mime, size, kind: mime.startsWith('image/') ? 'image' : 'file', relativePath };
    const target = this.assetPath(asset); const temp = `${target}.tmp`;
    try {
      write(temp); fs.renameSync(temp, target);
      this.db.prepare('INSERT INTO attachments(id,noteId,name,mime,size,kind,relativePath) VALUES(?,?,?,?,?,?,?)').run(id, noteId, name, mime, size, asset.kind, relativePath);
    } catch (error) { fs.rmSync(temp, { force: true }); fs.rmSync(target, { force: true }); throw error; }
    return asset;
  }
  allAssets(): Attachment[] { return this.db.prepare('SELECT * FROM attachments').all() as unknown as Attachment[]; }
  snapshot(destination: string) { this.db.prepare('VACUUM INTO ?').run(destination); }
}

export async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk); return hash.digest('hex');
}
