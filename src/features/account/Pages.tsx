import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, BookOpen, Check, Heart, LogOut, MapPin, MessageSquare, Pencil, UserRound } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useSession } from '../../app/context';
import { Avatar } from '../../components/Avatar';
import { Back, PageHead, ShareRow, Status } from '../../components/Shared';
import { api, patch, post, formatDate } from '../../services/api';
import { useResource } from '../../hooks';
import type { Share, Gathering, Place } from '../../types';
import { clearDrafts } from '../../services/storage';

export function RequireLogin({ children }: { children: React.ReactNode }) {
  const { user, loading } = useSession(); const location = useLocation();
  if (loading) return <Status loading/>;
  if (!user) return <Navigate replace to={`/auth?next=${encodeURIComponent(location.pathname + location.search)}`}/>;
  return <>{children}</>;
}
export function Auth() {
  const [params] = useSearchParams(); const navigate = useNavigate(); const { user, reload } = useSession();
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [identifier, setIdentifier] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState(''); const [code, setCode] = useState(''); const [challenge, setChallenge] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const [cooldown, setCooldown] = useState(0);
  const nextValue = params.get('next') || '/me'; const next = nextValue.startsWith('/') && !nextValue.startsWith('//') ? nextValue : '/me';
  useEffect(() => { if (cooldown <= 0) return; const timer = window.setInterval(() => setCooldown(value => Math.max(0, value - 1)), 1000); return () => clearInterval(timer); }, [cooldown > 0]);
  function switchMode(value: typeof mode) { setMode(value); setError(''); setNotice(''); setChallenge(''); setCode(''); }
  async function sendCode() {
    setError(''); setNotice(''); setBusy(true);
    try { const result = await post<{ challengeId: string }>('/auth/send-code', { identifier, purpose: mode === 'reset' ? 'RESET' : 'REGISTER' }); setChallenge(result.challengeId); setCooldown(60); setNotice('验证码已发送，5 分钟内有效。'); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      if (mode === 'login') await post('/auth/login', { identifier, password });
      else if (mode === 'register') await post('/auth/register', { identifier, password, name, code, challengeId: challenge });
      else { await post('/auth/reset-password', { identifier, password, code, challengeId: challenge }); setNotice('密码已重置，请使用新密码登录。'); setMode('login'); setPassword(''); setChallenge(''); return; }
      await reload(); navigate(next, { replace: true });
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  if (user) return <Navigate to={next} replace/>;
  return <div className="auth-page page-width"><Back to="/" label="继续读书"/><div className="auth-card"><span className="brand-seal large">道</span><p className="eyebrow">共读，从此处开始</p><h1>{mode === 'register' ? '认识一起读书的你' : mode === 'reset' ? '找回密码' : '欢迎回来'}</h1><p className="muted">阅读始终向你敞开。登录后，可以留下体会和参与交流。</p><form onSubmit={submit}>
    <label>手机号或邮箱<input name="identifier" autoComplete="username" required maxLength={254} value={identifier} onChange={e => { setIdentifier(e.target.value); setChallenge(''); }}/></label>
    {mode === 'register' && <label>公开昵称<input required maxLength={80} autoComplete="nickname" value={name} onChange={e => setName(e.target.value)}/><small>公开资料只展示昵称与内置头像。</small></label>}
    {mode !== 'login' && <label>验证码<div className="input-action"><input aria-label="六位验证码" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value)}/><button type="button" className="button secondary" disabled={busy || cooldown > 0 || !identifier} onClick={sendCode}>{cooldown ? `${cooldown} 秒后重发` : '获取验证码'}</button></div></label>}
    <label>{mode === 'reset' ? '新密码' : '密码'}<input type="password" name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? 1 : 10} maxLength={128} value={password} onChange={e => setPassword(e.target.value)}/>{mode !== 'login' && <small>至少 10 位，建议组合使用字母、数字和符号。</small>}</label>
    {mode === 'reset' && <p className="field-note">手机号可通过短信找回，24 小时内最多成功重置一次；邮箱账号通过已验证邮箱找回。</p>}
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-notice" role="status">{notice}</p>}
    <button className="button primary full-width" disabled={busy || (mode !== 'login' && !challenge)}>{busy ? '请稍候…' : mode === 'login' ? '登录，继续刚才的事' : mode === 'register' ? '注册并继续' : '重置密码'}</button>
    </form><div className="auth-links">{mode === 'login' ? <><button className="text-button" onClick={() => switchMode('register')}>第一次来？注册账号</button><button className="text-button" onClick={() => switchMode('reset')}>忘记密码</button></> : <button className="text-button" onClick={() => switchMode('login')}>已有账号，返回登录</button>}</div><Link to="/feedback" className="muted small-link">还没登录？也可以给我们建议</Link></div></div>;
}
export function Me() {
  const { user, loading, reload } = useSession(); const navigate = useNavigate(); const [error, setError] = useState('');
  async function logout() { if (!window.confirm('退出后仍可匿名阅读，要退出当前账号吗？')) return; try { await post('/auth/logout'); clearDrafts(); await reload(); navigate('/'); } catch (e: any) { setError(e.message); } }
  return <div className="page-width"><PageHead eyebrow="读过的，留下的" title="我的"/>{loading ? <Status loading/> : <div className="profile-summary"><Avatar preset={user?.avatar} size={72}/><div><h2>{user?.name || '来此读书的人'}</h2><p>{user ? '每一次阅读，都有自己的收获。' : '不必登录，也能安心读完一章。'}</p>{!user && <Link className="text-link" to="/auth?next=/me">登录 / 注册 <ArrowRight size={15}/></Link>}</div></div>}
    <div className="menu-list"><Link to="/me/content"><BookOpen/>我的分享与共读记录<ArrowRight/></Link><Link to="/me/profile"><UserRound/>个人资料与头像<ArrowRight/></Link><Link to="/me/content?tab=places"><MapPin/>我维护的道场<ArrowRight/></Link><Link to="/feedback"><MessageSquare/>产品建议<span className="menu-note">游客也可提交</span><ArrowRight/></Link></div>
    <div className="quiet-banner"><span>一起读书，慢慢相遇。</span><p>经典原文、注释和个人分享各有来源。<br/>这里的交流，始终保留对不同体会的尊重。</p></div>
    {error && <p className="form-error" role="alert">{error}</p>}{user && <button className="text-button muted" onClick={logout}><LogOut size={16}/>退出登录</button>}
  </div>;
}
export function MyContent() { return <RequireLogin><MyContentBody/></RequireLogin>; }
function MyContentBody() {
  const [params, setParams] = useSearchParams(); const tab = ['shares', 'gatherings', 'places'].includes(params.get('tab') || '') ? params.get('tab')! : 'shares';
  const page = Math.max(0, Math.floor(Number(params.get('page')) || 0));
  const resource = useResource<any>(`/me/${tab === 'places' ? 'places' : tab === 'gatherings' ? 'gatherings' : 'shares'}?sort=latest&page=${page}`);
  const items = resource.data?.[tab] || [];
  return <div className="page-width"><Back to="/me" label="我的"/><PageHead title="我留下的"/><div className="tabs">{[['shares', '分享'], ['gatherings', '共读记录'], ['places', '道场']].map(([value, label]) => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setParams({ tab: value })}>{label}</button>)}</div><Status loading={resource.loading} error={resource.error} retry={resource.refresh} empty={resource.data && !items.length ? '这里还没有记录，慢慢开始就好。' : undefined}>{tab === 'shares' ? items.map((share: Share) => <ShareRow key={share.id} share={share}/>) : tab === 'gatherings' ? items.map((g: Gathering) => <Link className="record-row" to={`/gatherings/${g.id}`} key={g.id}><span>第 {g.chapter} 章 · {g.place?.name || '未关联地点'}</span><small>{formatDate(g.submittedAt)} · {g.status === 'HIDDEN' ? '已隐藏' : '已公开'}</small><ArrowRight size={17}/></Link>) : items.map((place: Place) => <Link className="record-row" to={`/places/${place.id}`} key={place.id}><span>{place.name}</span><small>{place.address}</small><ArrowRight size={17}/></Link>)}</Status><div className="pager">{page > 0 && <button className="button secondary" onClick={() => setParams({ tab, page: String(page - 1) })}>上一页</button>}{resource.data?.hasMore && <button className="button secondary" onClick={() => setParams({ tab, page: String(page + 1) })}>下一页</button>}</div><div className="action-row"><Link className="button secondary" to={tab === 'places' ? '/dojos/new' : tab === 'gatherings' ? '/gatherings/new' : '/compose'}>{tab === 'places' ? '创建道场资料' : tab === 'gatherings' ? '记录一次共读' : '写一篇分享'}<Pencil size={16}/></Link></div></div>;
}
export function ProfilePage() { return <RequireLogin><ProfileBody/></RequireLogin>; }
function ProfileBody() {
  const { user, reload } = useSession(); const [name, setName] = useState(user!.name); const [avatar, setAvatar] = useState(user!.avatar);
  const [email, setEmail] = useState(''); const [code, setCode] = useState(''); const [challenge, setChallenge] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(x => x - 1), 1000); return () => clearTimeout(timer); }, [cooldown]);
  async function save(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await patch('/profile', { name, avatar }); await reload(); setNotice('资料已保存。'); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }
  async function send() { setError(''); setBusy(true); try { const result = await post<{ challengeId: string }>('/auth/send-code', { identifier: email, purpose: 'RECOVERY' }); setChallenge(result.challengeId); setCooldown(60); setNotice('验证码已发送到你的恢复邮箱。'); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }
  async function bind(e: FormEvent) { e.preventDefault(); setError(''); setBusy(true); try { await post('/auth/bind-recovery', { identifier: email, challengeId: challenge, code }); await reload(); setNotice('恢复邮箱已验证并绑定。'); setChallenge(''); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }
  return <div className="page-width form-page"><Back to="/me" label="我的"/><PageHead title="个人资料"/><form onSubmit={save}><label>公开昵称<input required maxLength={80} value={name} onChange={e => setName(e.target.value)}/></label><fieldset><legend>选择头像</legend><div className="avatar-grid">{Array.from({ length: 10 }, (_, index) => <button type="button" aria-label={`选择头像 ${index + 1}`} aria-pressed={avatar === index} className={avatar === index ? 'selected' : ''} onClick={() => setAvatar(index)} key={index}><Avatar preset={index} size={54}/>{avatar === index && <Check size={15}/>}</button>)}</div></fieldset><button className="button primary" disabled={busy}>保存资料</button></form><section className="section-divider"><h2>恢复邮箱</h2><p className="muted">手机号注册不要求邮箱，可在这里验证一个备用恢复邮箱。</p>{user?.recoveryEmail && <p>已验证：{user.recoveryEmail}</p>}<form onSubmit={bind}><label>邮箱<input type="email" required value={email} onChange={e => { setEmail(e.target.value); setChallenge(''); }}/></label><div className="input-action"><label>验证码<input inputMode="numeric" value={code} onChange={e => setCode(e.target.value)} required maxLength={6}/></label><button type="button" className="button secondary" onClick={send} disabled={busy || !email || cooldown > 0}>{cooldown ? `${cooldown} 秒后重发` : '获取验证码'}</button></div><button className="button secondary" disabled={busy || !challenge}>验证并绑定</button></form></section>{error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status" className="form-notice">{notice}</p>}</div>;
}
export function Feedback() {
  const { user } = useSession(); const [body, setBody] = useState(''); const [error, setError] = useState(''); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false); const key = useRef(crypto.randomUUID());
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await api('/feedback', { method: 'POST', headers: { 'Idempotency-Key': key.current }, body: JSON.stringify({ body }) }); setDone(true); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }
  return <div className="page-width form-page"><Back to="/me" label="我的"/><PageHead eyebrow="让这里，慢慢变好" title="给我们一些建议"/>{done ? <div className="feedback-success"><Check size={30}/><h2>你的建议已经留下</h2><p>谢谢你一起关心这个共读空间。</p><Link className="button primary" to="/">继续读书</Link></div> : <><p className="muted">无论是否登录，都欢迎告诉我们：哪里让你读得更舒服，哪里还可以改进。</p><form onSubmit={submit}><label>你的建议<textarea rows={8} required maxLength={4000} value={body} onChange={e => setBody(e.target.value)} placeholder="写下你的想法…"/><small>{body.length} / 4000 · {user ? '将关联当前账号，仅用于产品改进。' : '以游客身份提交，无需留下个人身份。'}</small></label>{error && <p role="alert" className="form-error">{error}</p>}<button className="button primary" disabled={busy || !body.trim()}>{busy ? '正在提交…' : '提交建议'}<ArrowRight size={17}/></button></form></>}</div>;
}
