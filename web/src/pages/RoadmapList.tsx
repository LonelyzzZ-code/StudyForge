import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { RoadmapListItem } from '../types';
import { useToast } from '../App';
import BackButton from '../components/BackButton';

export default function RoadmapList() {
  const [items, setItems] = useState<RoadmapListItem[] | null>(null);
  const nav = useNavigate();
  const toast = useToast();

  async function load() {
    setItems(await api.listRoadmaps());
  }
  useEffect(() => { load(); }, []);

  async function remove(id: number) {
    if (!window.confirm('确定删除这条路线及其全部学习记录？')) return;
    await api.deleteRoadmap(id);
    toast('路线已删除');
    load();
  }

  if (items === null) return <div className="empty"><span className="spinner green" /> 加载中…</div>;

  return (
    <div className="fade-in">
      <BackButton to="/" label="返回首页" />
      <h1 className="page-title">我的路线</h1>
      <p className="page-sub">{items.length} 条学习路线</p>
      {items.length === 0 ? (
        <div className="card empty">
          <div className="big">🌱</div>
          还没有学习路线<br />
          <Link to="/" style={{ color: 'var(--green-700)', fontWeight: 700 }}>去创建第一条 →</Link>
        </div>
      ) : (
        items.map((r) => (
          <div key={r.id} className="card fade-in" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => nav(`/roadmaps/${r.id}`)}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{r.goal}</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, color: 'var(--ink-2)' }}>
                {r.status === 'planning' && <span className="badge pulse-text">规划中…</span>}
                {r.status === 'failed' && <span className="badge amber">生成失败</span>}
                <span>{new Date(r.created_at).toLocaleDateString()}</span>
                <span>·</span>
                <span>{r.total_nodes} 个知识点</span>
              </div>
            </div>
            {r.total_nodes > 0 && (
              <div style={{ width: 130 }}>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 4 }}>
                  进度 {r.done_nodes}/{r.total_nodes}
                </div>
                <div className="progressbar">
                  <div style={{ width: `${(r.done_nodes / r.total_nodes) * 100}%` }} />
                </div>
              </div>
            )}
            <button className="btn small ghost" onClick={() => nav(`/roadmaps/${r.id}`)}>继续学习</button>
            <button className="btn small danger-ghost" onClick={() => remove(r.id)}>删除</button>
          </div>
        ))
      )}
    </div>
  );
}
