import fs from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import pngToIco from 'png-to-ico';
const n=256, data=Buffer.alloc((n*4+1)*n);
function line(x,y,x1,y1,x2,y2,w){const dx=x2-x1,dy=y2-y1,t=Math.max(0,Math.min(1,((x-x1)*dx+(y-y1)*dy)/(dx*dx+dy*dy)));return (x-x1-t*dx)**2+(y-y1-t*dy)**2<w*w;}
for(let y=0;y<n;y++)for(let x=0;x<n;x++){
 const at=y*(n*4+1)+1+x*4, r=45, cx=Math.max(r,Math.min(n-r-1,x)),cy=Math.max(r,Math.min(n-r-1,y));
 let rgba=(x-cx)**2+(y-cy)**2<=r*r?[32,43,61,255]:[0,0,0,0];
 if((x>=67&&x<=173&&y>=56&&y<=198&&(x<74||x>166||y<63||y>191))||line(x,y,88,85,145,85,3)||line(x,y,88,110,145,110,3)||line(x,y,88,135,119,135,3))rgba=[250,246,239,255];
 if(line(x,y,133,171,190,114,8)||line(x,y,129,177,136,159,4))rgba=[241,193,167,255];
 for(let c=0;c<4;c++)data[at+c]=rgba[c];
}
function crc(b){let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(name,bytes){const type=Buffer.from(name),len=Buffer.alloc(4),check=Buffer.alloc(4);len.writeUInt32BE(bytes.length);check.writeUInt32BE(crc(Buffer.concat([type,bytes])));return Buffer.concat([len,type,bytes,check]);}
const header=Buffer.alloc(13);header.writeUInt32BE(n,0);header.writeUInt32BE(n,4);header[8]=8;header[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(data)),chunk('IEND',Buffer.alloc(0))]);
await fs.mkdir('assets',{recursive:true});await fs.writeFile('assets/icon.png',png);await fs.writeFile('assets/icon.ico',await pngToIco(png));
