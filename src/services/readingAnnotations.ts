import { useEffect } from 'react';
import { ANNOTATION_BATCH_SIZE, type AnnotationDraft, type SavedAnnotation } from '../../shared/reading-annotations';
import { api } from './api';

type PendingAnnotation = AnnotationDraft & { accountId: string | null };
type AnnotationEvent = 'local' | 'queued' | 'cloud';
const events = new EventTarget();
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('ddj-reading-annotations');
channel?.addEventListener('message', event => events.dispatchEvent(new Event(event.data)));
let database: Promise<IDBDatabase> | undefined;

function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('ddj-reading-annotations', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pending', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => { database = undefined; throw error; });
  return database;
}

async function withPending<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, finish: (result: T) => void) => void) {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction('pending', mode);
    let result: T;
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error ?? new Error('无法保存到此浏览器'));
    work(transaction.objectStore('pending'), value => { result = value; });
  });
}

function notify(event: AnnotationEvent) {
  events.dispatchEvent(new Event(event));
  channel?.postMessage(event);
}

export function onAnnotations(event: AnnotationEvent, listener: () => void) {
  events.addEventListener(event, listener);
  return () => events.removeEventListener(event, listener);
}

export function pendingAnnotations() {
  return withPending<PendingAnnotation[]>('readonly', (store, finish) => {
    const request = store.getAll();
    request.onsuccess = () => finish(request.result);
  });
}

export async function addAnnotation(note: AnnotationDraft, accountId: string | null) {
  await withPending<void>('readwrite', (store, finish) => {
    store.add({ ...note, accountId });
    finish();
  });
  notify('local');
  if (accountId) notify('queued');
}

export async function editGuestAnnotation(id: string, body: string | null) {
  const updated = await withPending<boolean>('readwrite', (store, finish) => {
    const request = store.get(id);
    request.onsuccess = () => {
      const current: PendingAnnotation | undefined = request.result;
      if (!current || current.accountId) { finish(false); return; }
      if (body === null) store.delete(id);
      else store.put({ ...current, body });
      finish(true);
    };
  });
  if (!updated) throw new Error('这条标注已变更，请查看最新列表');
  notify('local');
}

function claimGuestAnnotations(accountId: string) {
  return withPending<void>('readwrite', (store, finish) => {
    const request = store.getAll();
    request.onsuccess = () => {
      for (const note of request.result as PendingAnnotation[]) {
        if (note.accountId === null) store.put({ ...note, accountId });
      }
      finish();
    };
  });
}

function acknowledgeAnnotations(ids: string[]) {
  return withPending<void>('readwrite', (store, finish) => {
    for (const id of ids) store.delete(id);
    finish();
  });
}

function accountHeaders(accountId: string) {
  return { 'X-DDJ-Annotation-Account': accountId };
}

export function myAnnotations(chapter: number, edition: string, accountId: string, signal: AbortSignal) {
  return api<{ annotations: SavedAnnotation[] }>(`/me/annotations?chapter=${chapter}&edition=${encodeURIComponent(edition)}`, { headers: accountHeaders(accountId), signal });
}

export async function changeAnnotation(accountId: string, id: string, change: { version: number; body?: string; published?: boolean; deleted?: true }) {
  const result = await api<{ annotation: SavedAnnotation | null }>(`/me/annotations/${id}`, {
    method: 'PATCH', body: JSON.stringify(change), headers: accountHeaders(accountId),
  });
  notify('cloud');
  return result.annotation;
}

export function retryAnnotationSync() { notify('queued'); }

export function useAnnotationSync(accountId: string | undefined) {
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    let running = false;
    let queued = false;
    const sync = async () => {
      if (running || controller.signal.aborted) { queued = true; return; }
      running = true;
      try {
        let pending = await pendingAnnotations();
        if (pending.some(note => note.accountId === null)) {
          const session = await api<{ user: { id: string } | null }>('/auth/me', { signal: controller.signal });
          if (controller.signal.aborted || session.user?.id !== accountId) return;
          await claimGuestAnnotations(accountId);
          notify('local');
          pending = await pendingAnnotations();
        }
        const own = pending.filter(note => note.accountId === accountId);
        for (let index = 0; index < own.length && !controller.signal.aborted; index += ANNOTATION_BATCH_SIZE) {
          const batch = own.slice(index, index + ANNOTATION_BATCH_SIZE).map(({ accountId: _accountId, ...note }) => note);
          await api('/me/annotations', {
            method: 'POST', body: JSON.stringify({ annotations: batch }), headers: accountHeaders(accountId), signal: controller.signal,
          });
          await acknowledgeAnnotations(batch.map(note => note.id));
          notify('cloud');
        }
      } catch {
        // Keep everything that hasn't been acknowledged for the same account's next retry.
      } finally {
        running = false;
        if (queued && !controller.signal.aborted) { queued = false; void sync(); }
      }
    };
    const stop = onAnnotations('queued', sync);
    void sync();
    window.addEventListener('online', sync);
    window.addEventListener('focus', sync);
    return () => {
      controller.abort();
      stop();
      window.removeEventListener('online', sync);
      window.removeEventListener('focus', sync);
    };
  }, [accountId]);
}
