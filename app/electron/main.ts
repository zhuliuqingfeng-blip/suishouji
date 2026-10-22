import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, protocol, net, shell, screen, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store } from './store.js';
import { createBackup, validateBackup, applyRestore, recoverInterruptedRestore, exportHtml } from './archive.js';
import type { Filter, NoteInput, TextMenuAction, TextMenuOptions } from './shared.js';
import { fitWindow,readWindowState,writeWindowState } from './window-state.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const testMode = process.env.NOTES_TEST_MODE === '1';
const dataDir = (testMode && process.env.NOTES_DATA_DIR) || (app.isPackaged ? path.join(path.dirname(app.getPath('exe')), '我的数据') : path.resolve('.local-data'));
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', path.join(dataDir, '.运行缓存'));
protocol.registerSchemesAsPrivileged([{ scheme: 'app-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
let win: BrowserWindow | null = null, store: Store, busy = false, mayClose = false, backupWarning: string | null = null, lastBackup: string | null = null;
const lock = app.requestSingleInstanceLock(); if (!lock) app.quit();
app.on('second-instance', () => { win?.show(); if (win?.isMinimized()) win.restore(); win?.focus(); });
function dateStamp() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function fileStamp() { return `${dateStamp()}-${new Date().toTimeString().slice(0,8).replaceAll(':','')}`; }
async function exclusive<T>(action: () => Promise<T>): Promise<T> {
  if (busy) throw new Error('正在处理数据，请稍候'); busy = true; win?.webContents.send('notes:operation', true);
  try { return await action(); } finally { busy = false; win?.webContents.send('notes:operation', false); }
}
async function dailyBackup() {
  const directory = path.join(dataDir, '自动备份'); await fsp.mkdir(directory, { recursive: true });
  const archives = (await fsp.readdir(directory)).filter(n => /^自动备份-\d{4}-\d{2}-\d{2}\.zip$/.test(n)).sort();
  const file = `自动备份-${dateStamp()}.zip`;
  if (!archives.includes(file)) { await createBackup(store, path.join(directory, file)); archives.push(file); }
  for (const name of archives.sort().slice(0, -7)) await fsp.rm(path.join(directory, name));
  lastBackup = (await fsp.stat(path.join(directory,file))).mtime.toISOString();
}
const methods: Record<string, (...args: any[]) => unknown> = {
  list: (f: Filter) => store.list(f), overview: () => store.overview(), create: () => store.create(), get: (id: string) => store.get(id), save: (input: NoteInput) => store.save(input),
  pin: (id: string, pinned: boolean) => store.pin(id, pinned), trash: (id: string) => store.trash(id), restoreNote: (id: string) => store.restore(id),
  trashMany: async (ids:string[])=>{
    const unique=store.validateBatch(ids,false);
    if(unique.length>1){const answer=await dialog.showMessageBox(win!,{type:'question',title:'删除所选记录',message:`将 ${unique.length} 条记录移到回收站？`,detail:'删除后可立即撤销，也可从回收站恢复。',buttons:['取消','移到回收站'],defaultId:0,cancelId:0});if(answer.response!==1)return {succeeded:[],failed:[],cancelled:true};}
    return store.trashMany(unique);
  },
  restoreMany:(ids:string[])=>store.restoreMany(ids),undoDelete:(token:string)=>store.undoDelete(token),
  removeMany:async(ids:string[])=>{
    const unique=store.validateBatch(ids,true);const answer=await dialog.showMessageBox(win!,{type:'warning',title:'永久删除所选记录',message:`永久删除 ${unique.length} 条记录及其附件？`,detail:'此操作无法撤销。',buttons:['取消','永久删除'],defaultId:0,cancelId:0});
    return answer.response===1?store.removeMany(unique):{succeeded:[],failed:[],cancelled:true};
  },
  remove: async (id: string) => {
    const answer = await dialog.showMessageBox(win!, { type: 'warning', title: '永久删除', message: '永久删除这条记录和它的附件？', detail: '此操作无法在回收站中撤销。', buttons: ['取消', '永久删除'], defaultId: 0, cancelId: 0 });
    if (answer.response === 1) store.remove(id);
  },
  emptyTrash: async () => {
    const notes = store.list({ trash: true }); if (!notes.length) return;
    const answer = await dialog.showMessageBox(win!, { type: 'warning', title: '清空回收站', message: `永久删除回收站中的 ${notes.length} 条记录及附件？`, buttons: ['取消', '清空回收站'], defaultId: 0, cancelId: 0 });
    if (answer.response === 1) for (const n of notes) store.remove(n.id);
  },
  pickFiles: async (noteId: string) => {
    const picked = await dialog.showOpenDialog(win!, { title: '添加图片或附件', properties: ['openFile', 'multiSelections'] });
    if (picked.canceled) return []; return store.addFiles(noteId, picked.filePaths);
  },
  importPaths: (noteId: string, files: string[]) => store.addFiles(noteId, files),
  pasteImage: (noteId: string, bytes: Uint8Array, mime: string) => store.addImage(noteId, bytes, mime),
  openAttachment: async (id: string) => {
    const a = store.attachment(id); const file = store.assetPath(a);
    if (!fs.existsSync(file)) throw new Error('附件文件已丢失，可尝试从备份恢复');
    if (/\.(exe|com|bat|cmd|ps1|vbs|js|msi|scr|lnk)$/i.test(a.name)) {
      const answer = await dialog.showMessageBox(win!, { type: 'question', message: `打开可执行附件“${a.name}”？`, buttons: ['取消', '打开'], defaultId: 0, cancelId: 0 }); if (answer.response !== 1) return;
    }
    const error = await shell.openPath(file); if (error) throw new Error(`无法打开附件：${error}`);
  },
  openLink: async (url: string) => { if (!/^https?:\/\//i.test(url)) throw new Error('只支持打开 http 或 https 网页链接'); await shell.openExternal(url); },
  backup: async () => {
    const picked = await dialog.showSaveDialog(win!, { title: '备份全部记录', defaultPath: `随手记备份-${fileStamp()}.zip`, filters: [{ name: '随手记备份', extensions: ['zip'] }] });
    if (picked.canceled || !picked.filePath) return null;
    const destination = path.resolve(picked.filePath), relative = path.relative(dataDir, destination);
    if (relative === 'notes.sqlite' || relative.startsWith(`attachments${path.sep}`) || relative.startsWith(`.运行缓存${path.sep}`)) throw new Error('请选择一个单独的备份位置，避免覆盖正在使用的数据文件');
    await exclusive(() => createBackup(store, picked.filePath!)); lastBackup = new Date().toISOString(); return picked.filePath;
  },
  restoreBackup: async () => {
    const picked = await dialog.showOpenDialog(win!, { title: '选择随手记备份', filters: [{ name: '随手记备份', extensions: ['zip'] }], properties: ['openFile'] });
    if (picked.canceled) return false;
    return exclusive(async () => {
      const backup = await validateBackup(picked.filePaths[0]);
      try {
        const answer = await dialog.showMessageBox(win!, { type: 'question', title: '恢复备份', message: `恢复备份中的 ${backup.count} 条记录？`, detail: `备份时间：${new Date(backup.createdAt).toLocaleString('zh-CN')}\n当前记录会先完整备份，再替换为所选备份。`, buttons: ['取消', '备份当前数据并恢复'], defaultId: 0, cancelId: 0 });
        if (answer.response !== 1) return false;
        const dir = path.join(dataDir, '恢复前备份'); await fsp.mkdir(dir, { recursive: true }); await createBackup(store, path.join(dir, `恢复前-${fileStamp()}.zip`));
        applyRestore(store, backup.stage); return true;
      } finally { await fsp.rm(backup.stage, { recursive: true, force: true }); }
    });
  },
  exportNotes: async (id?: string) => {
    const picked = await dialog.showOpenDialog(win!, { title: '选择导出位置', properties: ['openDirectory', 'createDirectory'] }); if (picked.canceled) return null;
    const destination = path.join(picked.filePaths[0], `随手记导出-${fileStamp()}`);
    await exclusive(() => exportHtml(store, destination, id)); await shell.openPath(destination); return destination;
  },
  info: () => ({ dataDir, version: app.getVersion(), lastBackup, backupWarning }),
  openDataDir: async () => { await shell.openPath(dataDir); },
  readClipboardText: () => clipboard.readText(),
  writeClipboardText: (text: string) => {
    if (typeof text !== 'string') throw new Error('复制内容必须是文字');
    return clipboard.writeText(text);
  },
  showTextMenu: (options: TextMenuOptions) => new Promise<TextMenuAction | null>(resolve => {
    if (!win || !options || !['context','toolbar'].includes(options.mode)) throw new Error('无法打开文字菜单');
    const item = (label: string, action: TextMenuAction, enabled: boolean, accelerator?: string): MenuItemConstructorOptions =>
      ({ label, enabled, accelerator, registerAccelerator: false, click: () => resolve(action) });
    const template: MenuItemConstructorOptions[] = options.mode === 'context' ? [
      { role: 'cut', label: '剪切', enabled: options.editable && options.hasSelection },
      { role: 'copy', label: '复制', enabled: options.hasSelection },
      item('复制为纯文本', 'copyPlain', options.hasText, 'CommandOrControl+Shift+C'),
      { type: 'separator' },
      { role: 'paste', label: '粘贴', enabled: options.editable },
      item('粘贴为纯文本', 'pastePlain', options.editable, 'CommandOrControl+Shift+V'),
      { type: 'separator' }, { role: 'selectAll', label: '全选' }
    ] : [
      item('复制为纯文本', 'copyPlain', options.hasText, 'CommandOrControl+Shift+C'),
      item('粘贴为纯文本', 'pastePlain', options.editable, 'CommandOrControl+Shift+V'),
      { type: 'separator' }, item('复制全文为纯文本', 'copyAllPlain', true)
    ];
    const [width,height] = win.getContentSize();
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: win, x: Math.max(0,Math.min(width-1,Math.round(options.x)||0)),
      y: Math.max(0,Math.min(height-1,Math.round(options.y)||0)), callback: () => resolve(null) });
  }),
  readyToClose: () => { if (!busy) { mayClose = true; win?.close(); } }
};

async function start() {
  recoverInterruptedRestore(dataDir); store = new Store(dataDir);
  try { if (!testMode) await dailyBackup(); } catch (error) { backupWarning = `自动备份未完成：${error instanceof Error ? error.message : error}`; }
  protocol.handle('app-asset', request => {
    try { const url = new URL(request.url); if (url.hostname !== 'media') return new Response('', { status: 403 });
      const a = store.attachment(url.pathname.slice(1)); if (a.kind !== 'image') return new Response('', { status: 403 });
      return net.fetch(pathToFileURL(store.assetPath(a)).toString());
    } catch { return new Response('', { status: 404 }); }
  });
  ipcMain.handle('notes:call', async (event, method: string, ...args: unknown[]) => {
    try {
      if (event.sender !== win?.webContents || event.senderFrame !== win?.webContents.mainFrame || !Object.hasOwn(methods, method)) throw new Error('不支持的操作');
      if (busy && !['info','readyToClose'].includes(method)) throw new Error('正在处理数据，请稍候再试');
      return { ok: true, data: await methods[method](...args) };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  const preferences=path.join(app.getPath('userData'),'window-state.json');
  const state=fitWindow(readWindowState(preferences),screen.getAllDisplays().map(d=>d.workArea));
  const area=screen.getDisplayMatching(state).workArea;
  win = new BrowserWindow({ ...state, minWidth: Math.min(920,area.width), minHeight: Math.min(650,area.height), title: '随手记', backgroundColor: '#fffefa', autoHideMenuBar: true, show: false,
    icon: path.join(here, '../assets/icon.ico'),
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
  win.setMenu(null);
  let windowTimer:ReturnType<typeof setTimeout>|undefined;
  const remember=()=>{if(win&&!win.isDestroyed())writeWindowState(preferences,{...win.getNormalBounds(),maximized:win.isMaximized()});};
  const schedule=()=>{if(windowTimer)clearTimeout(windowTimer);windowTimer=setTimeout(remember,300);};
  win.on('resize',schedule);win.on('move',schedule);win.on('maximize',schedule);win.on('unmaximize',schedule);win.on('close',remember);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const localDev = !app.isPackaged && /^https?:\/\/127\.0\.0\.1:5173\//.test(details.url);
    callback({ cancel: /^https?:/i.test(details.url) && !localDev });
  });
  win.on('close', event => { if (!mayClose) { event.preventDefault(); if (busy) dialog.showMessageBox(win!, { message: '正在备份或恢复，请完成后再关闭。', buttons: ['知道了'] }); else win?.webContents.send('notes:close'); } });
  win.once('ready-to-show', () => {
    // Apply bounds after Windows has created its DPI-scaled frame; constructor
    // dimensions can otherwise grow by a few pixels on every restart.
    win?.setBounds({x:state.x,y:state.y,width:state.width,height:state.height});
    if(state.maximized)win?.maximize();win?.show();
  });
  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) await win.loadURL(process.env.VITE_DEV_SERVER_URL); else await win.loadFile(path.join(here, '../dist/index.html'));
  // If the UI cannot start, provide a native exit path instead of trapping the window.
  win.webContents.on('render-process-gone', () => { mayClose = true; dialog.showErrorBox('界面异常', '界面意外关闭。已保存的数据仍在本地，请重新打开随手记。'); win?.close(); });
}
if (lock) app.whenReady().then(start).catch(error => { dialog.showErrorBox('随手记无法启动', `原有数据不会被清除。\n${error instanceof Error ? error.message : error}\n\n数据位置：${dataDir}`); app.exit(1); });
app.on('window-all-closed', () => { try { store?.close(); } catch {} app.quit(); });
