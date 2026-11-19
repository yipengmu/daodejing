import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { PencilLine, Underline, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ANNOTATION_BODY_LIMIT, matchesAnnotation, type AnnotationAnchor, type AnnotationDraft, type PublicAnnotation, type SavedAnnotation } from '../../../shared/reading-annotations';
import { ApiError, api } from '../../services/api';
import { myAnnotations, onAnnotations, pendingAnnotations, retryAnnotationSync } from '../../services/readingAnnotations';

export type ReaderAnnotation = AnnotationDraft & { version?: number; published: boolean };
type AnnotationSnapshot = { key: string; notes: ReaderAnnotation[]; error: string };

export function useChapterAnnotations(chapter: number, edition: string, accountId: string | null, enabled: boolean) {
  const key = JSON.stringify([chapter, edition, accountId, enabled]);
  const [snapshot, setSnapshot] = useState<AnnotationSnapshot>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let cloudRequest: AbortController | undefined;
    let localRead = 0;
    let saved: SavedAnnotation[] = [];
    let pending: ReaderAnnotation[] = [];
    let cloudError = '';
    let localError = '';
    function show() {
      const notes = new Map<string, ReaderAnnotation>(pending.map(note => [note.id, note]));
      for (const note of saved) notes.set(note.id, note);
      const error = localError || cloudError;
      setSnapshot({ key, notes: [...notes.values()].sort((a, b) => a.start - b.start || a.end - b.end), error });
    }
    const refreshLocal = async () => {
      const read = ++localRead;
      try {
        const rows = await pendingAnnotations();
        if (!active || read !== localRead) return;
        pending = rows.filter(note => note.accountId === accountId && note.chapterNumber === chapter && note.editionId === edition)
          .map(({ accountId: _owner, ...note }) => ({ ...note, published: false }));
        localError = '';
      } catch {
        if (!active || read !== localRead) return;
        localError = '无法读取此浏览器保存的标注';
      }
      show();
    };
    const refreshCloud = async () => {
      if (!accountId) return;
      cloudRequest?.abort();
      const request = new AbortController();
      cloudRequest = request;
      try {
        const result = await myAnnotations(chapter, edition, accountId, request.signal);
        if (request.signal.aborted) return;
        saved = result.annotations;
        cloudError = '';
        await refreshLocal();
      } catch (cause) {
        if (request.signal.aborted) return;
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 409)) saved = [];
        cloudError = '暂时无法读取云端标注';
        show();
      }
    };
    const stopLocal = onAnnotations('local', refreshLocal);
    const stopCloud = onAnnotations('cloud', refreshCloud);
    window.addEventListener('online', refreshCloud);
    void refreshLocal();
    void refreshCloud();
    return () => {
      active = false;
      cloudRequest?.abort();
      stopLocal();
      stopCloud();
      window.removeEventListener('online', refreshCloud);
    };
  }, [key, accountId, chapter, edition, enabled, retry]);
  const current = snapshot?.key === key ? snapshot : undefined;
  return { notes: current?.notes ?? [], error: current?.error ?? '', loading: !current, retry: () => setRetry(value => value + 1) };
}

export type TextSelection = { anchor: AnnotationAnchor; left: number; top: number; below: boolean };

export function readTextSelection(root: HTMLElement, pageStart: number, characters: readonly string[], chapterNumber: number, editionId: string): TextSelection | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  const quote = range.toString();
  const start = pageStart + Array.from(prefix.toString()).length;
  const anchor = { chapterNumber, editionId, start, end: start + Array.from(quote).length, quote };
  if (!quote.trim() || !matchesAnnotation(anchor, characters)) return null;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0);
  const rect = (coarse ? rects.at(-1) : rects[0]) ?? range.getBoundingClientRect();
  const below = coarse ? rect.bottom < window.innerHeight - 126 : rect.top < 126;
  return { anchor, left: rect.left + rect.width / 2, top: below ? rect.bottom : rect.top, below };
}

export function SelectionActions({ selection, mark, write }: { selection: TextSelection; mark: () => void; write: () => void }) {
  const left = Math.max(103, Math.min(window.innerWidth - 103, selection.left));
  const top = selection.below ? selection.top + 12 : selection.top - 9;
  return <div className="selection-actions" aria-label="所选原文的操作" role="group"
    style={{ left, top }} data-below={selection.below} onPointerDown={event => event.preventDefault()}>
    <button onClick={mark}><Underline size={16}/>划线</button>
    <button onClick={write}><PencilLine size={16}/>写批注</button>
  </div>;
}

export function AnnotationEditor({ value, accountId, close, save }: {
  value: AnnotationAnchor & { id?: string; body?: string; published?: boolean };
  accountId: string | null;
  close: () => void;
  save: (body: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [body, setBody] = useState(value.body ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    element.querySelector('textarea')?.focus();
    return () => element.close();
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try { await save(body.trim()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '批注保存失败'); }
    finally { setBusy(false); }
  }
  return <dialog className="reader-dialog annotation-editor" ref={dialog} aria-labelledby="annotation-editor-title"
    onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <header><h2 id="annotation-editor-title">{value.id ? '编辑批注' : '写批注'}</h2><button type="button" className="icon-button" aria-label="关闭批注" onClick={close} disabled={busy}><X size={20}/></button></header>
    <form onSubmit={submit}>
      <blockquote className="annotation-quote">{value.quote}</blockquote>
      <label className="annotation-body-label">你的批注<textarea value={body} onChange={event => setBody(event.target.value.replace(/\0/g, ''))} maxLength={ANNOTATION_BODY_LIMIT} rows={4} required={value.published}/></label>
      <div className="annotation-editor-actions">
        <small>{value.published ? '这条批注已公开' : accountId ? '仅自己可见' : '保存到本机，登录后同步'}</small>
        <button className="button primary" disabled={busy || (value.published && !body.trim())}>{busy ? '保存中…' : value.published ? '保存公开修改' : body.trim() ? '保存批注' : '保存划线'}</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  </dialog>;
}

export function PersonalAnnotations({ chapter, accountId, loading, notes, error, characters, chooseSentence, locate, edit, change, refresh }: {
  chapter: number;
  accountId: string | null;
  loading: boolean;
  notes: ReaderAnnotation[];
  error: string;
  characters: readonly string[];
  chooseSentence: () => void;
  locate: (note: AnnotationAnchor) => void;
  edit: (note: ReaderAnnotation) => void;
  change: (note: ReaderAnnotation, action: 'publish' | 'unpublish' | 'remove') => Promise<void>;
  refresh: () => void;
}) {
  const [busy, setBusy] = useState<string>();
  const [changeError, setChangeError] = useState('');
  const pending = !!accountId && notes.some(note => note.version === undefined);
  async function update(note: ReaderAnnotation, action: 'publish' | 'unpublish' | 'remove') {
    if (action === 'publish' && !window.confirm('公开后，所有读者都能在本章看到你的昵称和这条批注。确定公开？')) return;
    if (action === 'remove' && !window.confirm('删除这条划线及其批注？')) return;
    setBusy(note.id);
    setChangeError('');
    try { await change(note, action); }
    catch (cause) {
      setChangeError(cause instanceof Error ? cause.message : '操作失败，请重试');
      refresh();
    } finally { setBusy(undefined); }
  }
  return <div className="annotation-list">
    <div className="annotation-list-tools">
      <button className="text-button" disabled={loading} onClick={chooseSentence}><PencilLine size={16}/>按句标注</button>
      {!accountId && !loading && <Link className="text-button" to={`/auth?next=/read/${chapter}`}>登录同步</Link>}
      {pending && <button className="text-button" onClick={retryAnnotationSync}>重试同步</button>}
    </div>
    {loading && <p className="muted" role="status">正在读取标注…</p>}
    {error && <p className="muted" role="alert">{error} <button className="text-button" onClick={refresh}>重新读取</button></p>}
    {changeError && <p className="form-error" role="alert">{changeError}</p>}
    {!loading && !error && notes.length === 0 && <p className="muted">选中原文即可划线或写批注。</p>}
    {notes.map(note => {
      const canLocate = matchesAnnotation(note, characters);
      const syncing = !!accountId && note.version === undefined;
      return <article className="annotation-entry" id={`my-annotation-${note.id}`} key={note.id} tabIndex={-1}>
        <small>{syncing ? '待同步' : note.published ? '已公开' : accountId ? '仅自己可见' : '保存在本机'}{!canLocate && ' · 原文位置已变更'}</small>
        <AnnotationQuote note={note} locate={canLocate ? locate : undefined}/>
        {note.body && <p className="annotation-note-body">{note.body}</p>}
        {!syncing && <div className="annotation-entry-actions">
          <button disabled={!!busy} onClick={() => edit(note)}>{note.body ? '编辑批注' : '写批注'}</button>
          {note.published
            ? <button disabled={!!busy} onClick={() => void update(note, 'unpublish')}>收回公开</button>
            : !!accountId && note.body && canLocate && <button disabled={!!busy} onClick={() => void update(note, 'publish')}>公开给读者</button>}
          <button disabled={!!busy} onClick={() => void update(note, 'remove')}>删除</button>
        </div>}
      </article>;
    })}
  </div>;
}

export function AnnotationQuote({ note, locate }: { note: AnnotationAnchor; locate?: (note: AnnotationAnchor) => void }) {
  return <blockquote className="annotation-quote">{locate
    ? <button title="回到这段原文" onClick={() => locate(note)}>{note.quote}</button>
    : note.quote}</blockquote>;
}

export function ReaderNotes({ chapter, edition, characters, locate }: {
  chapter: number; edition: string; characters: readonly string[]; locate: (note: AnnotationAnchor) => void;
}) {
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{ annotations: PublicAnnotation[]; hasMore: boolean }>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let controller: AbortController | undefined;
    const refresh = () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      setResult(undefined);
      setError('');
      api<{ annotations: PublicAnnotation[]; hasMore: boolean }>(`/chapters/${chapter}/annotations?edition=${encodeURIComponent(edition)}&page=${page}`, { signal: request.signal })
        .then(data => { if (!request.signal.aborted) setResult(data); })
        .catch(() => { if (!request.signal.aborted) setError('暂时无法读取读者注释'); });
    };
    const stop = onAnnotations('cloud', refresh);
    refresh();
    return () => { controller?.abort(); stop(); };
  }, [chapter, edition, page, retry]);
  const notes = result?.annotations.filter(note => matchesAnnotation(note, characters));
  return <div className="annotation-list">
    {error && <p className="muted" role="alert">{error} <button className="text-button" onClick={() => setRetry(value => value + 1)}>重新读取</button></p>}
    {!result && !error && <p className="muted" role="status">正在读取读者注释…</p>}
    {notes?.length === 0 && <p className="muted">{page ? '这一页没有读者注释。' : '本章还没有公开的读者注释。'}</p>}
    {notes?.map((note, index) => <article className="annotation-entry" key={`${note.id}-${index}`}>
      <small>{note.name}</small>
      <AnnotationQuote note={note} locate={locate}/>
      <p className="annotation-note-body">{note.body}</p>
    </article>)}
    {(page > 0 || result?.hasMore) && <div className="annotation-entry-actions">
      {page > 0 && <button onClick={() => setPage(value => value - 1)}>上一组注释</button>}
      {result?.hasMore && <button onClick={() => setPage(value => value + 1)}>下一组注释</button>}
    </div>}
  </div>;
}

export function renderAnnotatedText(text: string, start: number, ranges: readonly AnnotationAnchor[]): ReactNode {
  const characters = Array.from(text);
  const end = start + characters.length;
  const overlaps = ranges.filter(range => range.start < end && range.end > start);
  if (!overlaps.length) return text;
  const boundaries = [...new Set([start, end, ...overlaps.flatMap(range => [Math.max(start, range.start), Math.min(end, range.end)])])].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((from, index) => {
    const content = characters.slice(from - start, boundaries[index + 1] - start).join('');
    const active = overlaps.some(range => range.start <= from && range.end > from);
    return active ? <span className="scripture-underline" key={from}>{content}</span> : content;
  });
}
