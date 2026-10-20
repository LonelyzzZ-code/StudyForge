import { useEffect, useState } from 'react';
import { api } from '../api';
import type { RoleCfg, SettingsData } from '../types';
import { useToast } from '../App';
import BackButton from '../components/BackButton';

const ROLES: { key: 'planner' | 'generator' | 'grader' | 'assistant'; label: string; hint: string }[] = [
  { key: 'planner', label: '路线规划 planner', hint: '学习请求 → 知识点 DAG。质量敏感、每条路线仅 1 次调用，建议配强模型' },
  { key: 'generator', label: '内容生成 generator', hint: '每个节点生成讲义 + 题库 + 实践任务。调用最频繁，建议配性价比模型' },
  { key: 'grader', label: '简答判分 grader', hint: '核对一句话简答的关键点命中。任务极简，建议配最便宜的小模型' },
  { key: 'assistant', label: '学习问答 assistant', hint: '学习中呼出问答窗即时答疑（流式）。留空 = 继承 generator 配置' },
];

type TestState = { ok: boolean; msg: string } | 'testing' | null;

export default function Settings() {
  const toast = useToast();
  const [cfg, setCfg] = useState<Record<string, RoleCfg> | null>(null);
  const [mock, setMock] = useState<SettingsData['mock_mode'] | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => {
      const merge = (c: Partial<RoleCfg> | undefined): RoleCfg => ({
        base_url: c?.base_url ?? '', api_key: c?.api_key ?? '', model: c?.model ?? '',
      });
      setCfg({
        planner: merge(s.planner_cfg),
        generator: merge(s.generator_cfg),
        grader: merge(s.grader_cfg),
        assistant: merge((s as { assistant_cfg?: Partial<RoleCfg> }).assistant_cfg),
      });
      setMock(s.mock_mode);
    });
  }, []);

  function setField(role: string, field: keyof RoleCfg, value: string) {
    setCfg((prev) => prev && { ...prev, [role]: { ...prev[role], [field]: value } });
  }

  async function save() {
    if (!cfg) return;
    setSaving(true);
    try {
      await api.putSettings({
        planner_cfg: cfg.planner, generator_cfg: cfg.generator,
        grader_cfg: cfg.grader, assistant_cfg: cfg.assistant,
      });
      const s = await api.getSettings();
      setMock(s.mock_mode);
      toast('配置已保存（API key 仅保存在本机）');
    } catch {
      toast('保存失败', true);
    } finally {
      setSaving(false);
    }
  }

  async function test(role: string) {
    await save();
    setTests((t) => ({ ...t, [role]: 'testing' }));
    const r = await api.testRole(role);
    setTests((t) => ({
      ...t,
      [role]: r.ok ? { ok: true, msg: '连通正常' } : { ok: false, msg: r.error ?? '连接失败' },
    }));
  }

  if (!cfg) return <div className="empty"><span className="spinner green" /> 加载中…</div>;

  const allMock = mock && mock.planner && mock.generator && mock.grader;

  return (
    <div className="fade-in">
      <BackButton to="/" label="返回首页" />
      <h1 className="page-title">模型设置</h1>
      <p className="page-sub">
        StudyForge 不带模型 —— 接入任意 OpenAI 兼容 API（DeepSeek / GLM / OpenAI / Ollama…），key 只存本机
      </p>

      <div className="card" style={{
        marginBottom: 16, background: allMock ? 'var(--amber-bg)' : 'var(--green-50)',
        borderColor: allMock ? '#fde68a' : 'var(--green-100)',
      }}>
        {allMock ? (
          <>尚未接入模型：当前使用内置数据体验完整流程。配置任一环节并保存后，该环节即切换为真实 AI 生成。</>
        ) : (
          <>已接入模型：
            {ROLES.map((r) => (
              <span key={r.key} className={`badge ${mock?.[r.key] ? 'gray' : ''}`} style={{ marginLeft: 8 }}>
                {r.label.split(' ')[0]} {mock?.[r.key] ? '内置数据' : 'AI 生成'}
              </span>
            ))}
          </>
        )}
      </div>

            {ROLES.map((r) => {
              const t = tests[r.key];
              return (
            <div key={r.key} className="card" style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <b style={{ fontSize: 16 }}>{r.label}</b>
                <span className={`badge ${mock?.[r.key] ? 'amber' : ''}`}>
                  {r.key === 'assistant' && !cfg.assistant.model
                    ? (mock?.generator ? '继承 generator · 未配置' : '继承 generator 配置')
                    : mock?.[r.key] ? '未配置' : '已配置'}
                </span>
                {t === 'testing' && <><span className="spinner green" /> 测试中…</>}
                {t && t !== 'testing' && (
                  <span className={`badge ${t.ok ? '' : 'gray'}`} style={{
                    ...(t.ok ? {} : { background: 'var(--danger-bg)', color: 'var(--danger)', borderColor: '#fecaca' }),
                  }}>
                    {t.ok ? '✓ ' : '✗ '}{t.msg.slice(0, 60)}
                  </span>
                )}
              </div>
              <div className="hint" style={{ marginBottom: 12 }}>{r.hint}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 10 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Base URL</label>
                  <input value={cfg[r.key].base_url} onChange={(e) => setField(r.key, 'base_url', e.target.value)}
                    placeholder="https://api.deepseek.com/v1" />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Model</label>
                  <input value={cfg[r.key].model} onChange={(e) => setField(r.key, 'model', e.target.value)}
                    placeholder="deepseek-chat" />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>API Key</label>
                  <input type="password" value={cfg[r.key].api_key} onChange={(e) => setField(r.key, 'api_key', e.target.value)}
                    placeholder="sk-…" />
                </div>
              </div>
              <button className="btn ghost small" style={{ marginTop: 12 }} onClick={() => test(r.key)}>
                测试连通性
              </button>
            </div>
              );
            })}

      <button className="btn" onClick={save} disabled={saving}>
        {saving ? <><span className="spinner" /> 保存中…</> : '保存全部配置'}
      </button>
      <div className="hint" style={{ marginTop: 10 }}>
        Base URL 需兼容 OpenAI 的 /chat/completions 接口；测试连通性会发送一次最小调用（可无限次测试）。
      </div>
    </div>
  );
}
