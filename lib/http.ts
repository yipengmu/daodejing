import { z } from 'zod';
import { ApiError } from './config';

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export async function input<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T>> {
  let value: unknown;
  try { value = await request.json(); } catch { throw new ApiError(400, '请求内容不正确', 'INVALID_JSON'); }
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, result.error.issues[0]?.message || '请检查填写内容', 'VALIDATION_FAILED');
  return result.data;
}
export function cookies(request: Request) {
  return Object.fromEntries((request.headers.get('cookie') || '').split(';').map(x => x.trim().split('=')).filter(x => x.length === 2).map(([key, value]) => [key, value]));
}
export function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
export const chapterNumber = z.coerce.number().int().min(1, '请选择章节').max(81, '请选择章节');
export const pageNumber = (params: URLSearchParams) => z.coerce.number().int().min(0).max(1000).parse(params.get('page') || 0);
export const safeUrl = z.string().trim().max(1000).refine(value => !value || /^https?:\/\//i.test(value), '来源链接需以 http:// 或 https:// 开头');
export const passwordSchema = z.string().min(10, '密码至少 10 位').max(128, '密码最多 128 位');
export const cleanText = (max: number) => z.string().trim().min(1, '请填写内容').max(max, `内容最多 ${max} 字`);
