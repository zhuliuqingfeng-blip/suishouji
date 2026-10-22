import {useEffect,useState} from 'react';
import {ArrowRight,ArrowUpRight,BookOpen,Download,HardDrive,Plus,Search,Trash2} from 'lucide-react';
import type {AppInfo,NoteSummary,Overview} from '../electron/shared';
import {friendlyTime,homeSnapshot,noteTitle} from './home-model';
import './home.css';

interface HomeProps {
  notes:NoteSummary[];overview:Overview;lastId:string|null;info:AppInfo|null;busy:boolean;loaded:boolean;
  onOpen:(id:string)=>void;onNew:()=>void;onBrowse:(tag?:string)=>void;onSearch:()=>void;onTrash:()=>void;onBackup:()=>void;onRetry:()=>void;
}

export function Home({notes,overview,lastId,info,busy,loaded,onOpen,onNew,onBrowse,onSearch,onTrash,onBackup,onRetry}:HomeProps){
  const [now,setNow]=useState(()=>new Date());
  useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),60000);return()=>clearInterval(timer);},[]);
  const snapshot=homeSnapshot(notes,lastId,now),continuation=snapshot.resume??snapshot.recent[0];
  const tags=[...overview.tags].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'zh-CN')).slice(0,4);
  return <main className="home-page" aria-label="首页" aria-busy={busy}>
    <div className="home-inner">
      <div className="home-dateline"><time dateTime={now.toISOString()}>{now.toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'})}</time><span title={info?.dataDir}><HardDrive size={13}/>保存在此电脑</span></div>
      <section className="home-arrival" aria-label="开始与继续">
        <div className="home-intro"><span className="section-overline">你的手记空间</span><h1>给想法一点空间。</h1><p>记下一件事，回顾一些片段，<br/>或接着上次写。</p><div className="home-actions"><button className="home-create" disabled={busy||!loaded} onClick={onNew}><Plus size={17}/>记一件事</button><button className="home-browse" disabled={busy||!loaded} onClick={()=>onBrowse()}>浏览手记库<ArrowRight size={16}/></button></div></div>
        {!loaded?<div className="home-continuation home-unavailable" role="status"><span className="section-overline">{busy?'正在读取本地资料':'资料暂时未能读取'}</span><h2>{busy?'稍等一下。':'再试一次，接着往下。'}</h2>{!busy&&<button onClick={onRetry}>重新读取<ArrowRight size={16}/></button>}</div>:continuation?
          <button className="home-continuation" aria-label={snapshot.resume?'继续上次记录':'打开最近记录'} disabled={busy} onClick={()=>onOpen(continuation.id)}>
            <span className="home-continue-meta"><span className="section-overline">{snapshot.resume?'继续上次':'最近的一条'}</span><time dateTime={continuation.updatedAt}>修改于{friendlyTime(continuation.updatedAt,now)}</time></span>
            <strong title={noteTitle(continuation)}>{noteTitle(continuation)}</strong><p>{continuation.plainText.replace(/\s+/g,' ').trim().slice(0,130)||(continuation.attachmentCount?'图片与文件已留在这条记录里。':'这一页还留着空白，随时可以接着写。')}</p>
            <span className="home-continue-link">{snapshot.resume?'继续编辑':'打开看看'}<ArrowUpRight size={19}/></span>
          </button>:
          <div className="home-continuation home-first"><BookOpen size={25} strokeWidth={1.3}/><h2>从一件小事开始。</h2><p>一段文字、一张截图、一份文件。<br/>等你想记时，再写下第一条。</p><span>内容自动保存，随时可以回来。</span></div>}
      </section>
      {loaded&&<div className="home-lower">
        <section className="home-recents" aria-label="最近更新"><header className="home-section-heading"><h2>最近更新</h2><button disabled={busy} onClick={()=>onBrowse()}>查看全部<ArrowRight size={14}/></button></header>
          {snapshot.recent.length?<div className="home-recent-list">{snapshot.recent.map(note=><button className="home-recent" key={note.id} disabled={busy} onClick={()=>onOpen(note.id)}><span className="home-recent-copy"><strong>{noteTitle(note)}</strong><span>{note.plainText.replace(/\s+/g,' ').trim().slice(0,100)||(note.attachmentCount?'包含随附文件':'还没有写下内容')}</span></span><time dateTime={note.updatedAt}>{friendlyTime(note.updatedAt,now)}</time><ArrowUpRight size={15}/></button>)}</div>:<div className="home-recent-empty"><span>这里会留下最近修改的三条手记。</span><p>不用急着整理，先把值得记住的留下来。</p></div>}
          {!!tags.length&&<div className="home-tags" aria-label="首页标签入口"><span>按标签回顾</span>{tags.map(tag=><button key={tag.name} disabled={busy} title={`${tag.name} · ${tag.count} 条记录`} onClick={()=>onBrowse(tag.name)}>{tag.name}<small>{tag.count}</small></button>)}</div>}
        </section>
        <aside className="home-snapshot" aria-label="资料近况"><header className="home-section-heading"><h2>资料近况</h2><button className="home-search" aria-label="查找记录" title="查找记录 Ctrl+F" disabled={busy} onClick={onSearch}><Search size={16}/></button></header>
          <dl><div><dt>已收好的手记</dt><dd data-testid="home-total">{snapshot.total}<small>条</small></dd></div><div><dt>近7天有更新</dt><dd data-testid="home-week">{snapshot.updatedThisWeek}<small>条</small></dd></div><div className="home-backup-state"><dt>最近备份</dt><dd title={info?.lastBackup?new Date(info.lastBackup).toLocaleString('zh-CN'):undefined}>{info?.lastBackup?friendlyTime(info.lastBackup,now):'暂无备份'}</dd></div></dl>
          {info?.backupWarning&&<p className="home-backup-warning" role="status">{info.backupWarning}</p>}
          <div className="home-data-actions"><button disabled={busy} onClick={onBackup}><Download size={14}/>备份一份<ArrowUpRight size={13}/></button><button disabled={busy} onClick={onTrash}><Trash2 size={14}/>{overview.trash?`${overview.trash} 条记录可找回`:'查看回收站'}<ArrowUpRight size={13}/></button></div>
        </aside>
      </div>}
    </div>
  </main>;
}
