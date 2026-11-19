import { useEffect, useRef, useState } from 'react';
import { Headphones, RotateCcw } from 'lucide-react';

export function ShareAudio({ id, title, index, count, name }: { id: string; title: string; index: number; count: number; name?: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);
  const [preload, setPreload] = useState<'none' | 'metadata' | 'auto'>('none');
  const label = name && name !== '分享音频' ? name : count > 1 ? `现场音频 ${index + 1}` : '现场音频';

  useEffect(() => {
    const player = audio.current;
    if (!player || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      const { connection } = navigator as Navigator & { connection?: { saveData?: boolean } };
      if (!connection?.saveData) setPreload(current => current === 'none' ? 'metadata' : current);
    }, { rootMargin: '120px 0px' });
    observer.observe(player);
    return () => observer.disconnect();
  }, []);

  return <section className="share-audio" aria-label={label}>
    <div className="share-audio-label"><span className="share-audio-icon"><Headphones size={22} aria-hidden="true"/></span><div><h2>{label}</h2><p>听现场，也读见解</p></div></div>
    <div className="share-audio-controls">
      <audio ref={audio} controls preload={preload} aria-label={`${title} · ${label}`} src={`/api/media/${id}`} onPlay={() => setPreload('auto')} onError={() => setFailed(true)} onLoadedMetadata={() => setFailed(false)}>你的浏览器暂不支持音频播放。</audio>
      {failed && <div className="share-audio-error" role="status"><span>音频暂时无法播放</span><button type="button" onClick={() => { setFailed(false); audio.current?.load(); }}><RotateCcw size={14} aria-hidden="true"/>重新加载</button></div>}
    </div>
  </section>;
}
