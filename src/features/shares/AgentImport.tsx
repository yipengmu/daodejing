import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Link2, MessageCircle } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Back } from '../../components/Shared';
import { api } from '../../services/api';
import { chapters, chapterTitle } from '../reading/Library';

export function AgentImport() {
  const [params] = useSearchParams(); const navigate = useNavigate();
  const requested = Number(params.get('chapter')); const [chapter, setChapter] = useState(chapters[requested - 1] ? requested : 1);
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const key = useRef(crypto.randomUUID());
  const token = useRef(Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join(''));
  function change(value: string) { setMessage(value); key.current = crypto.randomUUID(); setError(''); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!message.trim()) return; setBusy(true); setError('');
    try {
      const storageKey = `ddj-agent-token-${key.current}`;
      localStorage.setItem(storageKey, token.current);
      if (localStorage.getItem(storageKey) !== token.current) throw new Error('浏览器无法保存管理凭证，请允许本地存储后重试。');
      const value = message.trim();
      const copiedLink = value.length < 500 ? value.match(/https:\/\/[^\s<>"'，。]+/i)?.[0] : undefined;
      const result = await api<{ id: string }>('/agent-imports', { method: 'POST', headers: { 'Idempotency-Key': key.current }, body: JSON.stringify({ chapter, url: copiedLink || '', text: copiedLink ? '' : value, token: token.current }) });
      localStorage.setItem(`ddj-agent-share-${result.id}`, token.current); localStorage.removeItem(storageKey);
      navigate(`/shares/${result.id}`, { replace: true });
    } catch (e) { setError(e instanceof Error ? e.message : '提交未完成，请稍后重试。'); }
    finally { setBusy(false); }
  }
  return <div className="page-width agent-page"><Back to={`/chapters/${chapter}`} label="回到本章频道"/><header className="agent-heading"><span className="agent-icon"><MessageCircle size={23}/></span><div><p className="eyebrow">一起读书 · 记录助手</p><h1>把共读，留在这里</h1><p>把钉钉听记、飞书妙记的公开链接，或整理好的文字发给我。我会整理成适合阅读的章节分享。</p></div></header>
    <div className="agent-conversation"><div className="agent-greeting"><span className="agent-greeting-mark">道</span><div><strong>共读助手</strong><p>你好，把一场共读的记录交给我吧。请先在来源服务中开启互联网公开访问；如果链接暂时无法读取，也可以直接粘贴导出的文字。</p></div></div>
    <form onSubmit={submit} className="agent-form"><label>分享到哪个章节<select value={chapter} onChange={e => { setChapter(Number(e.target.value)); key.current = crypto.randomUUID(); }}>{chapters.map(c => <option key={c.number} value={c.number}>第 {c.number} 章 · {chapterTitle(c.number)}</option>)}</select></label><label htmlFor="agent-message">分享链接或文字<textarea id="agent-message" rows={9} required maxLength={60000} value={message} onChange={e => change(e.target.value)} placeholder="粘贴飞书妙记、钉钉听记的公开链接，或直接粘贴整理好的文字…"/><small>{message.length.toLocaleString()} / 60,000 字</small></label><div className="agent-notice"><Link2 size={17}/><p>提交后将交由 AI 整理并直接公开在本章。系统会尝试遮盖嘉宾姓名，姓名遮盖不能保证完全匿名；请确认内容可以公开。原始链接不会显示给读者。</p></div>{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary full-width" disabled={busy || !message.trim()}>{busy ? '正在读取与整理，请稍候…' : '发送并公开分享'}<ArrowRight size={17}/></button><p className="agent-footnote">无需登录 · 完成后可在此设备撤回分享</p></form></div><Link className="text-link" to={`/chapters/${chapter}`}>回到本章频道 <ArrowRight size={15}/></Link></div>;
}
