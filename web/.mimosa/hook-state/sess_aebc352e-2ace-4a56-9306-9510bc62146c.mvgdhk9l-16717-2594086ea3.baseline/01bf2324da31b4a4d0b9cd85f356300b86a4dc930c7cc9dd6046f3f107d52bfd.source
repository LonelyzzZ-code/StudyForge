import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useToast } from '../App';

// 与 server/app/domain/profiles.py 的 CODE_HINTS 保持同步
const HINTS = ['python', 'java', 'javascript', 'typescript', 'c语言', 'c++', 'go', 'golang',
  'rust', 'zig', '编程', '编程语言', '爬虫', '前端', '后端', '算法', '数据结构', 'sql', '数据库',
  'web', 'webassembly', 'linux', 'git', 'docker', '机器学习', '深度学习', 'ai', 'llm', '大模型',
  'api', 'rag', 'agent', 'ollama', 'react', 'next', 'vue', 'kubernetes', 'k8s', '云原生',
  '可观测性', 'opentelemetry', 'ci/cd', '供应链'];

const EXAMPLES = [
  { goal: '零基础学会 Python 编程', base: '完全零基础', outcome: '能独立写出简单的爬虫脚本', time_budget: '每天 2 小时，坚持一个月' },
  { goal: '掌握 JavaScript 和前端开发', base: '会一点 HTML/CSS', outcome: '能做出个人主页和交互页面', time_budget: '周末学习，两个月' },
  { goal: '学习数据结构与算法', base: '熟悉 C 语言基础语法', outcome: '能应对实习面试的算法题', time_budget: '每天 1.5 小时，六周' },
];

export default function CreateRoadmap() {
  const nav = useNavigate();
  const toast = useToast();
  const location = useLocation();
  const preset = (location.state as { presetGoal?: string; from?: string } | null)?.presetGoal ?? '';
  const fromTech = (location.state as { from?: string } | null)?.from === 'tech';
  const [goal, setGoal] = useState(preset);
  const [base, setBase] = useState('');
  const [outcome, setOutcome] = useState('');
  const [timeBudget, setTimeBudget] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (preset) setGoal(preset); }, [preset]);

  const domainOk = useMemo(
    () => fromTech || HINTS.some((h) => goal.toLowerCase().includes(h)),
    [fromTech, goal]);

  async function submit() {
    if (!goal.trim()) { toast('请先填写学习目标', true); return; }
    setSubmitting(true);
    try {
      const { id } = await api.createRoadmap({ goal, base, outcome, time_budget: timeBudget });
      toast('学习请求已提交，正在规划路线…');
      nav(`/roadmaps/${id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        const msg = (e.payload as { detail?: { message?: string } })?.detail?.message
          ?? '该学习目标暂不支持，当前仅支持编程技术领域';
        toast(msg, true);
      } else {
        toast('提交失败，请稍后重试', true);
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="fade-in">
      <h1 className="page-title">创建学习路线</h1>
      <p className="page-sub">告诉 StudyForge 你的目标，它会生成一条带测验的学习路线</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-2)', marginBottom: 10 }}>
          没有头绪？点一个示例快速开始：
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {EXAMPLES.map((ex) => (
            <button key={ex.goal} className="btn ghost small"
              onClick={() => { setGoal(ex.goal); setBase(ex.base); setOutcome(ex.outcome); setTimeBudget(ex.time_budget); }}>
              {ex.goal}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="field">
          <label>学习目标 *</label>
          <input value={goal} onChange={(e) => setGoal(e.target.value)}
            placeholder="例：零基础学会 Python 编程" autoFocus />
          <div className="hint" style={goal && !domainOk ? { color: 'var(--danger)' } : undefined}>
            {goal === '' ? '当前版本支持：编程技术（语言 / Web / 算法 / 工具链）'
              : domainOk ? (fromTech && !HINTS.some((h) => goal.toLowerCase().includes(h))
                  ? '✓ 来自技术热点榜单，领域已认可'
                  : '✓ 已识别领域：编程技术')
                : '⚠ 未识别到编程技术关键词，提交可能被拒绝（如「学做饭」不在支持范围）'}
          </div>
        </div>
        <div className="field">
          <label>现有基础</label>
          <input value={base} onChange={(e) => setBase(e.target.value)} placeholder="例：完全零基础 / 会一点 C 语言" />
        </div>
        <div className="field">
          <label>期望成果</label>
          <input value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="例：能写出简单的爬虫脚本" />
        </div>
        <div className="field">
          <label>可用时间</label>
          <input value={timeBudget} onChange={(e) => setTimeBudget(e.target.value)} placeholder="例：每天 2 小时，坚持一个月" />
        </div>
        <button className="btn" onClick={submit} disabled={submitting || !goal.trim()}>
          {submitting ? <><span className="spinner" /> 正在提交…</> : '生成学习路线 →'}
        </button>
      </div>
    </div>
  );
}
