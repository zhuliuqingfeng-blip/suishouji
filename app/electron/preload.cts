import { contextBridge, ipcRenderer, webUtils } from 'electron';
const invoke = async (method: string, ...args: unknown[]) => {
  const result = await ipcRenderer.invoke('notes:call', method, ...args);
  if (!result.ok) throw new Error(result.error); return result.data;
};
const names = ['list','overview','create','get','save','pin','trash','restoreNote','remove','emptyTrash','trashMany','restoreMany','removeMany','undoDelete','pickFiles','importPaths','pasteImage','openAttachment','openLink','backup','restoreBackup','exportNotes','info','openDataDir','readClipboardText','writeClipboardText','showTextMenu','readyToClose'];
const api: Record<string, unknown> = Object.fromEntries(names.map(name => [name, (...args: unknown[]) => invoke(name, ...args)]));
api.onCloseRequested = (callback: () => void) => { const listener = () => callback(); ipcRenderer.on('notes:close', listener); return () => ipcRenderer.removeListener('notes:close', listener); };
api.onOperation = (callback: (busy: boolean) => void) => { const listener = (_event: unknown, busy: boolean) => callback(busy); ipcRenderer.on('notes:operation', listener); return () => ipcRenderer.removeListener('notes:operation', listener); };
api.pathsForFiles = (files: File[]) => files.map(file => webUtils.getPathForFile(file)).filter(Boolean);
contextBridge.exposeInMainWorld('notes', api);
