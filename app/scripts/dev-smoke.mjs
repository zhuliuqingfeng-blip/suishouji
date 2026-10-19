import {appRoot,testRoot} from './paths.mjs';
process.chdir(appRoot);
import {createServer} from 'vite';
import {_electron} from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=await fs.mkdtemp(path.join(testRoot,'dev-'));const server=await createServer({root:appRoot});let instance;
try{await server.listen();instance=await _electron.launch({executablePath:electronPath,args:[appRoot],env:{...process.env,NOTES_TEST_MODE:'1',NOTES_DATA_DIR:root,VITE_DEV_SERVER_URL:'http://127.0.0.1:5173'}});const page=await instance.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});try{await page.getByRole('button',{name:/新建记录/}).first().waitFor({timeout:8000});}catch(error){console.error(errors);throw error;}console.log('开发服务器与桌面窗口启动通过');}finally{if(instance)await instance.close();await server.close();}
