import {appRoot,testRoot} from './paths.mjs';
process.chdir(appRoot);
import {createServer} from 'vite';
import {_electron} from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=await fs.mkdtemp(path.join(testRoot,'dev-'));const server=await createServer({root:appRoot});let instance;
try{
  await server.listen();
  await server.warmupRequest('/src/main.tsx');
  await server.waitForRequestsIdle();
  instance=await _electron.launch({executablePath:electronPath,args:[appRoot],env:{...process.env,NOTES_TEST_MODE:'1',NOTES_DATA_DIR:root,VITE_DEV_SERVER_URL:'http://127.0.0.1:5173'}});
  const page=await instance.firstWindow(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  try{await page.locator('.home-mode').waitFor({timeout:30000});await page.waitForFunction(()=>!document.querySelector('[aria-label="新建记录"]')?.disabled,{timeout:30000});}
  catch(error){console.error(errors);throw error;}
  console.log('开发服务器与桌面首页启动通过');
}finally{
  try{if(instance){
    // Only this isolated test child may be killed if its renderer never initialized.
    const child=instance.process(),deadline=setTimeout(()=>child.kill(),5000);
    try{await instance.close();}finally{clearTimeout(deadline);}
  }}finally{await server.close();}
}
