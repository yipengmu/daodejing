import { ArrowRight, BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import content from '../../data/content.json';
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
    <div className="book-intro"><h1 className="intro-title">道德经</h1></div>
    {progress && <Link className="continue-reading" to={`/read/${progress.chapter}`}><BookOpen size={23}/><div><span>继续上次阅读</span><strong>第 {progress.chapter} 章 · {chapterTitle(progress.chapter)}</strong></div><ArrowRight size={20}/></Link>}
    <div className="section-heading"><h2>八十一章</h2></div>
    {[{ title: '道篇', chapters: chapters.filter(c => c.number <= 37) }, { title: '德篇', chapters: chapters.filter(c => c.number >= 38) }].map(part => <section className="chapter-part" key={part.title} aria-label={part.title}>
      <h3>{part.title}</h3>
      <div className="chapter-index">{part.chapters.map(c => <Link className={`chapter-link ${progress?.chapter === c.number ? 'current' : ''}`} to={`/read/${c.number}`} state={{ start: true }} key={c.number}><span className="chapter-number">{String(c.number).padStart(2, '0')}</span><span>{chapterTitle(c.number)}</span>{progress?.chapter === c.number ? <small>最近阅读</small> : <ArrowRight size={16}/>}</Link>)}</div>
    </section>)}
  </div>;
}
