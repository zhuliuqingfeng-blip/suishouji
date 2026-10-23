import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import * as yazl from 'yazl';
import * as yauzl from 'yauzl';
import { Store, sha256, displayTitle } from './store.js';
import type { RichNode } from './shared.js';
import type {Attachment} from './shared.js';
import {DatabaseSync} from 'node:sqlite';
import {validateImportantDay} from './important-days.js';

interface Manifest { format: 'suishouji-backup'; version: 1; createdAt: string; files: { path: string; size: number; sha256: string }[] }
const validEntry = (name: string) => name === 'manifest.json' || name === 'notes.sqlite' || /^attachments\/[a-f\d-]{36}\.[a-z0-9]{1,10}$/.test(name);
export async function zipFiles(files: { source: string; name: string }[], destination: string) {
  const zip = new yazl.ZipFile(); const temp = `${destination}.partial`;
  try {
    const writing = pipeline(zip.outputStream, fs.createWriteStream(temp));
    zip.on('error', error => (zip.outputStream as Readable).destroy(error));
    for (const f of files) zip.addFile(f.source, f.name);
    zip.end(); await writing; await fsp.rename(temp, destination);
  } catch (error) { await fsp.rm(temp, { force: true }); throw error; }
}
export async function createBackup(store: Pick<Store,'snapshot'|'allAssets'|'assetPath'>, destination: string): Promise<void> {
  const stage = await fsp.mkdtemp(path.join(os.tmpdir(), 'suishouji-backup-'));
  try {
    store.snapshot(path.join(stage, 'notes.sqlite'));
    const files = [{ source: path.join(stage, 'notes.sqlite'), name: 'notes.sqlite' }, ...store.allAssets().map(a => ({ source: store.assetPath(a), name: a.relativePath }))];
    const manifest: Manifest = { format: 'suishouji-backup', version: 1, createdAt: new Date().toISOString(), files: [] };
    for (const f of files) manifest.files.push({ path: f.name, size: (await fsp.stat(f.source)).size, sha256: await sha256(f.source) });
    await fsp.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await zipFiles([...files, { source: path.join(stage, 'manifest.json'), name: 'manifest.json' }], destination);
  } finally { await fsp.rm(stage, { recursive: true, force: true }); }
}
// Upgrade scripts must back up the old schema before a new Store can migrate it.
// The application must have completed its normal close before calling this.
export async function createClosedBackup(root:string,destination:string) {
  const db=new DatabaseSync(path.join(root,'notes.sqlite'),{readOnly:true});
  try {
    if((db.prepare('PRAGMA quick_check').get() as Record<string,string>).quick_check!=='ok')throw new Error('升级前数据校验未通过');
    await createBackup({snapshot:file=>{db.prepare('VACUUM INTO ?').run(file);},allAssets:()=>db.prepare('SELECT * FROM attachments').all() as unknown as Attachment[],assetPath:a=>{
      if(!/^attachments\/[a-f\d-]{36}\.[a-z0-9]{1,10}$/.test(a.relativePath))throw new Error('附件路径无效');return path.join(root,...a.relativePath.split('/'));
    }},destination);
    return {active:Number(db.prepare('SELECT count(*) AS n FROM notes WHERE deletedAt IS NULL').get()!.n),trash:Number(db.prepare('SELECT count(*) AS n FROM notes WHERE deletedAt IS NOT NULL').get()!.n)};
  }finally{db.close();}
}
async function extractBackup(file: string, destination: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(new Error('无法读取备份文件，文件可能已损坏')); return; }
      const names = new Set<string>(); let failed = false;
      const fail = (e: unknown) => { if (!failed) { failed = true; zip.close(); reject(e); } };
      zip.on('error', fail); zip.on('end', () => { if (!failed) resolve([...names]); });
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName;
        if (!validEntry(name) || names.has(name) || (entry.externalFileAttributes >>> 16 & 0o170000) === 0o120000 || entry.generalPurposeBitFlag & 1) { fail(new Error('备份包含无效路径、重复项目或不支持的文件')); return; }
        if (name === 'manifest.json' && entry.uncompressedSize > 20_000_000) { fail(new Error('备份清单过大')); return; }
        names.add(name);
        zip.openReadStream(entry, async (streamError, stream) => {
          if (streamError || !stream) { fail(new Error('备份内容读取失败')); return; }
          try { const target = path.join(destination, ...name.split('/')); await fsp.mkdir(path.dirname(target), { recursive: true }); await pipeline(stream, fs.createWriteStream(target, { flags: 'wx' })); zip.readEntry(); }
          catch (e) { fail(e); }
        });
      });
      zip.readEntry();
    });
  });
}
export async function validateBackup(file: string): Promise<{ stage: string; count: number; dayCount:number; createdAt: string }> {
  const stage = await fsp.mkdtemp(path.join(os.tmpdir(), 'suishouji-restore-'));
  try {
    const entries = await extractBackup(file, stage);
    const manifest = JSON.parse(await fsp.readFile(path.join(stage, 'manifest.json'), 'utf8')) as Manifest;
    if (manifest.format !== 'suishouji-backup' || manifest.version !== 1 || !Array.isArray(manifest.files) || !Number.isFinite(Date.parse(manifest.createdAt))) throw new Error('这不是受支持的随手记备份');
    const expected = new Set(['manifest.json']);
    for (const f of manifest.files) {
      if (!validEntry(f.path) || f.path === 'manifest.json' || expected.has(f.path) || !/^[a-f0-9]{64}$/.test(f.sha256)) throw new Error('备份清单无效');
      expected.add(f.path); const target = path.join(stage, ...f.path.split('/'));
      if (!entries.includes(f.path) || (await fsp.stat(target)).size !== f.size || await sha256(target) !== f.sha256) throw new Error('备份校验失败，文件不完整或已损坏；现有数据未改动');
    }
    if (!expected.has('notes.sqlite') || entries.length !== expected.size) throw new Error('备份文件与清单不一致');
    const check = new Store(stage);
    try {
      if (check.db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('备份中的附件关联无效');
      for (const a of check.allAssets()) if (!expected.has(a.relativePath) || !fs.existsSync(check.assetPath(a))) throw new Error('备份缺少附件');
      for (const n of [...check.list(), ...check.list({ trash: true })]) {
        const detail = check.get(n.id);
        const { normalizeDocument } = await import('./store.js');
        normalizeDocument(detail.note.document, new Set(detail.attachments.filter(a => a.kind === 'image').map(a => a.id)));
      }
      for(const day of check.listImportantDays())validateImportantDay(day);
      return { stage, count: check.overview().active + check.overview().trash, dayCount:check.listImportantDays().length, createdAt: manifest.createdAt };
    } finally { check.close(); }
  } catch (error) { await fsp.rm(stage, { recursive: true, force: true }); throw error; }
}

// Keep a disk journal so an interrupted restore rolls back at next startup.
function writeJournal(file: string, state: unknown) {
  const temporary = `${file}.tmp`; fs.writeFileSync(temporary, JSON.stringify(state));
  const fd = fs.openSync(temporary, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
}
export function recoverInterruptedRestore(root: string) {
  const journal = path.join(root, '.restore-state.json'); if (!fs.existsSync(journal)) return;
  const state = JSON.parse(fs.readFileSync(journal, 'utf8')) as { committed: boolean; moved: string[]; installed: string[] };
  const old = path.join(root, '.restore-old');
  if (!state.committed) for (const name of ['notes.sqlite', 'attachments']) {
    if (fs.existsSync(path.join(old, name))) {
      fs.rmSync(path.join(root, name), { recursive: true, force: true }); fs.renameSync(path.join(old, name), path.join(root, name));
    }
  }
  fs.rmSync(old, { recursive: true, force: true }); fs.rmSync(journal, { force: true });
  fs.rmSync(path.join(root, '.restore-new'), { recursive: true, force: true });
}
export function applyRestore(store: Store, stage: string) {
  const root = store.root, old = path.join(root, '.restore-old'), journal = path.join(root, '.restore-state.json');
  // Stage on the destination volume: Windows cannot rename from C: temp to D: data.
  const localStage = path.join(root, '.restore-new');
  fs.rmSync(localStage, { recursive: true, force: true }); fs.mkdirSync(localStage, { recursive: true });
  try { for (const name of ['notes.sqlite', 'attachments']) fs.cpSync(path.join(stage, name), path.join(localStage, name), { recursive: true }); }
  catch (error) { fs.rmSync(localStage, { recursive: true, force: true }); throw error; }
  const state = { committed: false, moved: [] as string[], installed: [] as string[] };
  fs.mkdirSync(old, { recursive: true }); writeJournal(journal, state); store.close();
  try {
    for (const name of ['notes.sqlite', 'attachments']) {
      if (fs.existsSync(path.join(root, name))) fs.renameSync(path.join(root, name), path.join(old, name));
      state.moved.push(name); writeJournal(journal, state);
      fs.renameSync(path.join(localStage, name), path.join(root, name)); state.installed.push(name); writeJournal(journal, state);
    }
    store.db = new Store(root).db;
    state.committed = true; writeJournal(journal, state);
  } catch (error) { recoverInterruptedRestore(root); store.db = new Store(root).db; throw error; }
  recoverInterruptedRestore(root);
  fs.rmSync(localStage, { recursive: true, force: true });
}

const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function renderNode(node: RichNode, assets: Map<string, string>): string {
  if (node.type === 'text') {
    let text = escapeHtml(node.text);
    for (const m of node.marks ?? []) {
      const tag = ({ bold: 'strong', italic: 'em', underline: 'u', strike: 's', code: 'code' } as Record<string, string>)[m.type];
      if (tag) text = `<${tag}>${text}</${tag}>`;
      else if (m.type === 'link' && /^https?:\/\//i.test(String(m.attrs?.href))) text = `<a href="${escapeHtml(m.attrs?.href)}">${text}</a>`;
    }
    return text;
  }
  if (node.type === 'image') { const file = assets.get(String(node.attrs?.assetId)); return file ? `<img src="${escapeHtml(file)}" alt="${escapeHtml(node.attrs?.alt)}" style="width:${Number(node.attrs?.width) || 560}px;max-width:100%;height:auto">` : ''; }
  if (node.type === 'hardBreak') return '<br>'; if (node.type === 'horizontalRule') return '<hr>';
  const content = (node.content ?? []).map(n => renderNode(n, assets)).join('');
  if(node.type==='orderedList'){const start=Number(node.attrs?.start);return `<ol${Number.isSafeInteger(start)&&start>1?` start="${start}"`:''}>${content}</ol>`;}
  const tag = node.type === 'heading' ? `h${Math.min(3, Math.max(1, Number(node.attrs?.level) || 2))}` : ({ paragraph: 'p', bulletList: 'ul', orderedList: 'ol', listItem: 'li', blockquote: 'blockquote', codeBlock: 'pre' } as Record<string, string>)[node.type ?? ''];
  return tag ? `<${tag}>${content}</${tag}>` : content;
}
export async function exportHtml(store: Store, destination: string, id?: string) {
  await fsp.mkdir(path.join(destination, '附件'), { recursive: true });
  const notes = id ? [store.get(id).note] : store.list().map(n => store.get(n.id).note);
  const index: string[] = [];
  for (const note of notes) {
    const { attachments } = store.get(note.id); const assetMap = new Map<string, string>();
    for (const a of attachments) {
      const relative = `附件/${path.basename(a.relativePath)}`; await fsp.copyFile(store.assetPath(a), path.join(destination, relative)); assetMap.set(a.id, relative);
    }
    const title = displayTitle(note), file = `${note.id}.html`;
    const attachmentHtml = attachments.filter(a => a.kind === 'file').map(a => `<li><a href="${escapeHtml(assetMap.get(a.id))}">${escapeHtml(a.name)}</a></li>`).join('');
    await fsp.writeFile(path.join(destination, file), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file:; style-src 'unsafe-inline'"><title>${escapeHtml(title)}</title><style>body{max-width:880px;margin:48px auto;padding:0 24px;font:16px/1.8 'Microsoft YaHei',sans-serif;color:#303347}a{color:#535ca8}img{display:block;margin:16px 0}pre{white-space:pre-wrap}small{color:#71768a}</style><h1>${escapeHtml(title)}</h1><small>${escapeHtml(new Date(note.updatedAt).toLocaleString('zh-CN'))} · ${escapeHtml(note.tags.join(' / '))}</small>${renderNode(note.document, assetMap)}${attachmentHtml ? `<h2>附件</h2><ul>${attachmentHtml}</ul>` : ''}</html>`, 'utf8');
    index.push(`<li><a href="${file}">${escapeHtml(title)}</a></li>`);
  }
  await fsp.writeFile(path.join(destination, '打开我的记录.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>我的随手记</title><style>body{max-width:800px;margin:48px auto;font:16px/2 'Microsoft YaHei',sans-serif}a{color:#535ca8}</style><h1>我的随手记</h1><p>共 ${notes.length} 条记录</p><ul>${index.join('')}</ul></html>`, 'utf8');
}
