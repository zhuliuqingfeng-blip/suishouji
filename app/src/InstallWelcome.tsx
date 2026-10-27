import {useLayoutEffect,useRef,useState} from 'react';
import appMark from '../assets/icon.svg';
import type {NotesAPI} from '../electron/shared';
import './help.css';

export function InstallWelcome({api,onReady}:{api:NotesAPI;onReady:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),[working,setWorking]=useState(false),[error,setError]=useState('');
  useLayoutEffect(()=>{dialog.current!.showModal();return()=>dialog.current?.close();},[]);
  async function start(){setWorking(true);try{await api.finishInstallSetup();onReady();}catch(e){setError(String(e));setWorking(false);}}
  async function importOld(){setWorking(true);setError('');try{if(!await api.importLegacy())setWorking(false);}catch(e){setError(e instanceof Error?e.message:String(e));setWorking(false);}}
  return <dialog ref={dialog} className="usage-help install-welcome" aria-label="开始使用安装版" onKeyDown={e=>e.stopPropagation()} onCancel={e=>{e.preventDefault();if(!working)void start();}}>
    <header className="usage-help-heading"><img src={appMark} alt=""/><div><h2>从这里，接着记录。</h2><p>欢迎使用随手记安装版。</p></div></header>
    <div className="usage-help-body"><p>第一次使用，直接开始就好。</p><p>已经用过免安装版？先关闭旧版，再选择它的软件文件夹。手记、重要日子、图片附件和设置，会一起带过来。</p><p className="install-welcome-note">导入前会备份，旧版原件也会保留。以后更新时，运行新的安装包即可，资料会留在电脑里。</p>{error&&<p className="install-welcome-error" role="alert">{error}</p>}</div>
    <footer className="usage-help-footer"><button className="install-welcome-secondary" disabled={working} onClick={()=>void start()}>直接开始</button><button autoFocus disabled={working} onClick={()=>void importOld()}>{working?'正在准备…':'从免安装版导入'}</button></footer>
  </dialog>;
}
