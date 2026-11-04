export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...init, headers: { ...(init.body && !(init.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
  const result = await response.json().catch(() => ({ error: { message: '服务暂时不可用，请稍后重试' } }));
  if (!response.ok) throw new ApiError(response.status, result.error?.message || '请求失败', result.error);
  return result.data;
}
export function post<T>(path: string, body: unknown = {}) { return api<T>(path, { method: 'POST', body: JSON.stringify(body) }); }
export function patch<T>(path: string, body: unknown) { return api<T>(path, { method: 'PATCH', body: JSON.stringify(body) }); }
export const formatDate = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
