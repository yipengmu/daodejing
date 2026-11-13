import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createLocalDatabase } from '../lib/local-db';
import { beginUpload, completeUpload, localUpload, serveMedia } from '../lib/media';

test('数据库媒体分块上传、受控 Range 读取与隐藏', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ddj-media-db-'));
  const database = await createLocalDatabase(directory);
  const db = database.client;
  const originalEnv = process.env.NODE_ENV;
  try {
    const account = await db.account.create({ data: { id: 'media-db-test', passwordHash: 'unusable' } });
    const user = { id: account.id, role: 'MEMBER' } as any;
    process.env.NODE_ENV = 'production';
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).png().toBuffer();
    const start = await beginUpload(new Request('http://localhost/api/media/sign-upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mime: 'image/png', size: png.length }) }), db, user, new Date());
    const { data: upload } = await start.json() as any;
    assert.equal(upload.chunkSize, 2 * 1024 * 1024);
    const split = Math.floor(png.length / 2);
    for (const [offset, chunk] of [[0, png.subarray(0, split)], [split, png.subarray(split)]] as const) {
      await localUpload(new Request(`http://localhost/api/media/${upload.id}/upload?offset=${offset}`, { method: 'PUT', body: Uint8Array.from(chunk) }), db, upload.id, user);
    }
    await completeUpload(db, upload.id, user);
    assert.equal((await db.mediaBlob.findUniqueOrThrow({ where: { mediaId: upload.id } })).data.length, (await db.mediaAsset.findUniqueOrThrow({ where: { id: upload.id } })).size);

    await db.chapter.create({ data: { number: 1, title: '测试章', section: '上篇' } });
    const content = await db.contentItem.create({ data: { authorId: account.id, chapterNumber: 1, body: '测试', publicName: '测试' } });
    const audio = await db.mediaAsset.create({ data: { ownerId: account.id, contentId: content.id, objectKey: 'test/large.mp3', mime: 'audio/mpeg', size: 5 * 1024 * 1024, status: 'READY', blob: { create: { data: new Uint8Array(5 * 1024 * 1024) } } } });
    const first = await serveMedia(new Request(`http://localhost/api/media/${audio.id}`), db, audio.id, null);
    assert.equal(first.status, 206);
    assert.equal(first.headers.get('content-range'), `bytes 0-${2 * 1024 * 1024 - 1}/${audio.size}`);
    assert.equal((await first.arrayBuffer()).byteLength, 2 * 1024 * 1024);
    const later = await serveMedia(new Request(`http://localhost/api/media/${audio.id}`, { headers: { Range: `bytes=${2 * 1024 * 1024}-` } }), db, audio.id, null);
    assert.equal(later.status, 206);
    assert.equal(later.headers.get('content-range'), `bytes ${2 * 1024 * 1024}-${4 * 1024 * 1024 - 1}/${audio.size}`);
    await db.contentItem.update({ where: { id: content.id }, data: { status: 'HIDDEN' } });
    await assert.rejects(() => serveMedia(new Request(`http://localhost/api/media/${audio.id}`, { headers: { Range: 'bytes=0-100' } }), db, audio.id, null), { status: 404 });
  } finally {
    process.env.NODE_ENV = originalEnv;
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
