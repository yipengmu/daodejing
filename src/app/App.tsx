import { lazy, Suspense, useEffect, useState } from 'react';
import { BookOpen, Compass, UserRound, ArrowUpRight } from 'lucide-react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from '../services/api';
import type { Profile } from '../types';
import { SessionContext } from './context';
const Library = lazy(() => import('../features/reading/Library'));
const Reader = lazy(() => import('../features/reading/Reader'));
const sharePages = () => import('../features/shares/Pages');
const Channel = lazy(() => sharePages().then(module => ({ default: module.Channel })));
const ShareDetail = lazy(() => sharePages().then(module => ({ default: module.ShareDetail })));
const Compose = lazy(() => sharePages().then(module => ({ default: module.Compose })));
const placePages = () => import('../features/places/Pages');
const Discover = lazy(() => placePages().then(module => ({ default: module.Discover })));
const PlaceDetail = lazy(() => placePages().then(module => ({ default: module.PlaceDetail })));
const DojoForm = lazy(() => placePages().then(module => ({ default: module.DojoForm })));
const gatheringPages = () => import('../features/gatherings/Pages');
const GatheringForm = lazy(() => gatheringPages().then(module => ({ default: module.GatheringForm })));
const GatheringDetail = lazy(() => gatheringPages().then(module => ({ default: module.GatheringDetail })));
const CaptureImport = lazy(() => import('../features/gatherings/CaptureImport').then(module => ({ default: module.CaptureImport })));
const AgentImport = lazy(() => import('../features/shares/AgentImport').then(module => ({ default: module.AgentImport })));
const accountPages = () => import('../features/account/Pages');
const Auth = lazy(() => accountPages().then(module => ({ default: module.Auth })));
const Me = lazy(() => accountPages().then(module => ({ default: module.Me })));
const MyContent = lazy(() => accountPages().then(module => ({ default: module.MyContent })));
const ProfilePage = lazy(() => accountPages().then(module => ({ default: module.ProfilePage })));
const Feedback = lazy(() => accountPages().then(module => ({ default: module.Feedback })));

export default function App() {
  const [user, setUser] = useState<Profile | null>(null); const [loading, setLoading] = useState(true);
  const location = useLocation(); const reading = /^\/read\//.test(location.pathname);
  async function reload() { try { const result = await api<{ user: Profile | null }>('/auth/me'); setUser(result.user); } catch { setUser(null); } finally { setLoading(false); } }
  useEffect(() => { void reload(); }, []);
  useEffect(() => { if (!reading) window.scrollTo(0, 0); }, [location.pathname, reading]);
  const navigation = <><NavLink to="/" end><BookOpen size={21}/><span>读书</span></NavLink><NavLink to="/discover"><Compass size={21}/><span>发现</span></NavLink><NavLink to="/me"><UserRound size={21}/><span>我的</span></NavLink></>;
  return <SessionContext.Provider value={{ user, loading, reload }}>
    {!reading && <><aside className="desktop-sidebar"><Link className="brand" to="/"><span className="brand-seal">道</span><span>一起读书<small>道德经 · 公益共读</small></span></Link><nav aria-label="主导航">{navigation}</nav><div className="sidebar-bottom"><Link to="/feedback">给我们一些建议 <ArrowUpRight size={14}/></Link><small>公益共读 · 自由参与</small></div></aside><header className="mobile-header"><Link className="mobile-brand" to="/"><span className="brand-seal">道</span>一起读书</Link>{location.pathname !== '/' && <span>道德经 · 公益共读</span>}</header><nav className="mobile-nav" aria-label="主导航">{navigation}</nav></>}
    <div className={reading ? '' : 'app-content'}><Suspense fallback={<div className="page-width status" role="status"><span className="loading-dot"/>正在展开这一页…</div>}><Routes>
      <Route path="/" element={<Library/>}/><Route path="/read/:number" element={<Reader/>}/>
      <Route path="/chapters/:number" element={<Channel/>}/><Route path="/shares/:id" element={<ShareDetail/>}/><Route path="/compose" element={<Compose/>}/>
      <Route path="/discover" element={<Discover/>}/><Route path="/places/:id" element={<PlaceDetail/>}/><Route path="/dojos/new" element={<DojoForm/>}/><Route path="/dojos/:id/edit" element={<DojoForm/>}/>
      <Route path="/gatherings/new" element={<GatheringForm/>}/><Route path="/gatherings/:id" element={<GatheringDetail/>}/>
      <Route path="/agent/import" element={<AgentImport/>}/><Route path="/recordings/import" element={<CaptureImport/>}/>
      <Route path="/auth" element={<Auth/>}/><Route path="/me" element={<Me/>}/><Route path="/me/content" element={<MyContent/>}/><Route path="/me/profile" element={<ProfilePage/>}/><Route path="/feedback" element={<Feedback/>}/>
      <Route path="*" element={<div className="page-width"><h1>这一页暂时找不到</h1><Link className="button primary" to="/">回到读书</Link></div>}/>
    </Routes></Suspense></div>
  </SessionContext.Provider>;
}
