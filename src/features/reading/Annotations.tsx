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

export type TextSelection = {
  anchor: AnnotationAnchor;
  position?: { left: number; top: number; below: boolean };
};

function textOffset(root: HTMLElement, node: Node, offset: number) {
  if (!root.contains(node)) return null;
  const prefix = document.createRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(node, offset);
  return Array.from(prefix.toString()).length;
}

export function readTextSelection(root: HTMLElement, pageStart: number, characters: readonly string[], chapterNumber: number, editionId: string): TextSelection | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const offset = textOffset(root, range.startContainer, range.startOffset);
  if (offset === null || !root.contains(range.endContainer)) return null;
  const quote = range.toString();
  const start = pageStart + offset;
  const anchor = { chapterNumber, editionId, start, end: start + Array.from(quote).length, quote };
  if (!quote.trim() || !matchesAnnotation(anchor, characters)) return null;
  const rect = Array.from(range.getClientRects()).find(item => item.width > 0) ?? range.getBoundingClientRect();
  const below = rect.top < 126;
  return { anchor, position: { left: rect.left + rect.width / 2, top: below ? rect.bottom : rect.top, below } };
}

export function readPressedClause(root: HTMLElement, x: number, y: number, page: { start: number; end: number }, characters: readonly string[], chapterNumber: number, editionId: string): TextSelection | null {
  const position = document.caretPositionFromPoint?.(x, y);
  const range = position ? null : document.caretRangeFromPoint?.(x, y);
  const node = position?.offsetNode ?? range?.startContainer;
  if (!node) return null;
  const offset = textOffset(root, node, position?.offset ?? range?.startOffset ?? 0);
  if (offset === null || page.end <= page.start) return null;

  const punctuation = /[，。！？；、：,.!?;:]/u;
  let start = Math.min(page.start + offset, page.end - 1);
  let end = start + 1;
  while (start > page.start && !punctuation.test(characters[start - 1])) start--;
  while (end < page.end && !punctuation.test(characters[end - 1])) end++;
  const quote = characters.slice(start, end).join('');
  if (!quote.trim() || Array.from(quote).every(char => punctuation.test(char))) return null;
  return { anchor: { chapterNumber, editionId, start, end, quote } };
}

export function SelectionActions({ selection, bottom, mark, write }: { selection: TextSelection; bottom: string; mark: () => void; write: () => void }) {
  const { position } = selection;
  const pinned = !position || window.matchMedia('(pointer: coarse)').matches;
  const style = pinned ? { left: '50%', bottom } : {
    left: Math.max(103, Math.min(window.innerWidth - 103, position.left)),
    top: position.below ? position.top + 12 : position.top - 9,
  };
  return <div className="selection-actions" aria-label="所选原文的操作" role="group"
    style={style} data-pinned={pinned} data-below={!pinned && position.below} onPointerDown={event => {
      if (event.pointerType === 'mouse') event.preventDefault();
    }}>
    {!position && <span className="selection-actions-quote">{selection.anchor.quote}</span>}
    <div className="selection-actions-buttons">
      <button onClick={mark}><Underline size={16}/>划线</button>
      <button onClick={write}><PencilLine size={16}/>写评论</button>
    </div>
  </div>;
}

export function AnnotationEditor({ value, accountId, close, save }: {
  value: AnnotationAnchor & { body?: string; published?: boolean };
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
    catch (cause) { setError(cause instanceof Error ? cause.message : '评论保存失败'); }
    finally { setBusy(false); }
  }
  return <dialog className="reader-dialog annotation-editor" ref={dialog} aria-labelledby="annotation-editor-title"
    onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <header><h2 id="annotation-editor-title">{value.body ? '编辑评论' : '写评论'}</h2><button type="button" className="icon-button" aria-label="关闭评论" onClick={close} disabled={busy}><X size={20}/></button></header>
    <form onSubmit={submit}>
      <blockquote className="annotation-quote">{value.quote}</blockquote>
      <label className="annotation-body-label">你的评论<textarea value={body} onChange={event => setBody(event.target.value.replace(/\0/g, ''))} maxLength={ANNOTATION_BODY_LIMIT} rows={4} required={value.published}/></label>
      <div className="annotation-editor-actions">
        <small>{value.published ? '这条评论已公开' : accountId ? '仅自己可见，自动同步' : '保存到本机，登录后同步'}</small>
        <button className="button primary" disabled={busy || (value.published && !body.trim())}>{busy ? '保存中…' : value.published ? '保存公开修改' : body.trim() ? '保存评论' : '保存划线'}</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  </dialog>;
}

type PublicAnnotationPage = { annotations: PublicAnnotation[]; hasMore: boolean };
type AnnotationEntry = { owned: true; note: ReaderAnnotation } | { owned: false; note: PublicAnnotation };

export function AnnotationFeed({ chapter, edition, accountId, loading, notes, error, characters, chooseSentence, locate, edit, change, refresh }: {
  chapter: number;
  edition: string;
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
  const [page, setPage] = useState(0);
  const [publicPages, setPublicPages] = useState<PublicAnnotationPage[]>([]);
  const [publicError, setPublicError] = useState('');
  const [retry, setRetry] = useState(0);
  const pending = !!accountId && notes.some(note => note.version === undefined);
  const publicLoading = !publicPages[page] && !publicError;
  useEffect(() => {
    const request = new AbortController();
    setPublicError('');
    api<PublicAnnotationPage>(`/chapters/${chapter}/annotations?edition=${encodeURIComponent(edition)}&page=${page}&excludeMine=1`, { signal: request.signal })
      .then(result => {
        if (request.signal.aborted) return;
        setPublicPages(previous => {
          const next = [...previous];
          next[page] = result;
          return next;
        });
      })
      .catch(() => { if (!request.signal.aborted) setPublicError('暂时无法读取公开评论'); });
    return () => request.abort();
  }, [chapter, edition, page, retry]);

  const publicNotes = new Map(publicPages.flatMap(result => result.annotations.map(note => [note.id, note] as const)));
  const entries: AnnotationEntry[] = notes.map(note => ({ owned: true, note }));
  for (const note of publicNotes.values()) {
    if (matchesAnnotation(note, characters)) entries.push({ owned: false, note });
  }
  entries.sort((a, b) => a.note.start - b.note.start || a.note.end - b.note.end);

  async function update(note: ReaderAnnotation, action: 'publish' | 'unpublish' | 'remove') {
    if (action === 'publish' && !window.confirm('公开后，所有读者都能在本章看到你的昵称和这条评论。确定公开？')) return;
    if (action === 'remove' && !window.confirm(note.body ? '删除这条评论和对应的划线？' : '删除这条划线？')) return;
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
      <button className="text-button" disabled={loading} onClick={chooseSentence}><PencilLine size={16}/>写评论</button>
      {!accountId && !loading && <Link className="text-button" to={`/auth?next=/read/${chapter}`}>登录同步</Link>}
      {pending && <button className="text-button" onClick={retryAnnotationSync}>重试同步</button>}
    </div>
    {(loading || publicLoading) && <p className="muted" role="status">正在读取评论…</p>}
    {error && <p className="muted" role="alert">{error} <button className="text-button" onClick={refresh}>重新读取</button></p>}
    {publicError && <p className="muted" role="alert">{publicError} <button className="text-button" onClick={() => setRetry(value => value + 1)}>重试</button></p>}
    {changeError && <p className="form-error" role="alert">{changeError}</p>}
    {!loading && !publicLoading && !error && !publicError && !entries.length && <p className="muted">选中原文即可划线或写评论。</p>}
    <ul className="reader-comment-entries" aria-label="本章评论" role="list">
      {entries.map(entry => {
        const { note } = entry;
        const own = entry.owned ? entry.note : null;
        const canLocate = matchesAnnotation(note, characters);
        const syncing = !!own && !!accountId && own.version === undefined;
        const status = syncing ? '待同步' : own?.published ? '已公开' : accountId ? '仅自己可见' : '保存在本机';
        return <li className="annotation-entry" key={`${entry.owned}-${note.id}`}>
          <small>{entry.owned ? `我 · ${status}` : entry.note.name}{!canLocate && ' · 原文位置已变更'}</small>
          <AnnotationQuote note={note} locate={canLocate ? locate : undefined}/>
          {note.body && <p className="annotation-note-body">{note.body}</p>}
          {own && !syncing && <div className="annotation-entry-actions">
            <button disabled={!!busy} onClick={() => edit(own)}>{own.body ? '编辑评论' : '写评论'}</button>
            {own.published
              ? <button disabled={!!busy} onClick={() => void update(own, 'unpublish')}>收回公开</button>
              : !!accountId && own.body && canLocate && <button disabled={!!busy} onClick={() => void update(own, 'publish')}>公开给读者</button>}
            <button disabled={!!busy} onClick={() => void update(own, 'remove')}>删除</button>
          </div>}
        </li>;
      })}
    </ul>
    {publicPages[page]?.hasMore && <div className="annotation-entry-actions">
      <button onClick={() => setPage(value => value + 1)}>查看更多评论</button>
    </div>}
  </div>;
}

export function AnnotationQuote({ note, locate }: { note: AnnotationAnchor; locate?: (note: AnnotationAnchor) => void }) {
  return <blockquote className="annotation-quote">{locate
    ? <button title="回到这段原文" onClick={() => locate(note)}>{note.quote}</button>
    : note.quote}</blockquote>;
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
