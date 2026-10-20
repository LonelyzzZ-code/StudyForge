import { createContext, useCallback, useContext, useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import CreateRoadmap from './pages/CreateRoadmap';
import RoadmapList from './pages/RoadmapList';
import RoadmapDetail from './pages/RoadmapDetail';
import NodeStudy from './pages/NodeStudy';
import Settings from './pages/Settings';
import TechRadar from './pages/TechRadar';

interface Toast { id: number; text: string; error?: boolean }
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

function Logo() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-label="StudyForge logo">
      <defs>
        <linearGradient id="sfg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="1" stopColor="#047857" />
        </linearGradient>
      </defs>
      <rect width="36" height="36" rx="9" fill="url(#sfg)" />
      <path d="M7 14.5 L17 11.5 V27 L7 30 Z" fill="#ffffff" opacity="0.92" />
      <path d="M29 14.5 L19 11.5 V27 L29 30 Z" fill="#ffffff" opacity="0.72" />
      <path d="M18 3.2 L19.4 6.6 L22.8 8 L19.4 9.4 L18 12.8 L16.6 9.4 L13.2 8 L16.6 6.6 Z" fill="#a7f3d0" />
    </svg>
  );
}

export default function App() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, error?: boolean) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      <div className="shell">
        <aside className="sidenav">
          <div className="brand">
            <Logo />
            <div>
              <div className="name">Study<span>Forge</span></div>
              <div className="tagline">AI 学习内容引擎</div>
            </div>
          </div>
          <nav>
            <NavLink to="/" end>创建路线</NavLink>
            <NavLink to="/tech">技术热点</NavLink>
            <NavLink to="/roadmaps">路线列表</NavLink>
            <NavLink to="/settings">模型设置</NavLink>
          </nav>
          <div className="foot">
            StudyForge 版本 —— 1.0
          </div>
        </aside>
        <main className="main">
          <div className="main-inner">
            <Routes>
              <Route path="/" element={<CreateRoadmap />} />
              <Route path="/tech" element={<TechRadar />} />
              <Route path="/roadmaps" element={<RoadmapList />} />
              <Route path="/roadmaps/:rid" element={<RoadmapDetail />} />
              <Route path="/roadmaps/:rid/nodes/:nid" element={<NodeStudy />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={
                <div className="empty">
                  <div className="big">🧭</div>
                  页面不存在，<Link to="/">返回首页</Link>
                </div>
              } />
            </Routes>
          </div>
        </main>
      </div>
      <div className="toast-wrap">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.error ? 'error' : ''}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
