import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { TechRadarData, TechRadarItem } from '../types';
import BackButton from '../components/BackButton';

export default function TechRadar() {
  const [data, setData] = useState<TechRadarData | null>(null);
  const [cat, setCat] = useState('全部');
  const [kw, setKw] = useState('');
  const nav = useNavigate();
  const location = useLocation();

  useEffect(() => { api.getRadar().then(setData); }, []);

  const items = useMemo(() => {
    if (!data) return [];
    return data.items.filter((it) =>
      (cat === '全部' || it.category === cat)
      && (!kw.trim() || (it.name + it.one_liner + it.why).toLowerCase().includes(kw.trim().toLowerCase())));
  }, [data, cat, kw]);

  function goLearn(item: TechRadarItem) {
    nav('/', { state: { presetGoal: item.preset_goal, from: 'tech' } });
  }

  if (!data) return <div className="empty"><span className="spinner green" /> 加载中…</div>;

  return (
    <div className="fade-in">
      <BackButton to="/" label="返回首页" />
      <h1 className="page-title">技术热点</h1>
      <p className="page-sub">
        计算机领域值得关注的方向 · 内置榜单 {data.version} · 点「去学习」一键生成学习路线
        {location.state && (location.state as { from?: string }).from === 'tech' && (
          <span className="badge" style={{ marginLeft: 8 }}>✓ 已为你预填学习目标</span>
        )}
      </p>

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="radar-search" value={kw} onChange={(e) => setKw(e.target.value)}
          placeholder="🔍 搜索技术方向…" style={{ flex: 1, minWidth: 200, border: '1.5px solid var(--line)', borderRadius: 9, padding: '8px 12px' }} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['全部', ...data.categories].map((c) => (
            <button key={c} className={`chip-btn ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
      </div>

      <div className="radar-grid">
        {items.map((it) => (
          <div key={it.id} className="card radar-card fade-in">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{it.name}</div>
                <div className="badge gray" style={{ marginTop: 4 }}>{it.category}</div>
              </div>
              <div className="heat" title={`热度 ${it.heat}/5`} aria-label={`热度 ${it.heat} / 5`}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <span key={i} className={i <= it.heat ? 'star on' : 'star'}>★</span>
                ))}
              </div>
            </div>
            <div style={{ margin: '10px 0', color: 'var(--ink)', fontSize: 14 }}>{it.one_liner}</div>
            <div className="radar-detail">
              <div><b>为什么值得关注：</b>{it.why}</div>
              <div><b>适合谁：</b>{it.for_whom}</div>
              <div><b>建议起点：</b>{it.start_from}</div>
            </div>
            <button className="btn small" style={{ marginTop: 12 }} onClick={() => goLearn(it)}>
              去学习 →
            </button>
          </div>
        ))}
      </div>
      {items.length === 0 && <div className="card empty">没有匹配的技术方向</div>}
    </div>
  );
}
