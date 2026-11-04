import type { ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, Heart, MessageCircle } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar } from './Avatar';
import type { Share } from '../types';
import { formatDate } from '../services/api';

export function PageHead({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return <header className="page-head"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1></div>{children}</header>;
}
export function Back({ to, label = '返回' }: { to?: string; label?: string }) {
  const navigate = useNavigate();
  return <button className="back text-button" onClick={() => to ? navigate(to) : navigate(-1)}><ArrowLeft size={17}/>{label}</button>;
}
export function Status({ loading, error, empty, retry, children }: { loading?: boolean; error?: string; empty?: string; retry?: () => void; children?: ReactNode }) {
  if (loading) return <div className="status" role="status"><span className="loading-dot"/>正在展开这一页…</div>;
  if (error) return <div className="status error" role="alert"><p>{error}</p>{retry && <button className="text-button" onClick={retry}>重新加载</button>}</div>;
  if (empty) return <div className="status"><p>{empty}</p></div>;
  return <>{children}</>;
}
export function ShareRow({ share }: { share: Share }) {
  return <article className="share-row" data-share-id={share.id}>
    <div className="byline"><Avatar preset={share.avatar} anonymous={share.anonymous}/><div><span>{share.name}</span><small>{formatDate(share.createdAt)}</small></div>{share.status !== 'PUBLISHED' && <span className="badge">{share.status === 'HIDDEN' ? '已隐藏' : '已删除'}</span>}</div>
    <Link to={`/shares/${share.id}`} className="share-title">{share.title || '读到这里，想到…'}<ArrowUpRight size={17}/></Link>
    <p className="share-excerpt">{share.body}</p>
    <div className="share-stats"><span>阅读 {share.views}</span><span><Heart size={14}/>{share.likes}</span><span><MessageCircle size={14}/>{share.comments}</span>{share.media.length > 0 && <span>{share.media.some(m => m.mime.startsWith('audio/')) ? '含音频' : '含图片'}</span>}</div>
  </article>;
}
