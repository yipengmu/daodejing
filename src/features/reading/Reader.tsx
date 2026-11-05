import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, List, MoreHorizontal, X } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { chapters, chapterTitle, edition, readProgress } from './Library';
import { useResource } from '../../hooks';
import type { Share } from '../../types';
import { localState } from '../../services/storage';

type Page = { start: number; end: number; text: string };
function paginate(text: string, measure: HTMLDivElement, width: number, height: number): Page[] {
  const chars = Array.from(text); const pages: Page[] = [];
  measure.style.width = `${width}px`;
  let offset = 0;
  while (offset < chars.length) {
    let low = offset + 1, high = chars.length, best = low;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      measure.textContent = chars.slice(offset, middle).join('');
      if (measure.scrollHeight <= height) { best = middle; low = middle + 1; } else high = middle - 1;
    }
    pages.push({ start: offset, end: best, text: chars.slice(offset, best).join('') }); offset = best;
  }
  measure.textContent = '';
  return pages;
}
export default function Reader() {
  const number = Number(useParams().number); const chapter = chapters[number - 1];
  const navigate = useNavigate(); const location = useLocation();
  const viewport = useRef<HTMLDivElement>(null); const measure = useRef<HTMLDivElement>(null);
  const anchor = useRef(0); const pointer = useRef<{ x: number; y: number } | null>(null); const drawerPointer = useRef<{ x: number; y: number; height: number; axis: 'pending' | 'vertical' | 'horizontal' } | null>(null); const suppressDrawerClick = useRef(false);
  const [pages, setPages] = useState<Page[]>([]); const [pageIndex, setPageIndex] = useState(0);
  const [font, setFont] = useState(() => { const saved = Number(localState.getItem('ddj-font')); return [18, 20, 22, 24].includes(saved) ? saved : 20; });
  const [drawer, setDrawer] = useState(() => 67 / window.innerHeight); const [tab, setTab] = useState('notes');
  const [menu, setMenu] = useState(false); const [panel, setPanel] = useState<'contents' | 'settings' | 'source' | null>(null);
  const shares = useResource<{ shares: Share[] }>(`/shares?chapter=${number}&sort=reads`);
  const page = pages[pageIndex];

  useLayoutEffect(() => {
    if (!chapter || !viewport.current || !measure.current) return;
    const saved = readProgress();
    anchor.current = (location.state as any)?.start ? 0 : (location.state as any)?.end ? Number.MAX_SAFE_INTEGER : saved?.chapter === number ? saved.offset : 0;
    setDrawer(67 / window.innerHeight);
    const layout = () => {
      const box = viewport.current!;
      const next = paginate(chapter.text, measure.current!, box.clientWidth, Math.max(font * 2, box.clientHeight));
      const index = Math.max(0, next.findIndex(p => anchor.current >= p.start && anchor.current < p.end));
      setPages(next); setPageIndex(anchor.current === Number.MAX_SAFE_INTEGER ? next.length - 1 : index);
    };
    layout();
    const observer = new ResizeObserver(layout); observer.observe(viewport.current);
    let active = true; document.fonts.ready.then(() => { if (active) layout(); });
    return () => { active = false; observer.disconnect(); };
  }, [number, chapter, font, location.key]);

  useEffect(() => {
    if (!page) return;
    anchor.current = page.start;
    localState.setItem('ddj-reading', JSON.stringify({ chapter: number, offset: page.start }));
  }, [number, page]);
  useEffect(() => { localState.setItem('ddj-font', String(font)); }, [font]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPanel(null); setMenu(false); setDrawer(0); } };
    document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape);
  }, []);
  if (!chapter || !Number.isInteger(number)) return <div className="page-width"><h1>这一章不存在</h1><Link to="/">返回目录</Link></div>;
  const previousDisabled = number === 1 && pageIndex === 0;
  const nextDisabled = number === 81 && pageIndex === pages.length - 1;
  function turn(direction: number) {
    if (direction > 0) {
      if (pageIndex < pages.length - 1) setPageIndex(x => x + 1);
      else if (number < 81) navigate(`/read/${number + 1}`, { state: { fromReader: true } });
    } else {
      if (pageIndex > 0) setPageIndex(x => x - 1);
      else if (number > 1) navigate(`/read/${number - 1}`, { state: { end: true } });
    }
  }
  return <main className="reader-screen">
    <header className="reader-toolbar"><div className="reader-toolbar-start"><Link className="text-button reader-home-link" to="/" aria-label="回到读书首页"><ArrowLeft size={18}/><span>读书首页</span></Link><button className="text-button" onClick={() => setPanel('contents')}><List size={19}/><span>目录</span></button></div><span>第 {number} 章</span><div className="reader-menu-wrap"><button className="icon-button" aria-label="更多阅读选项" aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal/></button>{menu && <div className="popover"><button onClick={() => { setPanel('settings'); setMenu(false); }}>阅读设置</button><button onClick={() => { setPanel('source'); setMenu(false); }}>版本与来源</button></div>}</div></header>
    <div className="reader-book">
      <div className="reader-chapter-heading"><span className="eyebrow">{chapter.section} · 第 {String(number).padStart(2, '0')} 章</span><h1>{chapterTitle(number)}</h1><button className="source-button" onClick={() => setPanel('source')}>{edition.label} · 版本与来源</button></div>
      <div className="reader-viewport" ref={viewport} onPointerDown={event => { if (event.target !== event.currentTarget && (event.target as Element).closest('a,button')) return; if (event.clientX < 24 || event.clientX > window.innerWidth - 24) return; pointer.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={event => { const start = pointer.current; pointer.current = null; if (!start || window.getSelection()?.toString()) return; const dx = event.clientX - start.x, dy = event.clientY - start.y; if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.6) turn(dx < 0 ? 1 : -1); }}>
        <div className="scripture" style={{ fontSize: font }} aria-label={`第 ${number} 章原文`}>{page?.text || chapter.text}</div>
        <div className="scripture measure" ref={measure} style={{ fontSize: font }} aria-hidden="true"/>
      </div>
      <div className="reader-pagination"><button className="icon-button" aria-label={pageIndex ? '上一页' : '上一章'} disabled={previousDisabled} onClick={() => turn(-1)}><ArrowLeft size={19}/></button><span aria-live="polite">{pageIndex + 1} / {pages.length || 1}<small>左右滑动翻页</small></span><button className="icon-button" aria-label={pageIndex < pages.length - 1 ? '下一页' : '下一章'} disabled={nextDisabled} onClick={() => turn(1)}><ArrowRight size={19}/></button></div>
    </div>
    <section className="reading-drawer" style={{ '--drawer-height': `${drawer * 100}dvh` } as React.CSSProperties} aria-label="本章注释与分享">
      <button className="drawer-handle" aria-label={drawer * window.innerHeight <= 80 ? '展开注释与分享' : '拖动调整注释浮层高度'} aria-expanded={drawer * window.innerHeight > 80} onClick={() => { if (suppressDrawerClick.current) { suppressDrawerClick.current = false; return; } setDrawer(drawer * window.innerHeight <= 80 ? 0.5 : 67 / window.innerHeight); }} onPointerDown={e => { suppressDrawerClick.current = false; drawerPointer.current = { x: e.clientX, y: e.clientY, height: e.currentTarget.parentElement?.getBoundingClientRect().height || 0, axis: 'pending' }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { const start = drawerPointer.current; if (!start) return; const dx = e.clientX - start.x, dy = e.clientY - start.y; if (start.axis === 'pending' && Math.max(Math.abs(dx), Math.abs(dy)) > 8) start.axis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'; if (start.axis !== 'vertical') return; suppressDrawerClick.current = true; const max = window.innerHeight - 65; const height = Math.max(67, Math.min(max, start.height - dy)); setDrawer(height / window.innerHeight); }} onPointerUp={() => { drawerPointer.current = null; }} onPointerCancel={() => { drawerPointer.current = null; }}><span/><span className="drawer-collapsed-label">注释 · 分享</span><ChevronDown size={16}/></button>
      <div className="drawer-tabs" role="tablist"><button role="tab" aria-selected={tab === 'notes'} onClick={() => setTab('notes')}>注释</button><button role="tab" aria-selected={tab === 'shares'} onClick={() => setTab('shares')}>本章分享</button><button className="text-button drawer-close" aria-label="收起辅助内容" onClick={() => setDrawer(67 / window.innerHeight)}><X size={18}/></button></div><div className="drawer-content" key={`${number}-${tab}`} role="tabpanel">{tab === 'notes' ? <><div className="annotation-heading"><h2>白话注释</h2><span className="note-attribution">{chapter.explanationLabel}</span></div>{chapter.explanation.split(/(?<=[。！？])/u).filter((sentence: string) => sentence.trim()).map((sentence: string, index: number) => <p className="annotation" key={index}>{sentence.trim()}</p>)}<h2>河上公</h2><p className="muted">古注原文待补。</p></> : <>{shares.loading ? <p className="muted">正在读取本章分享…</p> : shares.error ? <p className="muted">本章分享暂时无法加载。<button className="text-button" onClick={shares.refresh}>重试</button></p> : shares.data?.shares.length ? shares.data.shares.slice(0, 3).map(share => <Link className="drawer-share" to={`/shares/${share.id}`} state={{ returnTo: `/read/${number}` }} key={share.id}><small>{share.name} · 阅读 {share.views}</small><p>{share.title || share.body.slice(0, 80)}</p></Link>) : <p className="muted">本章还没有分享。读到这里，你有什么体会？</p>}<Link className="button primary" to={`/chapters/${number}`} state={{ fromReader: true }}>进入本章频道 <ArrowRight size={17}/></Link></>}</div>
    </section>
    {panel && <div className="modal-backdrop" onClick={() => setPanel(null)}><section className="reader-dialog" role="dialog" aria-modal="true" aria-label={panel === 'contents' ? '章节目录' : panel === 'source' ? '版本与来源' : '阅读设置'} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key !== 'Tab') return; const elements = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input,select,textarea')]; const first = elements[0], last = elements[elements.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }}><header><h2>{panel === 'contents' ? '八十一章' : panel === 'source' ? '版本与来源' : '阅读设置'}</h2><button autoFocus className="icon-button" aria-label="关闭" onClick={() => setPanel(null)}><X/></button></header>{panel === 'contents' ? <div className="dialog-chapters">{chapters.map(c => <button key={c.number} className={c.number === number ? 'selected' : ''} onClick={() => { setPanel(null); if (c.number !== number) navigate(`/read/${c.number}`, { state: { start: true } }); else setPageIndex(0); }}><span>{String(c.number).padStart(2, '0')}</span>{chapterTitle(c.number)}{c.number === number && <small>当前</small>}</button>)}</div> : panel === 'source' ? <div className="source-copy"><p className="eyebrow">{edition.title}</p><h3>{edition.label}</h3><p>{edition.sourceNote}</p><p>{edition.annotationPolicy}</p><small>注释与个人分享均与经典原文分开展示。</small></div> : <div className="font-settings"><p>原文字号</p><div>{[18, 20, 22, 24].map(value => <button aria-label={`原文字号 ${value} 像素`} aria-pressed={font === value} className={font === value ? 'selected' : ''} key={value} onClick={() => setFont(value)} style={{ fontSize: value }}>文<span>{value}</span></button>)}</div><p className="muted">字号变化后保持当前文字位置。本机自动记住你的选择。</p></div>}</section></div>}
  </main>;
}
