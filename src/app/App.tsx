import { useEffect, useState } from 'react';
import { BookOpen, Compass, UserRound, ArrowUpRight } from 'lucide-react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from '../services/api';
import type { Profile } from '../types';
import { SessionContext } from './context';
import Library from '../features/reading/Library';
import Reader from '../features/reading/Reader';
import { Channel, ShareDetail, Compose } from '../features/shares/Pages';
import { Discover, PlaceDetail, DojoForm } from '../features/places/Pages';
import { GatheringForm, GatheringDetail } from '../features/gatherings/Pages';
import { CaptureImport } from '../features/gatherings/CaptureImport';
import { AgentImport } from '../features/shares/AgentImport';
import { Auth, Me, MyContent, ProfilePage, Feedback } from '../features/account/Pages';

export default function App() {
  const [user, setUser] = useState<Profile | null>(null); const [loading, setLoading] = useState(true);
  const location = useLocation(); const reading = /^\/read\//.test(location.pathname);
  async function reload() { try { const result = await api<{ user: Profile | null }>('/auth/me'); setUser(result.user); } catch { setUser(null); } finally { setLoading(false); } }
  useEffect(() => { void reload(); }, []);
  useEffect(() => { if (!reading) window.scrollTo(0, 0); }, [location.pathname, reading]);
  const navigation = <><NavLink to="/" end><BookOpen size={21}/><span>读书</span></NavLink><NavLink to="/discover"><Compass size={21}/><span>发现</span></NavLink><NavLink to="/me"><UserRound size={21}/><span>我的</span></NavLink></>;
  return <SessionContext.Provider value={{ user, loading, reload }}>
    {!reading && <><aside className="desktop-sidebar"><Link className="brand" to="/"><span className="brand-seal">道</span><span>一起读书<small>道德经 · 公益共读</small></span></Link><nav aria-label="主导航">{navigation}</nav><div className="sidebar-bottom"><Link to="/feedback">给我们一些建议 <ArrowUpRight size={14}/></Link><small>公益共读 · 自由参与</small></div></aside><header className="mobile-header"><Link className="mobile-brand" to="/"><span className="brand-seal">道</span>一起读书</Link><span>道德经 · 公益共读</span></header><nav className="mobile-nav" aria-label="主导航">{navigation}</nav></>}
    <div className={reading ? '' : 'app-content'}><Routes>
      <Route path="/" element={<Library/>}/><Route path="/read/:number" element={<Reader/>}/>
      <Route path="/chapters/:number" element={<Channel/>}/><Route path="/shares/:id" element={<ShareDetail/>}/><Route path="/compose" element={<Compose/>}/>
      <Route path="/discover" element={<Discover/>}/><Route path="/places/:id" element={<PlaceDetail/>}/><Route path="/dojos/new" element={<DojoForm/>}/><Route path="/dojos/:id/edit" element={<DojoForm/>}/>
      <Route path="/gatherings/new" element={<GatheringForm/>}/><Route path="/gatherings/:id" element={<GatheringDetail/>}/>
      <Route path="/agent/import" element={<AgentImport/>}/><Route path="/recordings/import" element={<CaptureImport/>}/>
      <Route path="/auth" element={<Auth/>}/><Route path="/me" element={<Me/>}/><Route path="/me/content" element={<MyContent/>}/><Route path="/me/profile" element={<ProfilePage/>}/><Route path="/feedback" element={<Feedback/>}/>
      <Route path="*" element={<div className="page-width"><h1>这一页暂时找不到</h1><Link className="button primary" to="/">回到读书</Link></div>}/>
    </Routes></div>
  </SessionContext.Provider>;
}
