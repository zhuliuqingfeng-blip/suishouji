import fs from 'node:fs/promises';
import path from 'node:path';
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import pngToIco from 'png-to-ico';
import {appRoot,repoRoot,testRoot} from './paths.mjs';
// The SVG is shared by in-app branding and all native icon sizes.
const svg=await fs.readFile(path.join(appRoot,'assets/icon.svg'),'utf8');
const env={...process.env,NOTES_ICON_CACHE_DIR:path.join(repoRoot,'.cache','icon-render')};delete env.ELECTRON_RUN_AS_NODE;
let instance;
try{
 instance=await electron.launch({executablePath:electronPath,args:[path.join(appRoot,'scripts/icon-render.cjs')],env,timeout:15000});
 const page=await instance.firstWindow();
 const sizes=[16,20,24,32,40,48,64,128,256,512];
 const images=await page.evaluate(async({svg,sizes})=>{
   const img=new Image();img.src='data:image/svg+xml;base64,'+btoa(svg);await img.decode();
   const output={};for(const size of sizes){const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;canvas.getContext('2d').drawImage(img,0,0,size,size);output[size]=canvas.toDataURL('image/png').split(',')[1];}
   const canvas=document.createElement('canvas');canvas.width=800;canvas.height=420;const ctx=canvas.getContext('2d');
   for(const [y,bg,fg]of [[0,'#f8f7f3','#60547f'],[210,'#51436c','#e7ddef']]){ctx.fillStyle=bg;ctx.fillRect(0,y,800,210);ctx.fillStyle=fg;ctx.font='14px "Segoe UI"';ctx.fillText(y===0?'LIGHT / WINDOWS DESKTOP':'DARK / TASKBAR',26,y+30);let x=30;for(const size of [16,24,32,48,64,128]){ctx.drawImage(img,x,y+52+(128-size)/2,size,size);ctx.fillText(size+' px',x,y+197);x+=size+40;}}
   output.preview=canvas.toDataURL('image/png').split(',')[1];return output;
 },{svg,sizes});
 await fs.writeFile(path.join(appRoot,'assets/icon.png'),Buffer.from(images[512],'base64'));
 await fs.writeFile(path.join(appRoot,'assets/icon.ico'),await pngToIco(sizes.filter(n=>n<=256).map(n=>Buffer.from(images[n],'base64'))));
 await fs.mkdir(testRoot,{recursive:true});await fs.writeFile(path.join(testRoot,'icon-preview.png'),Buffer.from(images.preview,'base64'));
 console.log('Generated SVG-based PNG and ICO sizes: '+sizes.filter(n=>n<=256).join(', '));
}finally{if(instance)await instance.close();}
