// 浏览器禁止存储或空间不足时，阅读和提交操作仍可继续。
function safeStorage(kind: 'localStorage' | 'sessionStorage') {
  const key = (value: string) => `ddj:v1:${value.replace(/^ddj-/, '')}`;
  return {
    getItem(value: string) { try { return window[kind].getItem(key(value)); } catch { return null; } },
    setItem(value: string, data: string) { try { window[kind].setItem(key(value), data); } catch { /* 进度/草稿恢复尽力提供，不阻塞核心任务。 */ } },
    removeItem(value: string) { try { window[kind].removeItem(key(value)); } catch { /* 浏览器可能禁用存储。 */ } },
  };
}
export const localState = safeStorage('localStorage');
export const sessionState = safeStorage('sessionStorage');
export function clearDrafts() { try { for (const key of Object.keys(sessionStorage)) if (key.startsWith('ddj:v1:draft-')) sessionStorage.removeItem(key); } catch { /* 不影响退出登录。 */ } }
