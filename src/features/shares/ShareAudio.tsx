import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { ArrowUp, Captions, Headphones, Pause, Play, RotateCcw } from 'lucide-react';
import type { AudioCue } from '../../../shared/audio-cues';

type Props = {
  id: string;
  title: string;
  index: number;
  count: number;
  name?: string;
  cues?: readonly AudioCue[];
  active: boolean;
  onPlay: (id: string) => void;
};

export function ShareAudio({ id, title, index, count, name, cues, active, onPlay }: Props) {
  const section = useRef<HTMLElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);
  const [preload, setPreload] = useState<'none' | 'metadata' | 'auto'>('none');
  const [showCues, setShowCues] = useState(true);
  const [aboveViewport, setAboveViewport] = useState(false);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cue, setCue] = useState<string>();
  const hasCues = !!cues?.length;
  const captionsVisible = hasCues && showCues && !failed;
  const following = captionsVisible && active && started;
  const docked = following && aboveViewport;
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

  useEffect(() => {
    if (!active) audio.current?.pause();
  }, [active]);

  useEffect(() => {
    const element = section.current;
    if (!element || !hasCues || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      setAboveViewport(entry.boundingClientRect.bottom <= 0);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasCues]);

  function updateCue(event: SyntheticEvent<HTMLAudioElement>) {
    const time = event.currentTarget.currentTime;
    setCue(cues?.find(([start, end]) => start <= time && time < end)?.[2]);
  }

  function togglePlayback() {
    const player = audio.current;
    if (!player) return;
    if (player.paused) void player.play().catch(() => {});
    else player.pause();
  }

  function returnToPlayer() {
    section.current?.scrollIntoView({ block: 'center' });
    audio.current?.focus({ preventScroll: true });
  }

  return <section ref={section} className="share-audio" aria-label={label} data-follow={following || undefined}>
    <div className="share-audio-label">
      <span className="share-audio-icon"><Headphones size={22} aria-hidden="true"/></span>
      <h2>{label}</h2>
      {hasCues && <button className="share-audio-cue-toggle" type="button" aria-pressed={showCues} onClick={() => setShowCues(value => !value)}><Captions size={18} aria-hidden="true"/>随听提要</button>}
    </div>
    <div className="share-audio-controls">
      <audio ref={audio} controls preload={preload} aria-label={`${title} · ${label}`} src={`/api/media/${id}`}
        onPlay={event => {
          onPlay(id);
          setPlaying(true);
          setStarted(true);
          setPreload('auto');
          updateCue(event);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setStarted(false); }}
        onError={() => { setFailed(true); setPlaying(false); setStarted(false); }}
        onLoadedMetadata={() => setFailed(false)}
        onTimeUpdate={hasCues ? updateCue : undefined}
        onSeeking={hasCues ? updateCue : undefined}
        onSeeked={hasCues ? updateCue : undefined}>
        你的浏览器暂不支持音频播放。
      </audio>
      {failed && <div className="share-audio-error" role="status"><span>音频暂时无法播放</span><button type="button" onClick={() => { setFailed(false); audio.current?.load(); }}><RotateCcw size={14} aria-hidden="true"/>重新加载</button></div>}
    </div>
    {captionsVisible && <div className="share-audio-cue-slot">
      <div className="share-audio-cue" data-docked={docked || undefined}>
        <button className="share-audio-dock-button" type="button" onClick={togglePlayback} aria-label={playing ? '暂停音频' : '继续播放音频'}>
          {playing ? <Pause size={18} aria-hidden="true"/> : <Play size={18} aria-hidden="true"/>}
        </button>
        <div className="share-audio-cue-copy">
          <span className="share-audio-dock-label">随听提要</span>
          <p className="share-audio-cue-text">{following ? cue ?? '当前片段暂无提要' : '播放时显示随听提要'}</p>
        </div>
        <button className="share-audio-dock-button" type="button" onClick={returnToPlayer} aria-label="返回播放器" title="返回播放器"><ArrowUp size={18} aria-hidden="true"/></button>
      </div>
    </div>}
  </section>;
}
