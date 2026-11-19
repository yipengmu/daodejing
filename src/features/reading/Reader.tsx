import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ArrowLeft, ArrowRight, List, MoreHorizontal, Pencil, X } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { chapters, chapterTitle, edition, readProgress } from './Library';
import { localState } from '../../services/storage';
import { post } from '../../services/api';
import { addAnnotation, changeAnnotation, editGuestAnnotation } from '../../services/readingAnnotations';
import { useSession } from '../../app/context';
import { matchesAnnotation, type AnnotationAnchor } from '../../../shared/reading-annotations';
import { Channel } from '../shares/Pages';
import { AnnotationEditor, AnnotationFeed, SelectionActions, readPressedClause, readTextSelection, renderAnnotatedText, useChapterAnnotations, type ReaderAnnotation, type TextSelection } from './Annotations';
import './annotations.css';

type Page = { chapter: number; start: number; end: number; text: string };
type ReadingBlock = { kind: 'text'; text: string } | { kind: 'questions' | 'parallel'; lines: string[] };
const drawerTabs = [['notes', '原文注释'], ['annotations', '评论']] as const;
type DrawerTab = typeof drawerTabs[number][0];
function collapsedDrawerHeight(compact = false) { return (compact ? 68 : 92) / window.innerHeight; }
function expandedDrawerHeight() { return window.matchMedia('(max-width: 760px)').matches ? 0.95 : 0.5; }
function splitChapterTen(text: string) {
  const clauses = text.match(/[^？]+？|[^；]+；|[^。]+。/gu) || [];
  if (clauses.length !== 11 || clauses.join('') !== text || clauses.slice(0, 6).some(line => !line.endsWith('？'))) return null;
  return {
    questions: clauses.slice(0, 6),
    opening: clauses[6],
    emphasis: clauses.slice(7, 10).join(''),
    closing: clauses[10],
  };
}
function splitReadingBlocks(text: string): ReadingBlock[] {
  const sentences = text.match(/[^。！？]*[。！？]+|[^。！？]+$/gu) || [];
  const blocks: ReadingBlock[] = [];
  for (let index = 0; index < sentences.length;) {
    if (sentences[index].endsWith('？')) {
      const questions: string[] = [];
      while (index < sentences.length && sentences[index].endsWith('？')) questions.push(sentences[index++]);
      blocks.push(questions.length > 1 ? { kind: 'questions', lines: questions } : { kind: 'text', text: questions[0] });
      continue;
    }
    const sentence = sentences[index++];
    const clauses = sentence.match(/[^；;]*[；;]+|[^；;]+$/gu) || [];
    blocks.push(clauses.length > 1 ? { kind: 'parallel', lines: clauses } : { kind: 'text', text: sentence });
  }
  return blocks;
}
function addReadingMarkup(root: HTMLElement, text: string, chapterNumber: number) {
  const chapterTen = chapterNumber === 10 ? splitChapterTen(text) : null;
  if (chapterTen) {
    root.className = 'scripture chapter-ten-layout';
    const columns = document.createElement('div'); columns.className = 'chapter-ten-questions';
    for (const lines of [chapterTen.questions.slice(0, 3), chapterTen.questions.slice(3)]) {
      const column = document.createElement('div'); column.className = 'chapter-ten-column';
      for (const line of lines) { const paragraph = document.createElement('p'); paragraph.textContent = line; column.append(paragraph); }
      columns.append(column);
    }
    const ending = document.createElement('div'); ending.className = 'chapter-ten-ending';
    const opening = document.createElement('p'); opening.textContent = chapterTen.opening;
    const summary = document.createElement('p'); const emphasized = document.createElement('strong'); emphasized.textContent = chapterTen.emphasis; summary.append(emphasized, document.createTextNode(chapterTen.closing));
    ending.append(opening, summary); root.append(columns, ending); return;
  }
  root.className = 'scripture chapter-reading-layout';
  for (const block of splitReadingBlocks(text)) {
    if (block.kind === 'text') { const paragraph = document.createElement('p'); paragraph.className = 'chapter-reading-line'; paragraph.textContent = block.text; root.append(paragraph); continue; }
    const group = document.createElement('div'); group.className = `chapter-reading-group chapter-reading-${block.kind}`;
    for (const line of block.lines) { const paragraph = document.createElement('p'); paragraph.textContent = line; group.append(paragraph); }
    root.append(group);
  }
}
function renderReadingBlocks(text: string, chapterNumber: number, fontSize: number, pageStart: number, source: RefObject<HTMLDivElement>, ranges: readonly AnnotationAnchor[]) {
  let offset = pageStart;
  const render = (line: string) => {
    const result = renderAnnotatedText(line, offset, ranges);
    offset += Array.from(line).length;
    return result;
  };
  const chapterTen = chapterNumber === 10 ? splitChapterTen(text) : null;
  if (chapterTen) return <div ref={source} tabIndex={-1} className="scripture chapter-ten-layout" style={{ fontSize }} aria-label={`第 ${chapterNumber} 章原文`}>
    <div className="chapter-ten-questions">{[chapterTen.questions.slice(0, 3), chapterTen.questions.slice(3)].map((column, columnIndex) => <div className="chapter-ten-column" key={columnIndex}>{column.map((line, index) => <p key={index}>{render(line)}</p>)}</div>)}</div>
    <div className="chapter-ten-ending"><p>{render(chapterTen.opening)}</p><p><strong>{render(chapterTen.emphasis)}</strong>{render(chapterTen.closing)}</p></div>
  </div>;
  return <div ref={source} tabIndex={-1} className="scripture chapter-reading-layout" style={{ fontSize }} aria-label={`第 ${chapterNumber} 章原文`}>
    {splitReadingBlocks(text).map((block, index) => block.kind === 'text'
      ? <p className="chapter-reading-line" key={index}>{render(block.text)}</p>
      : <div className={`chapter-reading-group chapter-reading-${block.kind}`} key={index}>{block.lines.map((line, lineIndex) => <p key={lineIndex}>{render(line)}</p>)}</div>)}
  </div>;
}
function paginate(text: string, measure: HTMLDivElement, width: number, height: number, chapterNumber: number): Page[] {
  const chars = Array.from(text); const pages: Page[] = [];
  measure.style.width = `${width}px`;
  let offset = 0;
  while (offset < chars.length) {
    let low = offset + 1, high = chars.length, best = low;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const sample = document.createElement('div'); addReadingMarkup(sample, chars.slice(offset, middle).join(''), chapterNumber); measure.replaceChildren(sample);
      if (measure.scrollHeight <= height) { best = middle; low = middle + 1; } else high = middle - 1;
    }
    pages.push({ chapter: chapterNumber, start: offset, end: best, text: chars.slice(offset, best).join('') }); offset = best;
  }
  measure.replaceChildren();
  return pages;
}
export default function Reader() {
  const number = Number(useParams().number); const chapter = chapters[number - 1];
  const navigate = useNavigate(); const location = useLocation();
  const session = useSession(); const accountId = session.user?.id ?? null;
  const viewport = useRef<HTMLDivElement>(null); const measure = useRef<HTMLDivElement>(null);
  const source = useRef<HTMLDivElement>(null);
  const anchor = useRef(0); const pointer = useRef<{ x: number; y: number; time: number } | null>(null); const drawerPointer = useRef<{ x: number; y: number; height: number; axis: 'pending' | 'vertical' | 'horizontal' } | null>(null); const suppressDrawerClick = useRef(false);
  const [pages, setPages] = useState<Page[]>([]); const [pageIndex, setPageIndex] = useState(0);
  const [font, setFont] = useState(() => { const saved = Number(localState.getItem('ddj-font')); return [18, 20, 22, 24].includes(saved) ? saved : 20; });
  const [drawer, setDrawer] = useState(collapsedDrawerHeight);
  const [drawerChoice, setDrawerChoice] = useState<{ entry: string; tab: DrawerTab }>();
  const [menu, setMenu] = useState(false); const [panel, setPanel] = useState<'contents' | 'settings' | 'source' | null>(null);
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [editor, setEditor] = useState<{ note: AnnotationAnchor | ReaderAnnotation; accountId: string | null } | null>(null);
  const [sentencePicker, setSentencePicker] = useState(false);
  const [channelComments, setChannelComments] = useState(() => new URLSearchParams(location.search).get('panel') === 'channel');
  const [located, setLocated] = useState<AnnotationAnchor | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const enteredChannel = new URLSearchParams(location.search).get('panel') === 'channel';
  const tab = drawerChoice?.entry === location.key ? drawerChoice.tab : enteredChannel ? 'annotations' : 'notes';
  const annotationState = useChapterAnnotations(number, edition.id, accountId, !!chapter && !session.loading);
  const characters = useMemo(() => Array.from(chapter?.text ?? ''), [chapter]);
  const page = pages[pageIndex]?.chapter === number ? pages[pageIndex] : undefined;
  const pageStart = page?.start ?? 0;
  const expanded = drawer * window.innerHeight > 100;
  const activeEditor = editor?.note.chapterNumber === number && editor.accountId === accountId ? editor.note : null;
  const visibleRanges: AnnotationAnchor[] = annotationState.notes.filter(note => matchesAnnotation(note, characters));
  if (located?.chapterNumber === number) visibleRanges.push(located);

  useEffect(() => {
    if (!chapter) return;
    let active = true, timer: ReturnType<typeof setTimeout> | undefined, ticket: string | null = null, sent = false;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      if (!ticket || sent || document.visibilityState !== 'visible') return;
      timer = setTimeout(() => {
        if (!active || sent) return;
        sent = true;
        post(`/chapters/${number}/read`, { ticket }).catch(() => { sent = false; });
      }, 5100);
    };
    fetch(`/api/chapters/${number}/read-ticket`, { credentials: 'same-origin' })
      .then(response => response.json())
      .then(result => { if (active) { ticket = result.data?.ticket || null; schedule(); } })
      .catch(() => {});
    document.addEventListener('visibilitychange', schedule);
    return () => { active = false; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', schedule); };
  }, [number, chapter]);

  useLayoutEffect(() => {
    const saved = readProgress();
    const entry = location.state as { start?: boolean; end?: boolean } | null;
    anchor.current = entry?.start ? 0 : entry?.end ? Number.MAX_SAFE_INTEGER : saved?.chapter === number ? saved.offset : 0;
    setDrawer(enteredChannel ? expandedDrawerHeight() : collapsedDrawerHeight());
  }, [number, location.key, location.state, enteredChannel]);

  useLayoutEffect(() => {
    if (!chapter || !viewport.current || !measure.current) return;
    const layout = () => {
      const box = viewport.current!;
      const next = paginate(chapter.text, measure.current!, box.clientWidth, Math.max(font * 2, box.clientHeight), number);
      const index = Math.max(0, next.findIndex(p => anchor.current >= p.start && anchor.current < p.end));
      setPages(next);
      setPageIndex(anchor.current === Number.MAX_SAFE_INTEGER ? next.length - 1 : index);
      setDrawer(current => current * window.innerHeight > 100 ? current : collapsedDrawerHeight(next.length <= 1));
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
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || activeEditor) return;
      window.getSelection()?.removeAllRanges();
      setSelection(null); setPanel(null); setMenu(false); setDrawer(collapsedDrawerHeight(pages.length <= 1));
    };
    document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape);
  }, [activeEditor, pages.length]);
  useEffect(() => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    if (session.loading || panel || activeEditor) return;
    const update = () => {
      const next = source.current ? readTextSelection(source.current, pageStart, characters, number, edition.id) : null;
      // Mobile selection may collapse when the reader taps the toolbar.
      const retain = window.matchMedia('(pointer: coarse)').matches;
      setSelection(current => next ?? (retain ? current : null));
    };
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.selection-actions')) return;
      setSelection(null);
    };
    document.addEventListener('selectionchange', update);
    document.addEventListener('pointerdown', dismiss, true);
    return () => {
      document.removeEventListener('selectionchange', update);
      document.removeEventListener('pointerdown', dismiss, true);
    };
  }, [number, pageStart, characters, session.loading, panel, activeEditor]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.error ? 6500 : 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!located) return;
    const timer = window.setTimeout(() => setLocated(null), 2400);
    return () => window.clearTimeout(timer);
  }, [located]);
  useEffect(() => {
    setEditor(null); setSentencePicker(false); setLocated(null); setNotice(null);
  }, [number, accountId]);
  if (!chapter || !Number.isInteger(number)) return <div className="page-width"><h1>这一章不存在</h1><Link to="/">返回目录</Link></div>;
  const previousDisabled = number === 1 && pageIndex === 0;
  const nextDisabled = number === 81 && pageIndex === pages.length - 1;
  const explanationSentences = chapter.explanation.split(/(?<=[。！？])/u).map((sentence: string) => sentence.trim()).filter(Boolean);
  const sourceSentences = chapter.text.split(/(?<=[。！？])/u).map((sentence: string) => sentence.trim()).filter(Boolean);
  const sentenceAligned = sourceSentences.length === explanationSentences.length;
  function clearSelection() {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }
  async function saveAnnotation(note: AnnotationAnchor | ReaderAnnotation, body: string) {
    if ('id' in note) {
      if (accountId && note.version !== undefined) await changeAnnotation(accountId, note.id, { version: note.version, body });
      else await editGuestAnnotation(note.id, body);
    } else {
      try { await addAnnotation({ ...note, id: crypto.randomUUID(), body }, accountId); }
      catch { throw new Error('无法保存到此浏览器，请重试'); }
    }
    setEditor(null);
    setNotice({ text: body ? '评论已保存' : '已划线' });
  }
  function openEditor(note: AnnotationAnchor | ReaderAnnotation) {
    clearSelection();
    setEditor({ note, accountId });
  }
  function selectTab(value: DrawerTab) { setDrawerChoice({ entry: location.key, tab: value }); setSentencePicker(false); }
  function locate(note: AnnotationAnchor) {
    const index = pages.findIndex(item => note.start >= item.start && note.start < item.end);
    if (index < 0) return;
    clearSelection();
    setPageIndex(index);
    setDrawer(collapsedDrawerHeight(pages.length <= 1));
    setLocated(note);
    requestAnimationFrame(() => source.current?.focus({ preventScroll: true }));
  }
  async function updateAnnotation(note: ReaderAnnotation, action: 'publish' | 'unpublish' | 'remove') {
    if (accountId && note.version !== undefined) {
      await changeAnnotation(accountId, note.id, action === 'remove'
        ? { version: note.version, deleted: true }
        : { version: note.version, published: action === 'publish' });
    } else if (!accountId && action === 'remove') await editGuestAnnotation(note.id, null);
  }
  function turn(direction: number) {
    clearSelection();
    setLocated(null);
    if (direction > 0) {
      if (pageIndex < pages.length - 1) setPageIndex(x => x + 1);
      else if (number < 81) navigate(`/read/${number + 1}`, { state: { fromReader: true } });
    } else {
      if (pageIndex > 0) setPageIndex(x => x - 1);
      else if (number > 1) navigate(`/read/${number - 1}`, { state: { end: true } });
    }
  }
  function toggleDrawer() {
    if (suppressDrawerClick.current) { suppressDrawerClick.current = false; return; }
    clearSelection();
    setDrawer(expanded ? collapsedDrawerHeight(pages.length <= 1) : expandedDrawerHeight());
    if (expanded) setSentencePicker(false);
  }
  function startDrawerDrag(e: React.PointerEvent<HTMLButtonElement>) {
    suppressDrawerClick.current = false;
    drawerPointer.current = { x: e.clientX, y: e.clientY, height: e.currentTarget.parentElement?.parentElement?.getBoundingClientRect().height || 0, axis: 'pending' };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function moveDrawerDrag(e: React.PointerEvent<HTMLButtonElement>) {
    const start = drawerPointer.current;
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (start.axis === 'pending' && Math.max(Math.abs(dx), Math.abs(dy)) > 8) start.axis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
    if (start.axis !== 'vertical') return;
    suppressDrawerClick.current = true;
    const height = Math.max(92, Math.min(window.innerHeight - 65, start.height - dy));
    setDrawer(height / window.innerHeight);
  }
  return <main className="reader-screen">
    <header className="reader-toolbar"><div className="reader-toolbar-start"><Link className="text-button reader-home-link" to="/" aria-label="回到读书首页"><ArrowLeft size={18}/><span>读书首页</span></Link><button className="text-button" onClick={() => setPanel('contents')}><List size={19}/><span>目录</span></button></div><span>第 {number} 章</span><div className="reader-menu-wrap"><button className="icon-button" aria-label="更多阅读选项" aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal/></button>{menu && <div className="popover"><button onClick={() => { setPanel('settings'); setMenu(false); }}>阅读设置</button><button onClick={() => { setPanel('source'); setMenu(false); }}>版本与来源</button></div>}</div></header>
    <div className={`reader-book${number === 10 ? ' reader-book-chapter-ten' : ''}`}>
      <div className="reader-chapter-heading"><h1>{chapterTitle(number)}</h1><span className="chapter-reference">{chapter.section} · 第 {String(number).padStart(2, '0')} 章</span></div>
      <div className="reader-viewport" ref={viewport} onPointerDown={event => {
        pointer.current = null;
        if (!event.isPrimary || event.pointerType === 'mouse' || event.clientX < 24 || event.clientX > window.innerWidth - 24) return;
        pointer.current = { x: event.clientX, y: event.clientY, time: event.timeStamp };
      }} onPointerUp={event => {
        const start = pointer.current; pointer.current = null;
        if (!start) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        const duration = event.timeStamp - start.time;
        if (duration >= 450) {
          if (event.pointerType === 'touch' && Math.hypot(dx, dy) < 12 && !session.loading && source.current?.contains(event.target as Node)) {
            const native = readTextSelection(source.current, pageStart, characters, number, edition.id);
            const next = native ?? readPressedClause(source.current, start.x, start.y, page ?? { start: 0, end: characters.length }, characters, number, edition.id);
            if (next) setSelection(next);
          }
          return;
        }
        if (window.getSelection()?.toString()) return;
        if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.6) turn(dx < 0 ? 1 : -1);
      }} onPointerCancel={() => { pointer.current = null; }}>
        {renderReadingBlocks(page?.text || chapter.text, number, font, pageStart, source, visibleRanges)}
        <div className="scripture measure" ref={measure} style={{ fontSize: font }} aria-hidden="true"/>
      </div>
    </div>
    <section className="reading-drawer" style={{ '--drawer-height': `${drawer * 100}dvh` } as React.CSSProperties} aria-label="本章阅读与交流">
      <div className={`drawer-handle-row${pages.length <= 1 ? ' single-page' : ''}${expanded ? ' is-expanded' : ''}`}>
        <button className="icon-button drawer-turn" aria-label={pageIndex ? '上一页' : '上一章'} disabled={previousDisabled} onClick={() => turn(-1)}><ArrowLeft size={19}/></button>
        <button className="drawer-handle" aria-label={expanded ? '收起本章阅读与交流' : '展开本章阅读与交流'} aria-expanded={expanded} onClick={toggleDrawer} onPointerDown={startDrawerDrag} onPointerMove={moveDrawerDrag} onPointerUp={() => { drawerPointer.current = null; }} onPointerCancel={() => { drawerPointer.current = null; }}><span className="drawer-grip"/>{drawer > 0.8 && <span className="drawer-chapter">第 {number} 章</span>}{pages.length > 1 && <span className="drawer-page" aria-live="polite">{pageIndex + 1} / {pages.length}</span>}<span className="drawer-collapsed-label">本章阅读与交流</span></button>
        <button className="icon-button drawer-turn" aria-label={pageIndex < pages.length - 1 ? '下一页' : '下一章'} disabled={nextDisabled} onClick={() => turn(1)}><ArrowRight size={19}/></button>
      </div>
      {expanded && <>
        <div className="drawer-tabs" role="tablist" aria-label="本章阅读与交流" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const index = drawerTabs.findIndex(([key]) => key === tab);
          const direction = event.key === 'ArrowLeft' ? -1 : 1;
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? drawerTabs.length - 1 : (index + direction + drawerTabs.length) % drawerTabs.length;
          selectTab(drawerTabs[next][0]);
          event.currentTarget.querySelectorAll('button')[next]?.focus();
        }}>
          {drawerTabs.map(([key, label]) => <button id={`reader-tab-${key}`} key={key} role="tab" aria-selected={tab === key} aria-controls="reader-tab-panel" tabIndex={tab === key ? 0 : -1} onClick={() => selectTab(key)}>{label}</button>)}
        </div>
        <div className="drawer-content" id="reader-tab-panel" key={`${number}-${tab}-${accountId}`} role="tabpanel" aria-labelledby={`reader-tab-${tab}`}>
          {tab === 'notes' && <>
            <div className="annotation-heading"><h2>白话逐句解释</h2></div>
            {sentenceAligned
              ? sourceSentences.map((sentence, index) => <section className="sentence-explanation" key={index}><p className="sentence-source">{sentence}</p><p className="annotation">{explanationSentences[index]}</p></section>)
              : explanationSentences.map((sentence, index) => <p className="annotation" key={index}>{sentence}</p>)}
            <h2>河上公</h2>
            {chapter.commentary ? <>
              <div className="classic-commentary">{chapter.commentary.split('\n').filter(note => note.trim()).map((note, index) => <span className="annotation" key={index}>{note}</span>)}</div>
              <p className="muted"><a href={chapter.commentarySource.urls[chapter.section === '德经' ? 1 : 0]} target="_blank" rel="noreferrer">古注原文 · 维基文库《老子河上公章句》</a></p>
            </> : <p className="muted">古注原文待补。</p>}
          </>}
          {tab === 'annotations' && (sentencePicker
            ? <div className="annotation-sentence-picker">
                <div className="annotation-list-tools"><h2>选一句原文</h2><button className="text-button" onClick={() => setSentencePicker(false)}>返回评论</button></div>
                {Array.from(chapter.text.matchAll(/[^。！？]*[。！？]+|[^。！？]+$/gu), match => {
                  const quote = match[0];
                  const start = Array.from(chapter.text.slice(0, match.index)).length;
                  const end = start + Array.from(quote).length;
                  return <button key={start} onClick={() => {
                    setSentencePicker(false);
                    openEditor({ chapterNumber: number, editionId: edition.id, start, end, quote });
                  }}>{quote}</button>;
                })}
              </div>
            : <>
            <div className="tabs reader-comment-tabs" role="tablist" aria-label="评论内容">
              <button role="tab" aria-selected={!channelComments} className={!channelComments ? 'active' : ''} onClick={() => setChannelComments(false)}>原文评论</button>
              <button role="tab" aria-selected={channelComments} className={channelComments ? 'active' : ''} onClick={() => setChannelComments(true)}>本章频道</button>
            </div>
            {!channelComments
              ? <AnnotationFeed chapter={number} edition={edition.id} accountId={accountId} {...annotationState} characters={characters}
                  chooseSentence={() => setSentencePicker(true)} locate={locate} edit={openEditor} change={updateAnnotation} refresh={annotationState.retry}/>
              : <section aria-labelledby="reader-channel-shares">
            <div className="reader-channel-heading">
              <h2 id="reader-channel-shares">本章频道</h2>
              <div className="reader-channel-actions">
                <Link className="text-button" to={`/compose?chapter=${number}&from=reader`}>新建领读分享</Link>
                <Link className="button primary" to={`/agent/import?chapter=${number}&from=reader`}><Pencil size={16}/>共修上传</Link>
              </div>
            </div>
            <Channel embedded chapterNumber={number}/>
          </section>}
          </>)}
        </div>
      </>}
    </section>
    {selection && (!expanded || !window.matchMedia('(pointer: coarse)').matches) && <SelectionActions selection={selection} bottom={`calc(${drawer * 100}dvh + 12px)`} mark={() => {
      const note = selection.anchor;
      clearSelection();
      void saveAnnotation(note, '').catch(error => setNotice({ text: error.message, error: true }));
    }} write={() => openEditor(selection.anchor)}/>}
    {activeEditor && <AnnotationEditor value={activeEditor} accountId={accountId} close={() => setEditor(null)} save={body => saveAnnotation(activeEditor, body)}/>}
    {notice && <div className="annotation-toast" role={notice.error ? 'alert' : 'status'}>{notice.text}</div>}
    {panel && <div className="modal-backdrop" onClick={() => setPanel(null)}><section className="reader-dialog" role="dialog" aria-modal="true" aria-label={panel === 'contents' ? '章节目录' : panel === 'source' ? '版本与来源' : '阅读设置'} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key !== 'Tab') return; const elements = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input,select,textarea')]; const first = elements[0], last = elements[elements.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }}><header><h2>{panel === 'contents' ? '八十一章' : panel === 'source' ? '版本与来源' : '阅读设置'}</h2><button autoFocus className="icon-button" aria-label="关闭" onClick={() => setPanel(null)}><X/></button></header>{panel === 'contents' ? <div className="dialog-chapters">{chapters.map(c => <button key={c.number} className={c.number === number ? 'selected' : ''} onClick={() => { setPanel(null); if (c.number !== number) navigate(`/read/${c.number}`, { state: { start: true } }); else setPageIndex(0); }}><span>{String(c.number).padStart(2, '0')}</span>{chapterTitle(c.number)}{c.number === number && <small>当前</small>}</button>)}</div> : panel === 'source' ? <div className="source-copy"><p className="eyebrow">{edition.title}</p><h3>{edition.label}</h3><p>{edition.sourceNote}</p><p>{edition.annotationPolicy}</p><small>注释与个人分享均与经典原文分开展示。</small></div> : <div className="font-settings"><p>原文字号</p><div>{[18, 20, 22, 24].map(value => <button aria-label={`原文字号 ${value} 像素`} aria-pressed={font === value} className={font === value ? 'selected' : ''} key={value} onClick={() => setFont(value)} style={{ fontSize: value }}>文<span>{value}</span></button>)}</div><p className="muted">字号变化后保持当前文字位置。本机自动记住你的选择。</p></div>}</section></div>}
  </main>;
}
