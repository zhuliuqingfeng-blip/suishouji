import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createClosedBackup, validateBackup} from './archive.js';
import {Store, sha256} from './store.js';

export function importWorkDir(target: string) { return path.join(path.dirname(target), '.' + path.basename(target) + '-迁移'); }
function inside(root: string, relative: string) {
  const result = path.resolve(root, relative), part = path.relative(root, result);
  if (!part || part.startsWith('..') || path.isAbsolute(part)) throw new Error('迁移文件路径无效');
  return result;
}
function exists(file: string) { return fs.existsSync(file); }
export function emptyData(root: string) {
  const database = path.join(root, 'notes.sqlite');
  if (!exists(database)) {
    if(exists(path.join(root,'attachments')) && fs.readdirSync(path.join(root,'attachments')).length) return false;
    return true;
  }
  const db = new DatabaseSync(database, {readOnly: true});
  try {
    if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notes'").get())throw new Error('现有资料无法识别，已停止导入');
    for (const table of ['notes', 'attachments', 'important_days']) {
      if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) && Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n)) return false;
    }
    return true;
  } finally { db.close(); }
}
export function legacyRoot(selected: string, target: string) {
  let root = path.resolve(selected);
  if (!exists(path.join(root, 'notes.sqlite')) && exists(path.join(root, '我的数据', 'notes.sqlite'))) root = path.join(root, '我的数据');
  root = fs.realpathSync(root);
  const realTarget = exists(target) ? fs.realpathSync(target) : path.resolve(target);
  for (const [a,b] of [[root,realTarget],[realTarget,root],[root,importWorkDir(realTarget)]]) {
    const relative = path.relative(a,b);
    if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw new Error('请选择独立的旧版软件文件夹，不能选择当前资料或其上级目录');
  }
  if (!exists(path.join(root, 'notes.sqlite'))) throw new Error('没有找到旧版数据，请选择旧版软件文件夹或其中的“我的数据”');
  if (exists(path.join(root, '.restore-state.json')) || exists(path.join(root, 'notes.sqlite-journal')) || exists(path.join(root, 'notes.sqlite-wal'))) throw new Error('旧版可能尚未正常退出。请先打开旧版，等待保存完成并关闭，再重新导入');
  const db = new DatabaseSync(path.join(root, 'notes.sqlite'), {readOnly: true});
  try {
    if (db.prepare('PRAGMA quick_check').get()!.quick_check !== 'ok') throw new Error('旧版数据库校验失败，原数据未修改');
    const columns = (table: string) => db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
    if (!['id','title','document','plainText','tags','deletedAt'].every(name => columns('notes').includes(name)) || !['id','noteId','relativePath'].every(name => columns('attachments').includes(name))) throw new Error('所选文件夹不是可识别的随手记数据');
    if (Number(db.prepare('PRAGMA user_version').get()!.user_version) > 3) throw new Error('这些数据来自更新版本，请先安装更新的随手记');
    return {root, notes: Number(db.prepare('SELECT count(*) AS n FROM notes WHERE deletedAt IS NULL').get()!.n),
      trash: Number(db.prepare('SELECT count(*) AS n FROM notes WHERE deletedAt IS NOT NULL').get()!.n),
      days: columns('important_days').length ? Number(db.prepare('SELECT count(*) AS n FROM important_days').get()!.n) : 0};
  } finally { db.close(); }
}

// Copy settings that belong to the product, not GPU caches or Chromium process locks.
async function sourceFiles(root: string, directory = root): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await fsp.readdir(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name), relative = path.relative(root, file);
    if (entry.isSymbolicLink()) throw new Error('旧版数据中含有链接，无法安全导入');
    if (relative === '.运行缓存') {
      for (const name of ['window-state.json', 'Local Storage']) {
        const settings = path.join(file, name);
        if (!exists(settings)) continue;
        const stat = await fsp.lstat(settings);
        if (stat.isSymbolicLink()) throw new Error('旧版设置中含有链接，无法安全导入');
        if (stat.isDirectory()) result.push(...await sourceFiles(root, settings)); else if (stat.isFile()) result.push(path.relative(root, settings));
      }
    } else if (entry.isDirectory()) result.push(...await sourceFiles(root, file));
    else if (entry.isFile()) result.push(relative);
  }
  return result.sort();
}
async function copyChecked(source: string, destination: string, files: string[]) {
  for (const relative of files) {
    const from = inside(source, relative), to = inside(destination, relative);
    await fsp.mkdir(path.dirname(to), {recursive: true});
    await fsp.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    if (await sha256(from) !== await sha256(to)) throw new Error('复制校验失败，旧版数据未修改');
  }
}
function writeJSON(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temp = file + '.tmp'; fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  const fd = fs.openSync(temp, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
interface Journal { id: string; committed: boolean; items: {relative: string; existed: boolean}[] }
export function recoverLegacyImport(target: string) {
  const work = importWorkDir(target), file = path.join(work, 'journal.json');
  if (!exists(file)) return;
  const journal = JSON.parse(fs.readFileSync(file, 'utf8')) as Journal;
  if (!/^[a-f\d-]{36}$/.test(journal.id) || typeof journal.committed !== 'boolean' || !Array.isArray(journal.items)) throw new Error('迁移恢复记录损坏，请保留现有资料并联系维护者');
  const operation = inside(work, journal.id), stage = path.join(operation, 'stage'), old = path.join(operation, '原安装版资料');
  for (const item of journal.items) {
    if (typeof item.relative !== 'string' || typeof item.existed !== 'boolean') throw new Error('迁移恢复记录无效');
    inside(target,item.relative); inside(stage,item.relative); inside(old,item.relative);
    if (item.relative.startsWith('.运行缓存' + path.sep) && !['.运行缓存'+path.sep+'Local Storage','.运行缓存'+path.sep+'window-state.json'].includes(item.relative)) throw new Error('迁移设置路径无效');
  }
  if (!journal.committed) for (const item of [...journal.items].reverse()) {
    const current = inside(target,item.relative), previous = inside(old,item.relative), pending = inside(stage,item.relative);
    if (exists(previous)) {
      if (exists(current)) { const failed = inside(operation, path.join('未完成的新资料', item.relative)); fs.mkdirSync(path.dirname(failed),{recursive:true}); fs.renameSync(current,failed); }
      fs.mkdirSync(path.dirname(current),{recursive:true}); fs.renameSync(previous,current);
    } else if (!item.existed && !exists(pending) && exists(current)) {
      const failed = inside(operation,path.join('未完成的新资料', item.relative)); fs.mkdirSync(path.dirname(failed),{recursive:true}); fs.renameSync(current,failed);
    }
  }
  fs.unlinkSync(file);
  if(journal.committed)clearLegacyRequest(target);
}
export function requestLegacyImport(target: string, selected: string) {
  if (!emptyData(target)) throw new Error('当前已有手记或重要日子。为避免覆盖，不能从旧版导入；如需替换资料，请使用“从备份恢复”');
  const source = legacyRoot(selected,target);
  writeJSON(path.join(importWorkDir(target),'pending.json'), {source:source.root});
}
export function pendingLegacyImport(target: string): string | null {
  const file = path.join(importWorkDir(target),'pending.json');
  if (!exists(file)) return null;
  const value = JSON.parse(fs.readFileSync(file,'utf8')) as {source: unknown};
  if (typeof value.source !== 'string' || !path.isAbsolute(value.source)) throw new Error('旧版导入请求无效');
  return value.source;
}
export function clearLegacyRequest(target: string) { fs.rmSync(path.join(importWorkDir(target),'pending.json'),{force:true}); }

export async function importLegacyData(target: string, selected: string, options: {
  ensureClosed: (root: string) => Promise<void>;
  checkpoint?: (step: string) => void;
  origin?: string;
  verify?: (target:string) => Promise<void>;
}) {
  recoverLegacyImport(target);
  if (!emptyData(target)) throw new Error('当前已有资料，导入已停止，现有内容未更改');
  const source = legacyRoot(selected,target); await options.ensureClosed(source.root);
  const id = randomUUID(), work = importWorkDir(target), operation = inside(work,id);
  const original = path.join(operation,'原始免安装数据'), stage = path.join(operation,'stage'), old = path.join(operation,'原安装版资料');
  const files = await sourceFiles(source.root);
  await copyChecked(source.root,original,files);
  await options.ensureClosed(source.root);
  if (JSON.stringify(files) !== JSON.stringify(await sourceFiles(source.root))) throw new Error('旧版数据在导入期间发生变化，请关闭旧版后重试');
  for (const relative of files) if (await sha256(inside(source.root,relative)) !== await sha256(inside(original,relative))) throw new Error('旧版数据在导入期间发生变化，已停止导入');
  const backup = path.join(operation,'迁移前完整数据.zip'); await createClosedBackup(original,backup);
  const validated = await validateBackup(backup);
  // validateBackup creates this exclusively owned temporary directory.
  await fsp.rm(validated.stage,{recursive:true,force:true});
  await copyChecked(original,stage,files);
  const store = new Store(stage); store.close();
  await options.ensureClosed(source.root);
  await fsp.mkdir(path.join(stage,'attachments'),{recursive:true});
  writeJSON(path.join(stage,'迁移记录.json'),{from:options.origin??source.root,at:new Date().toISOString(),backup:operation,notes:source.notes,trash:source.trash,days:source.days});
  const relatives = (await fsp.readdir(stage)).filter(name=>name!=='.运行缓存');
  for (const name of ['Local Storage','window-state.json']) if (exists(path.join(stage,'.运行缓存',name))) relatives.push(path.join('.运行缓存',name));
  const journal: Journal = {id,committed:false,items:relatives.map(relative=>({relative,existed:exists(inside(target,relative))}))};
  await fsp.mkdir(target,{recursive:true});
  writeJSON(path.join(work,'journal.json'),journal);
  try {
    options.checkpoint?.('prepared');
    for (const item of journal.items) {
      const current=inside(target,item.relative), previous=inside(old,item.relative), next=inside(stage,item.relative);
      if(item.existed){await fsp.mkdir(path.dirname(previous),{recursive:true});await fsp.rename(current,previous);}
      options.checkpoint?.('old-moved:'+item.relative);
      await fsp.mkdir(path.dirname(current),{recursive:true});await fsp.rename(next,current);
      options.checkpoint?.('installed:'+item.relative);
    }
    await options.verify?.(target);
    journal.committed=true;writeJSON(path.join(work,'journal.json'),journal);
    options.checkpoint?.('committed');
    recoverLegacyImport(target);clearLegacyRequest(target);
    return {backupRoot:operation,notes:source.notes,trash:source.trash,days:source.days};
  } catch (error) { recoverLegacyImport(target); throw error; }
}
