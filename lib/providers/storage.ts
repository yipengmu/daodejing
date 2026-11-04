import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import COS from 'cos-nodejs-sdk-v5';
import { ApiError, isProduction } from '../config';

const localRoot = () => path.resolve(process.env.LOCAL_MEDIA_DIR || '.local/media');
export function localStorageEnabled() { return !isProduction() && !process.env.TENCENT_COS_BUCKET; }
function objectPath(key: string) {
  if (!/^[a-zA-Z0-9/_-]+\.[a-z0-9]+$/.test(key)) throw new ApiError(400, '文件地址无效');
  const resolved = path.resolve(localRoot(), key);
  if (!resolved.startsWith(`${localRoot()}${path.sep}`)) throw new ApiError(400, '文件地址无效');
  return resolved;
}
function cos() {
  const { TENCENTCLOUD_SECRET_ID, TENCENTCLOUD_SECRET_KEY, TENCENT_COS_BUCKET, TENCENT_COS_REGION } = process.env;
  if (!TENCENTCLOUD_SECRET_ID || !TENCENTCLOUD_SECRET_KEY || !TENCENT_COS_BUCKET || !TENCENT_COS_REGION) throw new ApiError(503, '媒体上传暂未开放，请稍后再试', 'STORAGE_UNCONFIGURED');
  return { client: new COS({ SecretId: TENCENTCLOUD_SECRET_ID, SecretKey: TENCENTCLOUD_SECRET_KEY, Protocol: 'https:' }), Bucket: TENCENT_COS_BUCKET, Region: TENCENT_COS_REGION };
}
export async function uploadUrl(key: string, mime: string) {
  const { client, ...config } = cos();
  return client.getObjectUrl({ ...config, Key: key, Method: 'PUT', Sign: true, Expires: 300, Headers: { 'Content-Type': mime } });
}
export async function readObject(key: string, range?: string | null): Promise<Response> {
  if (localStorageEnabled()) {
    let data: Buffer;
    try { data = await readFile(objectPath(key)); } catch { throw new ApiError(404, '媒体文件不存在'); }
    const headers = new Headers({ 'Accept-Ranges': 'bytes', 'Content-Length': String(data.length) });
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${data.length}` } });
      const start = match[1] ? Number(match[1]) : Math.max(0, data.length - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(data.length - 1, Number(match[2])) : data.length - 1;
      if (start > end || start >= data.length) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${data.length}` } });
      headers.set('Content-Range', `bytes ${start}-${end}/${data.length}`); headers.set('Content-Length', String(end - start + 1));
      return new Response(new Uint8Array(data.subarray(start, end + 1)), { status: 206, headers });
    }
    return new Response(new Uint8Array(data), { headers });
  }
  const { client, ...config } = cos();
  const signed = client.getObjectUrl({ ...config, Key: key, Method: 'GET', Sign: true, Expires: 30 });
  return fetch(signed, { headers: range ? { Range: range } : {}, redirect: 'error', signal: AbortSignal.timeout(15000) });
}
export async function writeObject(key: string, data: Buffer, mime: string) {
  if (localStorageEnabled()) { const target = objectPath(key); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, data); return; }
  const { client, ...config } = cos();
  await new Promise<void>((resolve, reject) => client.putObject({ ...config, Key: key, Body: data, ContentType: mime, ServerSideEncryption: 'AES256' }, error => error ? reject(error) : resolve()));
}
export async function objectSize(key: string) {
  if (localStorageEnabled()) { const { stat } = await import('node:fs/promises'); try { return (await stat(objectPath(key))).size; } catch { throw new ApiError(400, '文件尚未上传，请重试'); } }
  const { client, ...config } = cos();
  return new Promise<number>((resolve, reject) => client.headObject({ ...config, Key: key }, (error, data) => error ? reject(new ApiError(400, '无法验证上传文件，请重试')) : resolve(Number((data as any).headers?.['content-length']))));
}
