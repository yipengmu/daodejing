import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createLocalDatabase } from '../lib/local-db';
import { createApi } from '../lib/api';
import { seed } from '../scripts/seed';
import { signPoi, type Poi } from '../lib/places';
import { sanitizeMedia } from '../lib/media';
import type { VerificationProvider } from '../lib/providers/verification';

test('MVP-1 PostgreSQL 持久化与共享 API 场景', async t => {
  const database = await createLocalDatabase(process.env.TEST_DB_DIR!); const db = database.client;
  let now = new Date('2026-11-03T07:00:00Z');
  const emailCodes = new Map<string, string>(); const phoneCodes = new Map<string, string>();
  const verification: VerificationProvider = { async sendEmail(to, code) { emailCodes.set(to, code); }, async sendPhone(phone, ref) { phoneCodes.set(`${phone}:${ref}`, '654321'); }, async checkPhone(phone, code, ref) { return phoneCodes.get(`${phone}:${ref}`) === code; } };
  const handle = createApi({ db, verification, clock: () => now });
  class Client {
    cookie = new Map<string, string>(); ip = randomUUID();
    async call(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
      const response = await handle(new Request(`http://localhost/api${path}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json' } : {}), Cookie: [...this.cookie].map(([key, value]) => `${key}=${value}`).join('; '), 'X-DDJ-Client-IP': this.ip, ...(method === 'POST' ? { 'Idempotency-Key': randomUUID() } : {}), ...headers }, ...(body !== undefined ? { body: Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body) } : {}) }));
      for (const line of response.headers.getSetCookie()) { const pair = line.split(';')[0]; const index = pair.indexOf('='); this.cookie.set(pair.slice(0, index), pair.slice(index + 1)); }
      const data = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() as any : null;
      return { status: response.status, data: data?.data, error: data?.error, response };
    }
  }
  async function register(identifier: string, name: string) {
    const client = new Client(); const sent = await client.call('/auth/send-code', 'POST', { identifier, purpose: 'REGISTER' }); assert.equal(sent.status, 200, JSON.stringify(sent.error));
    const result = await client.call('/auth/register', 'POST', { identifier, name, password: 'ReadTogether!2026', code: identifier.includes('@') ? emailCodes.get(identifier) : '654321', challengeId: sent.data.challengeId }); assert.equal(result.status, 200, JSON.stringify(result.error));
    return { client, user: result.data.user, identifier };
  }
  const guest = new Client();
  let author: Awaited<ReturnType<typeof register>>, other: Awaited<ReturnType<typeof register>>, admin: Awaited<ReturnType<typeof register>>;
  let shareId = '', mediaId = '';
  try {
    await seed(db);
    await t.test('81 章/频道与 9 个提供地点导入，公开 DTO 不泄漏原始地址与联系方式', async () => {
      assert.equal(await db.chapter.count(), 81); assert.equal(await db.chapterChannel.count(), 81);
      const places = await guest.call('/places'); assert.equal(places.status, 200); assert.equal(places.data.places.length, 9);
      for (const place of places.data.places) { assert.equal(place.contact, null); assert.equal('sourcePrivate' in place, false); assert.equal('ownerId' in place, false); assert.equal('unit' in place, false); }
      assert.ok(!JSON.stringify(places.data).includes('1301'));
    });
    await t.test('游客可提交 VOC；幂等重试只存一条，同键不同内容冲突', async () => {
      const key = randomUUID(); const first = await guest.call('/feedback', 'POST', { body: '阅读字号设置很方便，希望保留清晰的来源。' }, { 'Idempotency-Key': key });
      const repeat = await guest.call('/feedback', 'POST', { body: '阅读字号设置很方便，希望保留清晰的来源。' }, { 'Idempotency-Key': key });
      assert.equal(first.status, 201); assert.equal(repeat.data.id, first.data.id);
      assert.equal((await db.feedback.findUniqueOrThrow({ where: { id: first.data.id } })).accountId, null);
      assert.equal((await guest.call('/feedback', 'POST', { body: '另一条建议' }, { 'Idempotency-Key': key })).status, 409);
    });
    await t.test('游客写操作要求登录；认证服务未配置时不发开发验证码', async () => {
      assert.equal((await guest.call('/shares', 'POST', {})).status, 401);
      assert.equal((await guest.call('/gatherings', 'POST', {})).status, 401);
      assert.equal((await guest.call('/media/sign-upload', 'POST', { mime: 'image/png', size: 20 })).status, 401);
      const live = createApi({ db }); const result = await live(new Request('http://localhost/api/auth/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'not-configured@example.test', purpose: 'REGISTER' }) }));
      assert.equal(result.status, 503); assert.equal(await db.verification.count({ where: { provider: 'DEV' } }), 0);
    });
    await t.test('注册、登录、一次性验证码和公开资料边界', async () => {
      author = await register('author@example.test', '作者甲'); other = await register('other@example.test', '读者乙'); admin = await register('admin@example.test', '维护者');
      await db.account.update({ where: { id: admin.user.id }, data: { role: 'ADMIN' } });
      const me = await author.client.call('/auth/me'); assert.equal(me.data.user.name, '作者甲'); assert.equal('passwordHash' in me.data.user, false);
      const logged = new Client(); assert.equal((await logged.call('/auth/login', 'POST', { identifier: 'author@example.test', password: 'wrong-password' })).status, 401);
      assert.equal((await logged.call('/auth/login', 'POST', { identifier: 'author@example.test', password: 'ReadTogether!2026' })).status, 200);
      const challenge = await author.client.call('/auth/send-code', 'POST', { identifier: 'new@example.test', purpose: 'REGISTER' });
      const payload = { identifier: 'new@example.test', name: '新读者', password: 'ReadTogether!2026', challengeId: challenge.data.challengeId, code: emailCodes.get('new@example.test') };
      assert.equal((await author.client.call('/auth/register', 'POST', payload)).status, 200);
      assert.equal((await author.client.call('/auth/register', 'POST', payload)).status, 400);
      await author.client.call('/auth/login', 'POST', { identifier: author.identifier, password: 'ReadTogether!2026' });
    });
    await t.test('实际 Vite 代理保留同源登录，外部 Origin 写入仍被拒绝', async () => {
      const { createServer } = await import('node:http');
      const { createServer: createVite } = await import('vite');
      const { adaptNode } = await import('../lib/transport');
      const server = createServer((req, res) => { void adaptNode(req, res, handle); });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const previousPort = process.env.API_PORT;
      process.env.API_PORT = String((server.address() as { port: number }).port);
      const vite = await createVite({ configFile: 'vite.config.ts', logLevel: 'silent', server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false } });
      try {
        await vite.listen(); const origin = `http://127.0.0.1:${(vite.httpServer!.address() as { port: number }).port}`;
        const init = { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ identifier: other.identifier, password: 'ReadTogether!2026' }) };
        const result = await fetch(`${origin}/api/auth/login`, init);
        assert.equal(result.status, 200); assert.ok(result.headers.getSetCookie().some(value => value.startsWith('ddj_session=')));
        const denied = await fetch(`${origin}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.invalid' }, body: JSON.stringify({ body: '跨站提交' }) });
        assert.equal(denied.status, 403);
      } finally {
        await vite.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
        if (previousPort === undefined) delete process.env.API_PORT; else process.env.API_PORT = previousPort;
      }
    });
    await t.test('匿名分享使用匿名快照；不能伪造时间或绑定他人的附件', async () => {
      const result = await author.client.call('/shares', 'POST', { chapter: 1, title: '慢慢读这一章', body: '留一点时间，听见自己真实的体会。', anonymous: true, acknowledge: true });
      assert.equal(result.status, 201, JSON.stringify(result.error)); shareId = result.data.id;
      const detail = await guest.call(`/shares/${shareId}`); assert.equal(detail.data.name, '一位共读者'); assert.equal(detail.data.avatar, 0); assert.equal('authorId' in detail.data, false); assert.ok(!JSON.stringify(detail.data).includes('author@example.test'));
      assert.equal((await author.client.call('/shares', 'POST', { chapter: 1, body: '正文', acknowledge: true, createdAt: '2000-01-01' })).status, 400);
    });
    await t.test('点赞幂等；单层评论作者自删和管理员权限', async () => {
      assert.equal((await guest.call(`/shares/${shareId}/like`, 'PUT', { liked: true })).status, 401);
      for (let n = 0; n < 3; n++) assert.equal((await other.client.call(`/shares/${shareId}/like`, 'PUT', { liked: true })).data.likes, 1);
      const result = await other.client.call(`/shares/${shareId}/comments`, 'POST', { body: '读完之后，我也想到一种不同的理解。' }); assert.equal(result.status, 201);
      assert.equal((await author.client.call(`/comments/${result.data.id}`, 'DELETE')).status, 403);
      assert.equal((await admin.client.call(`/comments/${result.data.id}`, 'DELETE')).status, 200);
      assert.equal((await guest.call(`/shares/${shareId}/comments`)).data.comments.length, 0);
    });
    await t.test('曝光不计阅读；五秒票据、并发去重、上海自然日换日和游客登录合并', async () => {
      const viewer = new Client(); const detail = await viewer.call(`/shares/${shareId}`); const ticket = detail.data.readTicket;
      await viewer.call(`/shares/${shareId}/exposure`, 'POST', {});
      assert.equal((await db.contentItem.findUniqueOrThrow({ where: { id: shareId } })).viewsCount, 0);
      assert.equal((await viewer.call(`/shares/${shareId}/view`, 'POST', { ticket })).status, 400);
      now = new Date(now.getTime() + 5100);
      const readings = await Promise.all(Array.from({ length: 6 }, () => viewer.call(`/shares/${shareId}/view`, 'POST', { ticket })));
      assert.ok(readings.every(x => x.status === 200), JSON.stringify(readings.map(x => x.error)));
      assert.equal((await db.contentItem.findUniqueOrThrow({ where: { id: shareId } })).viewsCount, 1);
      await viewer.call('/auth/login', 'POST', { identifier: other.identifier, password: 'ReadTogether!2026' });
      const loginTicket = (await viewer.call(`/shares/${shareId}`)).data.readTicket; now = new Date(now.getTime() + 5100);
      assert.equal((await viewer.call(`/shares/${shareId}/view`, 'POST', { ticket: loginTicket })).data.views, 1);
      now = new Date('2026-11-03T16:00:00Z'); const tomorrow = (await viewer.call(`/shares/${shareId}`)).data.readTicket; now = new Date(now.getTime() + 5100);
      assert.equal((await viewer.call(`/shares/${shareId}/view`, 'POST', { ticket: tomorrow })).data.views, 2);
    });
    await t.test('频道按累计有效阅读优先、并列次序稳定；爱心不覆盖主排序，登录 VOC 关联账号', async () => {
      const rows = await db.contentItem.createManyAndReturn({ data: [
        { authorId: author.user.id, chapterNumber: 80, title: '阅读多', body: '累计阅读优先', publicName: '作者甲', publicAvatar: 0, viewsCount: 10, createdAt: new Date('2026-11-01T00:00:00Z'), acknowledgementVersion: 'mvp1-v1' },
        { authorId: author.user.id, chapterNumber: 80, title: '最新', body: '较新的分享', publicName: '作者甲', publicAvatar: 0, viewsCount: 1, createdAt: new Date('2026-11-03T00:00:00Z'), acknowledgementVersion: 'mvp1-v1' },
        { authorId: author.user.id, chapterNumber: 80, title: '并列', body: '并列阅读较新优先', publicName: '作者甲', publicAvatar: 0, viewsCount: 10, createdAt: new Date('2026-11-02T00:00:00Z'), acknowledgementVersion: 'mvp1-v1' },
      ] });
      await db.contentLike.create({ data: { contentId: rows[1].id, accountId: other.user.id } });
      const ranked = await guest.call('/shares?chapter=80');
      assert.deepEqual(ranked.data.shares.map((row: any) => row.title), ['并列', '阅读多', '最新']);
      const latest = await guest.call('/shares?chapter=80&sort=latest');
      assert.deepEqual(latest.data.shares.map((row: any) => row.title), ['最新', '并列', '阅读多']);
      const feedback = await author.client.call('/feedback', 'POST', { body: '登录用户也能提交产品建议。' });
      assert.equal(feedback.status, 201); assert.equal((await db.feedback.findUniqueOrThrow({ where: { id: feedback.data.id } })).accountId, author.user.id);
      assert.equal((await guest.call(`/shares/${shareId}/comments?page=0.5`)).status, 400);
    });
    await t.test('媒体检查实际格式、清理图片 metadata；隐藏后旧地址和 Range 都拒绝读取', async () => {
      const image = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#88aa77' } }).png().withMetadata().toBuffer();
      const upload = await author.client.call('/media/sign-upload', 'POST', { mime: 'image/png', size: image.length }); assert.equal(upload.status, 201); mediaId = upload.data.id;
      assert.equal((await other.client.call(`/media/${mediaId}/upload`, 'PUT', image)).status, 403);
      assert.equal((await author.client.call(`/media/${mediaId}/upload`, 'PUT', image)).status, 200);
      assert.equal((await author.client.call(`/media/${mediaId}/complete`, 'POST', {})).status, 200);
      const bound = await author.client.call('/shares', 'POST', { chapter: 2, body: '带一张图片的章节分享。', mediaIds: [mediaId], acknowledge: true }); assert.equal(bound.status, 201);
      const asset = await guest.call(`/media/${mediaId}`); assert.equal(asset.status, 200); assert.match(asset.response.headers.get('cache-control')!, /no-store/);
      const metadata = await sharp(Buffer.from(await asset.response.arrayBuffer())).metadata(); assert.equal(metadata.exif, undefined);
      assert.equal((await guest.call(`/media/${mediaId}`, 'GET', undefined, { Range: 'bytes=0-9' })).status, 206);
      assert.equal((await other.client.call(`/shares/${bound.data.id}`, 'PATCH', { status: 'HIDDEN' })).status, 403);
      assert.equal((await author.client.call(`/shares/${bound.data.id}`, 'PATCH', { status: 'HIDDEN' })).status, 200);
      assert.equal((await guest.call(`/media/${mediaId}`)).status, 404);
      assert.equal((await guest.call(`/media/${mediaId}`, 'GET', undefined, { Range: 'bytes=0-9' })).status, 404);
      assert.equal((await guest.call(`/shares/${bound.data.id}/comments`)).status, 404);
      assert.equal((await admin.client.call(`/shares/${bound.data.id}`, 'PATCH', { status: 'PUBLISHED' })).status, 200);
      assert.equal((await guest.call(`/media/${mediaId}`)).status, 200);
    });
    await t.test('无地点共读可保存；原始提交不合并，HTTP 重试幂等；不能回填时间', async () => {
      const key = randomUUID(); const body = { chapter: 3, leadReader: '本场领读人', publicConfirm: true };
      const [one, two] = await Promise.all([author.client.call('/gatherings', 'POST', body, { 'Idempotency-Key': key }), author.client.call('/gatherings', 'POST', body, { 'Idempotency-Key': key })]);
      assert.equal(one.status, 201); assert.equal(one.data.id, two.data.id);
      const record = await guest.call(`/gatherings/${one.data.id}`); assert.equal(record.data.place, null); assert.equal(record.data.leadReader, '本场领读人');
      const another = await other.client.call('/gatherings', 'POST', body); assert.notEqual(another.data.id, one.data.id);
      assert.equal((await author.client.call('/gatherings', 'POST', { ...body, submittedAt: '2000-01-01' })).status, 400);
    });
    await t.test('临时 POI 必须有服务端确认票据；地图显示临时点，记录隐藏后撤下', async () => {
      const poi: Poi = { id: 'trusted-poi', name: '测试公共阅读空间', address: '测试公开地址', province: '浙江省', city: '杭州市', district: '西湖区', longitude: 120.1, latitude: 30.2 };
      assert.equal((await author.client.call('/gatherings', 'POST', { chapter: 4, leadReader: '领读者', poiToken: 'forged', publicConfirm: true })).status, 400);
      const token = signPoi(poi, author.user.id, now);
      const created = await author.client.call('/gatherings', 'POST', { chapter: 4, leadReader: '领读者', poiToken: token, publicConfirm: true }); assert.equal(created.status, 201);
      const places = (await guest.call('/places')).data.places; const temporary = places.find((x: any) => x.poiId === poi.id); assert.equal(temporary.type, 'TEMPORARY'); assert.equal(temporary.gatheringId, created.data.id);
      assert.equal((await other.client.call(`/gatherings/${created.data.id}`, 'PATCH', { status: 'HIDDEN' })).status, 403);
      assert.equal((await author.client.call(`/gatherings/${created.data.id}`, 'PATCH', { status: 'HIDDEN' })).status, 200);
      assert.ok(!(await guest.call('/places')).data.places.some((x: any) => x.id === temporary.id));
    });
    await t.test('道场资料由创建者管理；改址后旧 POI 不继续绘制', async () => {
      const poi: Poi = { id: 'dojo-poi', name: '道场测试空间', address: '公开地址', province: '浙江省', city: '杭州市', district: '', longitude: 120.2, latitude: 30.2 };
      const body = { name: '道场测试空间', address: '公开地址', poiToken: signPoi(poi, author.user.id, now), publicConfirm: true };
      const created = await author.client.call('/places', 'POST', body); assert.equal(created.status, 201); assert.ok(created.data.longitude);
      assert.equal((await other.client.call(`/places/${created.data.id}`, 'PATCH', { name: body.name, address: body.address, publicConfirm: true })).status, 403);
      const changed = await author.client.call(`/places/${created.data.id}`, 'PATCH', { name: body.name, address: '另一个地址', publicConfirm: true }); assert.equal(changed.status, 200); assert.equal(changed.data.longitude, null);
      assert.equal((await other.client.call(`/places/${created.data.id}`, 'DELETE')).status, 403);
    });
    await t.test('手机号重置额度原子执行，旧 JWT 撤销，邮箱恢复需验证归属', async () => {
      const phone = await register('13900000001', '手机读者'); now = new Date(now.getTime() + 61000);
      const previousSession = new Client(); await previousSession.call('/auth/login', 'POST', { identifier: phone.identifier, password: 'ReadTogether!2026' });
      const sent = await phone.client.call('/auth/send-code', 'POST', { identifier: phone.identifier, purpose: 'RESET' }); assert.equal(sent.status, 200);
      const resetting = await Promise.all(Array.from({ length: 2 }, () => phone.client.call('/auth/reset-password', 'POST', { identifier: phone.identifier, code: '654321', challengeId: sent.data.challengeId, password: 'NewPassword!2026' })));
      assert.deepEqual(resetting.map(x => x.status).sort(), [200, 429]);
      assert.equal((await phone.client.call('/auth/me')).data.user, null);
      assert.equal((await previousSession.call('/auth/me')).data.user, null);
      now = new Date(now.getTime() + 61000); const again = await phone.client.call('/auth/send-code', 'POST', { identifier: phone.identifier, purpose: 'RESET' });
      const denied = await phone.client.call('/auth/reset-password', 'POST', { identifier: phone.identifier, code: '654321', challengeId: again.data.challengeId, password: 'AnotherPass!2026' }); assert.equal(denied.status, 429); assert.ok(denied.error.retryAt);
      const recovery = await author.client.call('/auth/send-code', 'POST', { identifier: 'recover@example.test', purpose: 'RECOVERY' });
      assert.equal((await other.client.call('/auth/bind-recovery', 'POST', { identifier: 'recover@example.test', code: emailCodes.get('recover@example.test'), challengeId: recovery.data.challengeId })).status, 400);
      assert.equal((await author.client.call('/auth/bind-recovery', 'POST', { identifier: 'recover@example.test', code: emailCodes.get('recover@example.test'), challengeId: recovery.data.challengeId })).status, 200);
    });
    await t.test('音频 metadata 清理和实际时长限制，伪造图片格式不能完成上传', async () => {
      function wav(seconds: number) {
        const samples = seconds * 100; const data = Buffer.alloc(samples * 2); const header = Buffer.alloc(44);
        header.write('RIFF'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(100, 24); header.writeUInt32LE(200, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
        return Buffer.concat([header, data]);
      }
      const cleaned = await sanitizeMedia(wav(1), 'audio/wav'); assert.ok(cleaned.length > 44);
      await assert.rejects(sanitizeMedia(wav(601), 'audio/wav'));
      const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).png().toBuffer();
      const asset = await author.client.call('/media/sign-upload', 'POST', { mime: 'image/jpeg', size: png.length });
      await author.client.call(`/media/${asset.data.id}/upload`, 'PUT', png);
      assert.equal((await author.client.call(`/media/${asset.data.id}/complete`, 'POST', {})).status, 400);
    });
    await t.test('个人记录分页可到达后续数据，异常页码不进入数据库查询', async () => {
      await db.contentItem.createMany({ data: Array.from({ length: 21 }, (_, index) => ({ authorId: other.user.id, chapterNumber: 81, body: `分页验证 ${index}`, publicName: '分页读者', publicAvatar: 0, acknowledgementVersion: 'mvp1-v1' })) });
      await db.gatheringSubmission.createMany({ data: Array.from({ length: 21 }, (_, index) => ({ submitterId: other.user.id, chapterNumber: 81, leadReader: `领读人 ${index}` })) });
      await db.dojo.createMany({ data: Array.from({ length: 21 }, (_, index) => ({ ownerId: other.user.id, name: `分页道场 ${index}`, address: '测试公开地点' })) });
      for (const key of ['shares', 'gatherings', 'places']) {
        const first = await other.client.call(`/me/${key}?sort=latest&page=0`);
        const next = await other.client.call(`/me/${key}?sort=latest&page=1`);
        assert.equal(first.status, 200); assert.equal(first.data[key].length, 20); assert.equal(first.data.hasMore, true);
        assert.equal(next.status, 200); assert.ok(next.data[key].length > 0);
        assert.ok(!next.data[key].some((row: any) => first.data[key].some((initial: any) => initial.id === row.id)));
        assert.equal((await other.client.call(`/me/${key}?page=0.5`)).status, 400);
      }
    });
    await t.test('跨来源写入拒绝；数据库约束和审计真实生效', async () => {
      assert.equal((await guest.call('/feedback', 'POST', { body: '跨站建议' }, { Origin: 'https://attacker.invalid' })).status, 403);
      await assert.rejects(db.profile.update({ where: { accountId: author.user.id }, data: { avatar: 100 } }));
      assert.ok(await db.auditEvent.count() > 0);
    });
    await t.test('关闭并重新打开本地 PostgreSQL 后，业务数据与迁移状态保留', async () => {
      const count = await db.contentItem.count(); await database.close();
      const reopened = await createLocalDatabase(process.env.TEST_DB_DIR!);
      try { assert.equal(await reopened.client.contentItem.count(), count); assert.equal(await reopened.client.chapter.count(), 81); } finally { await reopened.close(); }
    });
  } finally { await database.close(); }
});
