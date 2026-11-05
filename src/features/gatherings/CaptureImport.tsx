import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ArrowRight, ArrowUpRight, FileUp, Link2, Save, Trash2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Back, PageHead } from '../../components/Shared';
import { chapters, chapterTitle } from '../reading/Library';

type Source = 'FEISHU' | 'DINGTALK' | 'WECHAT' | 'TENCENT_MEETING' | 'OTHER';
type ImportDraft = { id: string; title: string; source: Source; sourceUrl: string; transcript: string; chapter: number; savedAt: string };
const STORAGE_KEY = 'daodejing-capture-import-drafts-v1';
const MAX_TEXT_LENGTH = 600_000;
const services: { id: Source; name: string; description: string; href: string }[] = [
  { id: 'FEISHU', name: '飞书妙记', description: '打开飞书后创建妙记，完成后复制分享链接。', href: 'https://www.feishu.cn/' },
  { id: 'DINGTALK', name: '钉钉闪记', description: '打开钉钉后创建闪记，完成后复制分享链接。', href: 'https://www.dingtalk.com/' },
  { id: 'WECHAT', name: '微信', description: '打开微信，导出或复制会议原始文稿。', href: 'https://weixin.qq.com/' },
  { id: 'TENCENT_MEETING', name: '腾讯会议', description: '打开腾讯会议，导出会议转写文稿或分享链接。', href: 'https://meeting.tencent.com/' },
];
const sourceLabel: Record<Source, string> = { FEISHU: '飞书妙记', DINGTALK: '钉钉闪记', WECHAT: '微信', TENCENT_MEETING: '腾讯会议', OTHER: '其他来源' };

export function CaptureImport() {
  const [params] = useSearchParams();
  const requestedChapter = Number(params.get('chapter')) || 1;
  const [chapter, setChapter] = useState(chapters[requestedChapter - 1] ? requestedChapter : 1);
  const [source, setSource] = useState<Source>('FEISHU');
  const [title, setTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<ImportDraft[]>(() => readDrafts());
  const fileInput = useRef<HTMLInputElement>(null);

  async function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/\.(txt|md|srt|vtt)$/i.test(file.name)) {
      setError('目前支持 TXT、MD、SRT、VTT 文稿。请从服务中导出文稿后再选择。');
      return;
    }
    if (file.size > 2_000_000) {
      setError('文稿文件请小于 2 MB。超出时可复制正文粘贴到下方。');
      return;
    }
    try {
      const content = await file.text();
      if (content.length > MAX_TEXT_LENGTH) throw new Error('文稿过长，请选择较小的文件或粘贴需要整理的片段。');
      setTranscript(content);
      if (!title.trim()) setTitle(file.name.replace(/\.(txt|md|srt|vtt)$/i, ''));
      setError(''); setNotice(`已读取 ${file.name}，内容只保留在此浏览器的草稿中。`);
    } catch (e) { setError(e instanceof Error ? e.message : '无法读取该文稿。'); }
  }

  function saveDraft(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice('');
    if (!transcript.trim()) { setError('请粘贴或上传会议原始文稿。仅有分享链接时，目前无法自动读取第三方内容。'); return; }
    if (transcript.length > MAX_TEXT_LENGTH) { setError('文稿过长，请拆分后导入。'); return; }
    setBusy(true);
    try {
      const next: ImportDraft = { id: crypto.randomUUID(), title: title.trim() || `${sourceLabel[source]}现场记录`, source, sourceUrl: sourceUrl.trim(), transcript: transcript.trim(), chapter, savedAt: new Date().toISOString() };
      const updated = [next, ...readDrafts()].slice(0, 10);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setDrafts(updated); setTitle(''); setSourceUrl(''); setTranscript('');
      setNotice('已保存在本机草稿。当前版本不会上传或公开文稿。');
    } catch { setError('本机存储空间不足或浏览器阻止了保存。请复制备份文稿后重试。'); }
    finally { setBusy(false); }
  }

  function removeDraft(id: string) {
    const updated = drafts.filter(draft => draft.id !== id);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); setDrafts(updated); }
    catch { setError('无法更新本机草稿。请检查浏览器存储空间。'); }
  }

  function clearDrafts() {
    if (!window.confirm('清除此设备保存的所有导入草稿？此操作无法撤销。')) return;
    try { localStorage.removeItem(STORAGE_KEY); setDrafts([]); }
    catch { setError('无法清除本机草稿。请检查浏览器存储设置。'); }
  }

  return <div className="page-width form-page capture-import-page">
    <Back to={`/chapters/${chapter}`} label="返回本章频道"/>
    <PageHead eyebrow="游客可用 · 现场记录" title="导入会议记录"/>
    <p className="muted capture-intro">如果还没有会议记录，可打开常用服务自行开始录制或转录；完成后回到这里粘贴分享链接并导入原始文稿。</p>

    <section className="capture-services" aria-labelledby="capture-services-title">
      <div className="section-heading"><h2 id="capture-services-title">打开常用服务</h2><span>新窗口 / App</span></div>
      <div className="capture-service-grid">{services.map(service => <a className="capture-service" key={service.id} href={service.href} target="_blank" rel="noopener noreferrer">
        <span><strong>{service.name}</strong><small>{service.description}</small></span><ArrowUpRight size={17}/>
      </a>)}</div>
      <p className="field-note">能否唤起已安装的 App、以及能否直达录音页，取决于设备和第三方服务。这里不会替你自动开始录音。</p>
      <p className="capture-foreground-note">使用本产品的 H5 现场录音时，请保持本页面在前台打开，不要锁屏或切换 App；否则录音可能中断。</p>
    </section>

    <form className="capture-form" onSubmit={saveDraft}>
      <div className="section-heading"><h2>添加分享链接与原始文稿</h2><span>本机草稿</span></div>
      <label>关联章节<select value={chapter} onChange={e => setChapter(Number(e.target.value))}>{chapters.map(item => <option key={item.number} value={item.number}>第 {item.number} 章 · {chapterTitle(item.number)}</option>)}</select></label>
      <label>来源服务<select value={source} onChange={e => setSource(e.target.value as Source)}>{Object.entries(sourceLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>记录标题（可选）<input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} placeholder="例如：周六共读 · 第一章"/></label>
      <label>妙记 / 会议分享链接（可选）<span className="input-with-icon"><Link2 size={17}/><input type="url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="粘贴飞书、钉钉或会议分享链接"/></span><small>链接用于保留来源。目前不会自动抓取第三方页面内容，也不会尝试绕过登录或分享权限。</small></label>
      <label>会议原始文稿<textarea rows={10} value={transcript} onChange={e => { setTranscript(e.target.value); setError(''); }} maxLength={MAX_TEXT_LENGTH} placeholder="从飞书 / 钉钉妙记或微信 / 腾讯会议复制原始文稿并粘贴到这里。"/><small>{transcript.length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()} 字</small></label>
      <input ref={fileInput} className="visually-hidden" type="file" accept=".txt,.md,.srt,.vtt,text/plain,text/markdown,text/vtt,application/x-subrip" onChange={loadFile} aria-label="选择文稿文件"/>
      <button type="button" className="button secondary capture-file-button" onClick={() => fileInput.current?.click()}><FileUp size={17}/>选择 TXT / MD / SRT / VTT 文稿</button>
      <p className="capture-notice">文稿只保存在当前浏览器。当前版本尚未连接云端转写、妙记读取或频道发布；不要清除浏览器数据，以免丢失草稿。</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-success" role="status"><Save size={16}/>{notice}</p>}
      <button className="button primary full-width" disabled={busy}>{busy ? '正在保存…' : '保存到本机草稿'}<ArrowRight size={17}/></button>
    </form>

    {drafts.length > 0 && <section className="capture-drafts"><div className="section-heading"><h2>此设备上的导入草稿</h2><span>{drafts.length} 条 <button type="button" className="text-button danger" onClick={clearDrafts}>清空</button></span></div>{drafts.map(draft => <article className="capture-draft" key={draft.id}><div><strong>{draft.title}</strong><small>第 {draft.chapter} 章 · {sourceLabel[draft.source]} · {new Date(draft.savedAt).toLocaleString()}</small></div><p>{draft.transcript.slice(0, 160)}{draft.transcript.length > 160 ? '…' : ''}</p><div className="capture-draft-actions">{draft.sourceUrl && <a href={draft.sourceUrl} target="_blank" rel="noopener noreferrer">查看来源链接 <ArrowUpRight size={14}/></a>}<button type="button" className="text-button danger" onClick={() => removeDraft(draft.id)}><Trash2 size={14}/>删除草稿</button></div></article>)}</section>}
    <Link className="text-link capture-back-link" to={`/chapters/${chapter}`}>回到第 {chapter} 章频道 <ArrowRight size={16}/></Link>
  </div>;
}

function readDrafts(): ImportDraft[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? stored.filter((value): value is ImportDraft => !!value && typeof value === 'object' && typeof value.id === 'string' && typeof value.transcript === 'string' && typeof value.chapter === 'number' && typeof value.source === 'string') : [];
  } catch { return []; }
}
