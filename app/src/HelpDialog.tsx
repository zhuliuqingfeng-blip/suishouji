import {useLayoutEffect, useRef, useState} from 'react';
import {ChevronDown, FolderOpen, X} from 'lucide-react';
import appMark from '../assets/icon.svg';
import type {AppInfo} from '../electron/shared';
import './help.css';

export function HelpDialog({info, onClose, onOpenDataDir}: {
  info: AppInfo | null;
  onClose: () => void;
  onOpenDataDir: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');

  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      document.querySelector<HTMLButtonElement>('[aria-label="数据与设置"]')?.focus({preventScroll: true});
    };
  }, []);

  async function openFolder() {
    setOpening(true);
    setError('');
    try { await onOpenDataDir(); }
    catch { setError('暂时无法打开文件夹，请重试。也可以复制上面的路径，在文件资源管理器中打开。'); }
    finally { setOpening(false); }
  }

  return <dialog ref={dialog} className="usage-help" aria-labelledby="usage-help-title"
    onKeyDown={event => event.stopPropagation()}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <header className="usage-help-heading">
      <img src={appMark} alt=""/>
      <div><h2 id="usage-help-title">使用说明</h2><p>随时记下，想看时再回来。</p></div>
      <button autoFocus className="usage-help-close" aria-label="关闭说明" onClick={onClose}><X size={19}/></button>
    </header>
    <div className="usage-help-body">
      <ol className="usage-help-start">
        <li><strong>写点什么</strong><p>在首页点“写点什么”，或在手记库点“新建记录”。标题留空也没关系。</p></li>
        <li><strong>写完会自动保存</strong><p>停下输入，就会保存。底部显示“所有更改已保存”时，就可以放心关掉窗口。</p></li>
        <li><strong>想看时，再找回来</strong><p>去手记库搜索文字或文件名。手记误删了，可以从“数据与设置”里的回收站找回。</p></li>
      </ol>
      <div className="usage-help-shortcuts" aria-label="常用快捷键">
        <span>新建 <kbd>Ctrl N</kbd></span><span>查找 <kbd>Ctrl F</kbd></span><span>保存 <kbd>Ctrl S</kbd></span>
      </div>
      <section className="usage-help-topics" aria-label="按需了解">
        <details name="usage-help-topic"><summary>图片和文件怎么放进来？<ChevronDown size={16}/></summary>
          <div className="usage-help-answer"><p>截图直接按 <kbd>Ctrl V</kbd> 粘贴。图片和文件可以拖进记录，也可以点“图片 / 文件”添加。</p><p>添加后会保存一份独立副本，原文件移走也不影响。点图片可放大，点附件可打开。</p></div>
        </details>
        <details name="usage-help-topic"><summary>复制来的文字，怎么去掉格式？<ChevronDown size={16}/></summary>
          <div className="usage-help-answer"><p>按 <kbd>Ctrl Shift V</kbd> 粘贴为纯文本，保留文字和换行，去掉来源的字体、颜色等格式。</p><p>想复制干净的文字，选中正文后按 <kbd>Ctrl Shift C</kbd>。工具栏“纯文本”里也能找到这两个操作。</p></div>
        </details>
        <details name="usage-help-topic"><summary>生日和纪念日怎么记？<ChevronDown size={16}/></summary>
          <div className="usage-help-answer"><p>打开顶部“重要日子”，点“＋ 添加”。公历、农历都可以，生日和纪念日可选“每年重复”，年份可以留空。</p><p>默认提前 14 天和当天提醒，临近时首页也会轻轻提示。提醒在软件运行时生效，关闭后不会在后台提醒。</p></div>
        </details>
        <details name="usage-help-topic"><summary>数据与备份<ChevronDown size={16}/></summary>
          <div className="usage-help-answer">
            <p>文字、图片和重要日子，都在这台电脑里。每天首次打开会自动备份，保留最近七份；也可以在“数据与设置”中点“备份全部数据”，另存一份到 U 盘。</p>
            {info?.distribution==='installed'?<><p>以后更新，直接运行新版安装包即可，无需卸载或搬动资料。卸载只移除程序，重新安装仍能读取原有资料。</p><p>换电脑时，在新电脑安装随手记，再从完整备份恢复。资料独立于程序保存，只复制程序文件夹不能带走记录。</p></>:<p>换电脑前先关闭软件，再复制<strong>整个软件文件夹</strong>，包括里面的“我的数据”。也可以在另一台电脑上从完整备份恢复。</p>}
            <p>想用浏览器查看手记？在记录的“更多记录操作”中导出，打开导出文件夹里的“打开我的记录.html”即可。</p>
            <div className="usage-help-location"><span>你的数据位置</span><code>{info?.dataDir || '正在读取…'}</code><button disabled={opening || !info?.dataDir} onClick={() => void openFolder()}><FolderOpen size={15}/>{opening ? '正在打开…' : '打开数据文件夹'}</button>{error && <p role="alert">{error}</p>}</div>
          </div>
        </details>
      </section>
    </div>
    <footer className="usage-help-footer"><span>随手记 {info?.version}</span><button onClick={onClose}>知道了</button></footer>
  </dialog>;
}
