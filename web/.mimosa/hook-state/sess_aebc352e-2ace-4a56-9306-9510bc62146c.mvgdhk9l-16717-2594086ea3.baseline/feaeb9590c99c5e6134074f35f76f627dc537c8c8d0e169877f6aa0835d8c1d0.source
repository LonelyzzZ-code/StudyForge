import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ReactFlow, Background, Controls, type Edge, type Node as FlowNode } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api, subscribeSse } from '../api';
import type { CostData, ImpactData, RoadmapDetail, RoadmapNode } from '../types';
import { useToast } from '../App';
import BackButton from '../components/BackButton';

const STATUS_LABEL: Record<RoadmapNode['status'], string> = {
  locked: '🔒 未解锁', unlocked: '▶ 可学习', learning: '✎ 学习中',
  passed: '✓ 已通过', mastered: '★ 已掌握',
};

interface DagData { node: RoadmapNode; [key: string]: unknown }

function DagNodeBody({ data }: { data: DagData }) {
  const n = data.node;
  return (
    <div className={`dag-node ${n.status} ${n.package_status === 'generating' ? 'generating' : ''}`}>
      <div className="t">{n.title}</div>
      <div className="meta">
        <span className="dot" />
        {n.package_status === 'generating' ? (
          <span className="gen-flag pulse-text">⟳ 生成中</span>
        ) : (
          <span>{STATUS_LABEL[n.status]}</span>
        )}
        <span>· {n.est_minutes}min</span>
      </div>
    </div>
  );
}

const nodeTypes = { dag: DagNodeBody };

export default function RoadmapDetail() {
  const { rid } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<RoadmapDetail | null>(null);
  const [error, setError] = useState('');
  const [cost, setCost] = useState<CostData | null>(null);
  const [menu, setMenu] = useState<{ node: RoadmapNode; x: number; y: number } | null>(null);
  const [impact, setImpact] = useState<ImpactData | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const load = useCallback(async () => {
    if (!rid) return;
    try {
      const d = await api.getRoadmap(Number(rid));
      setData(d);
      setError('');
      if (d.status !== 'planning') {
        api.roadmapCost(Number(rid)).then(setCost).catch(() => setCost(null));
      }
    } catch {
      setError('路线不存在或已删除');
    }
  }, [rid]);

  useEffect(() => {
    load();
    const off = subscribeSse([
      (e) => {
        if (e.roadmap_id !== Number(rid)) return;
        if (e.type === 'node.package' && e.data.package_status === 'ready') {
          const title = (e.data as { ext_key?: string }).ext_key;
          toast(`「${title}」内容已就绪`);
        }
        if (e.type === 'roadmap.failed') {
          toast(`路线生成失败：${(e.data as { reason?: string }).reason ?? '未知原因'}`, true);
        }
        if (e.type === 'node.status') toast('有节点状态更新');
        load();
      },
    ]);
    return () => { off(); if (pollRef.current) clearInterval(pollRef.current); };
  }, [rid, load, toast]);

  // 规划中：每 2 秒轮询兜底（SSE 未连接时也能推进）
  useEffect(() => {
    if (data?.status === 'planning') {
      pollRef.current = setInterval(load, 2000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
  }, [data?.status, load]);

  const { flowNodes, flowEdges } = useMemo(() => {
    if (!data) return { flowNodes: [] as FlowNode[], flowEdges: [] as Edge[] };
    const byKey = new Map(data.nodes.map((n) => [n.ext_key, n]));
    const preds = new Map<string, string[]>();
    data.nodes.forEach((n) => preds.set(n.ext_key, []));
    data.edges.forEach((e) => preds.get(e.to)?.push(e.from));

    // 分层：layer = 前驱最大层 + 1（拓扑序保证前驱先算好）
    const layer = new Map<string, number>();
    const layerCount = new Map<number, number>();
    for (const n of [...data.nodes].sort((a, b) => a.order_index - b.order_index)) {
      const ps = preds.get(n.ext_key) ?? [];
      const l = ps.length ? Math.max(...ps.map((p) => layer.get(p) ?? 0)) + 1 : 0;
      layer.set(n.ext_key, l);
      layerCount.set(l, (layerCount.get(l) ?? 0) + 1);
    }
    const seenInLayer = new Map<number, number>();
    const flowNodes: FlowNode<DagData>[] = data.nodes.map((n) => {
      const l = layer.get(n.ext_key) ?? 0;
      const idx = seenInLayer.get(l) ?? 0;
      seenInLayer.set(l, idx + 1);
      const total = layerCount.get(l) ?? 1;
      const ySpread = 130;
      return {
        id: n.ext_key,
        type: 'dag',
        position: { x: 40 + l * 250, y: 40 + idx * ySpread + (total > 1 ? 0 : 60) },
        data: { node: n },
        draggable: true,
      };
    });
    const statusOf = (k: string) => byKey.get(k)?.status;
    const flowEdges: Edge[] = data.edges.map((e, i) => ({
      id: `e${i}`,
      source: e.from,
      target: e.to,
      animated: statusOf(e.to) === 'unlocked',
      style: {
        stroke: statusOf(e.from) === 'passed' || statusOf(e.from) === 'mastered'
          ? 'var(--green-600)' : 'var(--line)',
        strokeWidth: 2,
      },
    }));
    return { flowNodes, flowEdges };
  }, [data]);

  function onNodeClick(_: unknown, node: FlowNode) {
    const n = node.data.node as RoadmapNode;
    if (n.status === 'locked') {
      toast(n.package_status === 'generating'
        ? '该节点还未解锁（需先通过全部前序节点），内容也还在后台生成中；右键节点可手动调整'
        : '该节点未解锁：需要先通过全部前序节点（右键节点可手动调整）', true);
      return;
    }
    nav(`/roadmaps/${rid}/nodes/${n.id}`);
  }

  async function confirmDelete() {
    if (!impact || !rid) return;
    await api.deleteNode(Number(rid), impact.node.id);
    toast(`已删除「${impact.node.title}」并完成依赖重连`);
    setImpact(null);
    setMenu(null);
    load();
  }

  async function regenBranch(n: RoadmapNode) {
    if (!rid) return;
    if (!window.confirm(`以「${n.title}」为根重新生成本分支（已通过的节点保留）？`)) return;
    const r = await api.regenerateBranch(Number(rid), n.id);
    toast(`已重排 ${r.regenerated_nodes.length} 个节点的内容生成`);
    setMenu(null);
    load();
  }

  if (error) return <div className="card empty"><div className="big">🧭</div>{error}</div>;
  if (!data) return <div className="empty"><span className="spinner green" /> 加载中…</div>;

  const readyCount = data.nodes.filter((n) => n.package_status === 'ready' || n.package_status === 'suspect').length;
  const generating = data.nodes.some((n) => n.package_status === 'generating');

  return (
    <div className="fade-in">
      <BackButton />
      <h1 className="page-title">{data.goal}</h1>
      <p className="page-sub">
        {data.base && <>基础：{data.base} · </>}
        {data.outcome && <>目标：{data.outcome} · </>}
        共 {data.progress.total} 个知识点 · 约 {Math.round(data.progress.est_minutes_total / 60)} 小时
      </p>

      {data.status === 'planning' && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="step-flow">
            <span className="st on"><span className="spinner green" /> 规划学习路线（DAG）</span>
            <span className="arrow">→</span>
            <span className="st">生成内容与题库</span>
            <span className="arrow">→</span>
            <span className="st">开始学习</span>
          </div>
          <div className="hint pulse-text" style={{ textAlign: 'center' }}>
            AI 正在根据你的目标规划知识点与依赖顺序，请稍候…（通常 1~3 分钟，推理模型可能更久）
          </div>
        </div>
      )}
      {data.status === 'failed' && (
        <div className="card" style={{ marginBottom: 16, background: 'var(--danger-bg)', borderColor: '#fecaca' }}>
          路线生成失败。请检查设置页的模型配置，或稍后重新创建。
        </div>
      )}

      {data.status !== 'planning' && (
        <>
          <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 18 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                <span style={{ fontWeight: 700 }}>学习进度 {data.progress.done}/{data.progress.total}</span>
                <span style={{ color: 'var(--ink-2)' }}>
                  {generating
                    ? <span className="pulse-text">⟳ 后台正在预生成后续内容（{readyCount}/{data.progress.total} 就绪）</span>
                    : `内容就绪 ${readyCount}/${data.progress.total}`}
                </span>
              </div>
              <div className="progressbar">
                <div style={{ width: `${(data.progress.done / Math.max(1, data.progress.total)) * 100}%` }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', whiteSpace: 'nowrap', alignItems: 'center' }}
                 title="状态说明（非按钮）：右键节点可标记掌握 / 重生成 / 删除">
              <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>图例：</span>
              <span className="badge">▶ 可学习</span>
              <span className="badge gray">🔒 未解锁</span>
              <span className="badge">✓ 已通过</span>
              <span className="badge amber">★ 已掌握</span>
            </div>
          </div>

          <div className="card" style={{ padding: 10, height: 520, position: 'relative' }}
               onClick={() => setMenu(null)}>
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              onNodeClick={onNodeClick}
              onNodeContextMenu={(e, node) => {
                e.preventDefault();
                setMenu({ node: node.data.node as RoadmapNode, x: e.clientX, y: e.clientY });
              }}
              fitView
              proOptions={{ hideAttribution: true }}
              minZoom={0.4}
            >
              <Background color="#ccefdd" gap={22} />
              <Controls showInteractive={false} />
            </ReactFlow>
            {menu && (
              <div className="ctx-menu" style={{ left: Math.min(menu.x - 300, window.innerWidth - 500), top: menu.y - 90 }}>
                {menu.node.status !== 'locked' && (
                  <button onClick={() => { nav(`/roadmaps/${rid}/nodes/${menu.node.id}`); setMenu(null); }}>
                    📖 进入学习
                  </button>
                )}
                {menu.node.status !== 'passed' && menu.node.status !== 'mastered' && (
                  <button onClick={async () => {
                    await api.masterNode(Number(rid), menu.node.id);
                    toast('已标记掌握，后继节点解锁');
                    setMenu(null); load();
                  }}>★ 标记已掌握</button>
                )}
                <button onClick={() => regenBranch(menu.node)}>♻ 重生成分支</button>
                <button className="danger" onClick={async () => {
                  const im = await api.nodeImpact(Number(rid), menu.node.id);
                  setImpact(im);
                  setMenu(null);
                }}>🗑 删除节点…</button>
              </div>
            )}
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            点击<b>可学习</b>的节点进入学习页；<b>右键节点</b>可手动调整（标记掌握 / 重生成分支 / 删除重连）。
            虚线边表示该依赖已激活；内容在后台按学习进度持续预生成。
          </div>

          {cost && cost.total_calls > 0 && (
            <div className="card" style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>💳 本路线成本（BYOK 记账，仅统计成功调用，tokens 为 API 返回值或按内容估算）</div>
              <div className="cost-row">
                <span>调用 <b>{cost.total_calls}</b> 次</span>
                <span>tokens <b>{cost.total_tokens}</b></span>
                <span>累计耗时 <b>{(cost.total_latency_ms / 1000).toFixed(1)}</b> s</span>
                {cost.breakdown.map((b) => (
                  <span key={b.role + b.purpose} className="badge gray">
                    {b.role}/{b.purpose} ×{b.calls}
                  </span>
                ))}
              </div>
            </div>
          )}

          {impact && (
            <>
              <div className="drawer-mask" onClick={() => setImpact(null)} />
              <div className="modal">
                <h3>删除节点「{impact.node.title}」</h3>
                <p style={{ color: 'var(--ink-2)' }}>{impact.message}</p>
                {impact.rewires.map((rw) => (
                  <div key={rw.successor.id} style={{
                    background: 'var(--green-50)', border: '1px solid var(--green-100)',
                    borderRadius: 8, padding: '8px 12px', marginBottom: 8, fontSize: 14,
                  }}>
                    <b>{rw.successor.title}</b> 的新前置将变为：
                    {rw.new_predecessors.map((p) => p.title).join('、')}
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
                  <button className="btn ghost" onClick={() => setImpact(null)}>取消</button>
                  <button className="btn" style={{ background: 'var(--danger)' }} onClick={confirmDelete}>
                    确认删除
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
