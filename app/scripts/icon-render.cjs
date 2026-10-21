const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
fs.mkdirSync(process.env.NOTES_ICON_CACHE_DIR,{recursive:true});
app.setPath('userData',process.env.NOTES_ICON_CACHE_DIR);
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 await win.loadURL('data:text/html,<meta charset="utf-8"><title>Local icon renderer</title>');
});
app.on('window-all-closed',()=>app.quit());
