import {useEffect,useState} from 'react';
import {ArrowRight,ArrowUpRight,Plus} from 'lucide-react';
import type {AppInfo,NoteSummary} from '../electron/shared';
import {friendlyTime,homeSnapshot,noteTitle} from './home-model';
import './home.css';

interface HomeProps {
  notes:NoteSummary[];lastId:string|null;info:AppInfo|null;busy:boolean;loaded:boolean;
  onOpen:(id:string)=>void;onNew:()=>void;onBrowse:()=>void;onRetry:()=>void;
}

export function Home({notes,lastId,info,busy,loaded,onOpen,onNew,onBrowse,onRetry}:HomeProps){
  const [now,setNow]=useState(()=>new Date());
  useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),60000);return()=>clearInterval(timer);},[]);
  const snapshot=homeSnapshot(notes,lastId,now),continuation=snapshot.resume??snapshot.recent[0];
  const backupValid=!!info?.lastBackup&&Number.isFinite(Date.parse(info.lastBackup));
  const backupLabel=info?.backupWarning?'自动备份未完成':backupValid?'已备份':'保存在本地';
  const backupDetail=info?.backupWarning??(backupValid?'最近备份：'+new Date(info!.lastBackup!).toLocaleString('zh-CN')+'；可在右上角“数据与设置”查看':'可在右上角“数据与设置”管理备份');
  return <main className="home-page" aria-label="首页" aria-busy={busy}>
    <div className="home-inner">
      <section className="home-intro" aria-label="开始记录">
        <time className="home-dateline" dateTime={now.toISOString()}>{now.toLocaleDateString('zh-CN',{month:'long',day:'numeric'})}<span aria-hidden="true"> · </span>{now.toLocaleDateString('zh-CN',{weekday:'long'})}</time>
        <h1>给想法一点空间。</h1>
        <p>写点刚刚想到的，<br/>或接着上次没写完的。</p>
        <button className="home-create" aria-label="新建记录" title="写点什么 Ctrl+N" disabled={busy||!loaded} onClick={onNew}><Plus size={19}/><span>写点什么</span><kbd>Ctrl N</kbd></button>
      </section>
      {!loaded?<section className="home-unavailable" role="status"><p>{busy?'正在翻开你的手记…':'暂时没能读取手记，再试一次。'}</p>{!busy&&<button onClick={onRetry}>重新读取<ArrowRight size={15}/></button>}</section>:<>
        {continuation&&<section className="home-continue-section" aria-label={snapshot.resume?'继续写':'最近的一页'}><h2>{snapshot.resume?'继续写':'最近的一页'}</h2>
          <button className="home-continuation" aria-label={snapshot.resume?'继续上次记录':'打开最近记录'} disabled={busy} onClick={()=>onOpen(continuation.id)}>
            <span className="home-continue-copy"><strong title={noteTitle(continuation)}>{noteTitle(continuation)}</strong><span>{continuation.plainText.replace(/\s+/g,' ').trim().slice(0,100)||(continuation.attachmentCount?'图片与文件也留在这一页里。':'这一页还留着空白。')}</span></span>
            <span className="home-continue-aside"><time dateTime={continuation.updatedAt}>上次修改 · {friendlyTime(continuation.updatedAt,now)}</time><span className="home-continue-link">{snapshot.resume?'继续编辑':'打开看看'}<ArrowRight size={15}/></span></span>
          </button>
        </section>}
        <section className="home-recents" aria-label="最近更新"><header className="home-section-heading"><h2>最近</h2><button disabled={busy} onClick={onBrowse}>去手记库<ArrowUpRight size={14}/></button></header>
          {snapshot.recent.length?<div className="home-recent-list">{snapshot.recent.map(note=><button className="home-recent" key={note.id} disabled={busy} onClick={()=>onOpen(note.id)}><span className="home-recent-copy"><strong title={noteTitle(note)}>{noteTitle(note)}</strong></span><time dateTime={note.updatedAt}>{friendlyTime(note.updatedAt,now)}</time><ArrowUpRight size={14}/></button>)}</div>:<p className="home-recent-empty">还没有手记。想写的时候，就从上面开始。</p>}
        </section>
        <p className="home-footnote" aria-label="本地保存状态"><span>已保存 <span data-testid="home-total">{snapshot.total}</span> 条</span><span aria-hidden="true">·</span><span className={info?.backupWarning?'home-backup-warning':undefined} title={backupDetail}>{backupLabel}</span></p>
      </>}
    </div>
  </main>;
}
