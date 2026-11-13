import { useRef, useState } from 'react';
import { Headphones, RotateCcw } from 'lucide-react';

export function ShareAudio({ id, title, index, count }: { id: string; title: string; index: number; count: number }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);
  const label = count > 1 ? `现场音频 ${index + 1}` : '现场音频';
  return <section className="share-audio" aria-label={label}>
    <div className="share-audio-label"><span className="share-audio-icon"><Headphones size={22} aria-hidden="true"/></span><div><h2>{label}</h2><p>听现场，也读见解</p></div></div>
    <div className="share-audio-controls">
      <audio ref={audio} controls preload="metadata" aria-label={`${title} · ${label}`} src={`/api/media/${id}`} onError={() => setFailed(true)} onLoadedMetadata={() => setFailed(false)}>你的浏览器暂不支持音频播放。</audio>
      {failed && <div className="share-audio-error" role="status"><span>音频暂时无法播放</span><button type="button" onClick={() => { setFailed(false); audio.current?.load(); }}><RotateCcw size={14} aria-hidden="true"/>重新加载</button></div>}
    </div>
  </section>;
}
