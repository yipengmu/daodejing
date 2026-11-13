import { Fragment } from 'react';
import { ArrowRight, BookOpen, Clock3 } from 'lucide-react';
import type { ImportDocument } from '../../types';

function Emphasis({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*\n]+\*\*)/g).map((part, index) => <Fragment key={index}>{part.startsWith('**') && part.endsWith('**') ? <strong>{part.slice(2, -2)}</strong> : part}</Fragment>)}</>;
}

function ReadingBlock({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    if (line.startsWith('### ')) {
      blocks.push(<h3 key={index}><Emphasis text={line.slice(4)}/></h3>);
    } else if (line.startsWith('- ')) {
      const start = index;
      const items = [line.slice(2)];
      while (lines[index + 1]?.trim().startsWith('- ')) items.push(lines[++index].trim().slice(2));
      blocks.push(<ul key={start}>{items.map((item, itemIndex) => <li key={itemIndex}><Emphasis text={item}/></li>)}</ul>);
    } else {
      blocks.push(<p key={index}><Emphasis text={line}/></p>);
    }
  }
  return <div className="reading-block">{blocks}</div>;
}

function topicBlocks(paragraphs: string[]) {
  return paragraphs.flatMap(paragraph => paragraph.split(/\n(?=### )/)).map(text => {
    const lines = text.trim().split('\n');
    if (!lines[0].startsWith('### ')) return { title: '', body: text };
    return { title: lines[0].slice(4), body: lines.slice(1).join('\n') };
  });
}

function sectionHeading(title: string) {
  const [heading, ...time] = title.split('｜');
  return { heading, time: time.join('｜') };
}

export function StructuredReading({ document, kind = 'session' }: { document: ImportDocument; kind?: 'session' | 'agent-notes' | 'lead-reading' }) {
  const isLeadReading = kind === 'lead-reading';
  return <div className="structured-reading">
    {document.summary && <div className="reading-overview"><h2>{isLeadReading ? '领读提要' : kind === 'agent-notes' ? '共读纪要摘要' : '现场记录摘要'}</h2>
    <div className="structured-summary"><Emphasis text={document.summary}/></div></div>}
    <nav className="structured-outline" aria-label="内容目录"><h2>{isLeadReading ? '领读目录' : kind === 'agent-notes' ? '共读纪要目录' : '现场记录目录'}</h2>{document.sections.map((section, index) => {
      const { heading, time } = sectionHeading(section.title);
      return <a href={`#reading-section-${index}`} key={index}><span>{String(index + 1).padStart(2, '0')}</span><div>{heading}{time && <small>{time}</small>}</div><ArrowRight size={15}/></a>;
    })}</nav>
    <div className="structured-sections">{document.sections.map((section, index) => {
      const { heading, time } = sectionHeading(section.title);
      return <section id={`reading-section-${index}`} className="structured-section" key={index}>
        <div className="structured-section-title"><span>{String(index + 1).padStart(2, '0')}</span><div><h2>{heading}</h2>{time && <small><Clock3 size={14} aria-hidden="true"/>{time}</small>}</div></div>
        <div className="structured-section-body">{topicBlocks(section.paragraphs).map((topic, topicIndex) => topic.title ? <article className="reading-topic" key={topicIndex}><div className="reading-topic-heading"><BookOpen size={19} aria-hidden="true"/><h3><Emphasis text={topic.title}/></h3></div><ReadingBlock text={topic.body}/></article> : <div className="reading-section-intro" key={topicIndex}><ReadingBlock text={topic.body}/></div>)}</div>
      </section>;
    })}</div>
  </div>;
}
