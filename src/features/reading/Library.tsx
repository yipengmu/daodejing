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
    <div className="book-intro"><div className="book-title-block"><h1 className="intro-title">道德经</h1><p className="book-subtitle">一起读书，从一章开始。</p></div><span className="book-imprint" aria-hidden="true">公益<br/>共读</span></div>
    <section className="teacher-intro" aria-labelledby="teacher-intro-title">
      <div className="teacher-intro-mark" aria-hidden="true">师</div>
      <div>
        <p className="teacher-intro-eyebrow">法脉传承 · 公益共读</p>
        <h2 id="teacher-intro-title">禅桥老师</h2>
        <p>禅桥老师是本产品法脉传承的老师，也是“践行公益《道德经》”的发起人。禅桥寓意连接、破障与通透；我们以经典为师，在共读中体会经义，并把所学带回日常生活。</p>
      </div>
    </section>
    {progress && <Link className="continue-reading" to={`/read/${progress.chapter}`}><BookOpen size={23}/><div><span>继续上次阅读</span><strong>第 {progress.chapter} 章 · {chapterTitle(progress.chapter)}</strong></div><ArrowRight size={20}/></Link>}
    <div className="section-heading library-heading"><h2>八十一章</h2><span>目录</span></div>
    {[{ title: '道篇', chapters: chapters.filter(c => c.number <= 37) }, { title: '德篇', chapters: chapters.filter(c => c.number >= 38) }].map(part => <section className="chapter-part" key={part.title} aria-label={part.title}>
      <div className="chapter-part-heading"><h3>{part.title}</h3><span>第 {part.chapters[0].number} 至 {part.chapters[part.chapters.length - 1].number} 章</span></div>
      <div className="chapter-index">{part.chapters.map(c => <Link className={`chapter-link ${progress?.chapter === c.number ? 'current' : ''}`} to={`/read/${c.number}`} state={{ start: true }} key={c.number}><span className="chapter-number">{String(c.number).padStart(2, '0')}</span><span>{chapterTitle(c.number)}</span>{progress?.chapter === c.number ? <small>最近阅读</small> : <ArrowRight size={16}/>}</Link>)}</div>
    </section>)}
  </div>;
}
