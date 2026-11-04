import { ArrowRight, BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import content from '../../data/content.json';
import { PageHead } from '../../components/Shared';
import { localState } from '../../services/storage';

export const chapters = content.chapters;
export const edition = content.edition;
export function chapterTitle(number: number) { return chapters[number - 1]?.text.split(/[，；。！？]/)[0] || ''; }
export function readProgress(): { chapter: number; offset: number } | null {
  try { const value = JSON.parse(localState.getItem('ddj-reading') || 'null'); return value && Number.isInteger(value.chapter) && value.chapter >= 1 && value.chapter <= 81 && Number.isInteger(value.offset) && value.offset >= 0 ? value : null; } catch { return null; }
}
export default function Library() {
  const progress = readProgress();
  return <div className="library page-width">
    <PageHead eyebrow="一章一会 · 日日可读" title="读书"><span className="vertical-seal" aria-hidden="true">道法自然</span></PageHead>
    <div className="book-intro"><p className="intro-title">道德经</p><p>读一章经典，<br className="mobile-only"/>留一点时间给自己。</p><span>八十一章 · 原文与注释</span></div>
    {progress && <Link className="continue-reading" to={`/read/${progress.chapter}`}><BookOpen size={23}/><div><span>继续上次阅读</span><strong>第 {progress.chapter} 章 · {chapterTitle(progress.chapter)}</strong></div><ArrowRight size={20}/></Link>}
    <div className="section-heading"><h2>八十一章</h2><span>{edition.label}</span></div>
    <div className="chapter-index">{chapters.map(c => <Link className={`chapter-link ${progress?.chapter === c.number ? 'current' : ''}`} to={`/read/${c.number}`} state={{ start: true }} key={c.number}><span className="chapter-number">{String(c.number).padStart(2, '0')}</span><span>{chapterTitle(c.number)}</span>{progress?.chapter === c.number ? <small>最近阅读</small> : <ArrowRight size={16}/>}</Link>)}</div>
    <p className="quiet-footer">经文依现有提供文本呈现，版本与校核状态见阅读页来源。<br/>用户分享属于个人体会，与经典原文分开展示。</p>
  </div>;
}
