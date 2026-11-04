import { Readable } from 'node:stream';

export async function adaptNode(req: any, res: any, handle: (request: Request) => Promise<Response>, production = false) {
  const host = req.headers.host || '127.0.0.1:3003';
  const url = new URL(req.url || '/', `${production ? 'https' : 'http'}://${host}`);
  const rewritten = url.searchParams.get('path');
  if (rewritten !== null) { url.pathname = `/api/${rewritten}`; url.searchParams.delete('path'); }
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
  headers.set('x-ddj-client-ip', production ? String(req.headers['x-forwarded-for'] || '').split(',')[0] : req.socket?.remoteAddress || 'local');
  let body: BodyInit | undefined;
  if (!['GET', 'HEAD'].includes(req.method)) {
    if (Buffer.isBuffer(req.body)) body = new Uint8Array(req.body);
    else if (req.body !== undefined) body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    else { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); body = new Uint8Array(Buffer.concat(chunks)); }
  }
  const response = await handle(new Request(url, { method: req.method, headers, body }));
  res.statusCode = response.status;
  for (const [key, value] of response.headers) if (key !== 'set-cookie') res.setHeader(key, value);
  const setCookies = response.headers.getSetCookie(); if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
  if (!response.body || req.method === 'HEAD') { res.end(); return; }
  await new Promise<void>((resolve, reject) => { Readable.fromWeb(response.body as any).on('error', reject).pipe(res).on('finish', resolve).on('error', reject); });
}
