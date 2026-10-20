import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Markdown from 'react-markdown';
import { api, ApiError } from '../api';
import type { AnswerResult, FinishResult, PackageData, Question } from '../types';
import { useToast } from '../App';
import AssistantDrawer from '../components/AssistantDrawer';
import BackButton from '../components/BackButton';

type Tab = 'lecture' | 'quiz' | 'practice';
type QState = 'answering' | 'grading' | 'answered';

interface QResult extends AnswerResult { userAnswer: unknown }

function apiMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    const detail = (e.payload as { detail?: { message?: string } | string })?.detail;
    if (typeof detail === 'string') return detail;
    if (detail?.message) return detail.message;
  }
  return fallback;
}

export default function NodeStudy() {
  const { rid, nid } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [pkg, setPkg] = useState<PackageData | null>(null);
  const [tab, setTab] = useState<Tab>('lecture');
  const [regenIdx, setRegenIdx] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const load = useCallback(async () => {
    if (!nid) return;
    setPkg(await api.getPackage(Number(nid)));
  }, [nid]);

  useEffect(() => {
    setTab('lecture');
    load();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [nid, load]);

  useEffect(() => {
    if (pkg?.package_status === 'generating' || pkg?.package_status === 'pending') {
      pollRef.current = setInterval(load, 2500);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
  }, [pkg?.package_status, load]);

  async function master() {
    if (!rid || !nid || !window.confirm('标记「已掌握」将跳过测验直接通过本节点，确定？')) return;
    await api.masterNode(Number(rid), Number(nid));
    toast('已标记掌握，后继节点已解锁');
    nav(`/roadmaps/${rid}`);
  }

  async function retryGen() {
    if (!rid || !nid) return;
    try {
      await api.regenerateBranch(Number(rid), Number(nid));
      toast('已重新排队生成，请稍候…');
      load();
    } catch {
      toast('重试请求失败，请稍后再试', true);
    }
  }

  async function regenerateSection(sectionIdx: number) {
    if (!nid || regenIdx !== null) return;
    setRegenIdx(sectionIdx);
    try {
      await api.regenerateSection(Number(nid), sectionIdx);
      await load();
      toast('该段落已重写 ✍️');
    } catch (e) {
      toast(apiMessage(e, '重生成失败'), true);
    } finally {
      setRegenIdx(null);
    }
  }

  if (!pkg) return <div className="empty"><span className="spinner green" /> 加载中…</div>;

  const n = pkg.node;

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <BackButton to={`/roadmaps/${rid}`} label="返回路线" />
        {n.basic_done && <span className="badge">✓ 已通过</span>}
        {n.status === 'mastered' && <span className="badge amber">★ 已掌握</span>}
        {pkg.package_status === 'suspect' && (
          <span className="badge amber" title="质检未完全通过的内容，如发现错误可反馈">⚠ 存疑放行</span>
        )}
        <span style={{ marginLeft: 'auto' }}>
          {n.status === 'unlocked' && !n.basic_done && (
            <button className="btn ghost small" onClick={master}>标记已掌握</button>
          )}
        </span>
      </div>
      <h1 className="page-title">{n.title}</h1>
      <p className="page-sub">
        {n.summary}
        {n.kp_list.length > 0 && (
          <>{n.kp_list.map((k) => <span key={k} className="kp-chip">{k}</span>)}</>
        )}
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {([['lecture', '📖 讲义'], ['quiz', '✅ 测验'], ['practice', '🛠 实践任务']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} className={`btn small ${tab === k ? '' : 'ghost'}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'lecture' && (
        pkg.package_status === 'ready' || pkg.package_status === 'suspect' ? (
          <div className="card lecture fade-in">
            {pkg.lecture?.sections.map((s, i) => (
              <div key={i}>
                <h3>{s.title}
                  <button className="section-regen" onClick={() => regenerateSection(i)}
                    disabled={regenIdx !== null}>
                    {regenIdx === i ? '重写中…' : '😶 这段没懂，重写'}
                  </button>
                </h3>
                <Markdown>{s.content}</Markdown>
              </div>
            ))}
          </div>
        ) : pkg.package_status === 'failed' ? (
          <div className="card empty">
            <div style={{ fontSize: 34 }}>😔</div>
            <div style={{ fontWeight: 700, margin: '6px 0 4px' }}>内容生成失败</div>
            <div className="hint" style={{ maxWidth: 420, marginBottom: 12 }}>
              模型多次尝试仍未产出合格内容。可点击重试，或到「模型设置」换更稳定的模型（如非推理模型）
            </div>
            <button className="btn small" onClick={retryGen}>重新生成</button>
          </div>
        ) : (
          <div className="card empty">
            <span className="spinner green" />
            <div style={{ marginTop: 12 }} className="pulse-text">内容生成中…</div>
            <div className="hint">后台正在按「全局大纲 + 前序摘要」生成本节点讲义与题库</div>
          </div>
        )
      )}

      {tab === 'quiz' && <QuizPanel pkg={pkg} reload={load} />}
      {tab === 'practice' && <PracticePanel pkg={pkg} />}

      <AssistantDrawer nodeId={Number(nid)} nodeTitle={n.title} />
    </div>
  );
}

/* ================= Quiz ================= */

function QuizPanel({ pkg, reload }: { pkg: PackageData; reload: () => void }) {
  const toast = useToast();
  const n = pkg.node;
  const [attempt, setAttempt] = useState<{ id: number; tier: string; questions: Question[] } | null>(null);
  const [idx, setIdx] = useState(0);
  const [qState, setQState] = useState<QState>('answering');
  const [results, setResults] = useState<Record<number, QResult>>({});
  const [choice, setChoice] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [repairQ, setRepairQ] = useState<Question | null>(null);
  const [repairDone, setRepairDone] = useState(false);
  const [repairOrigin, setRepairOrigin] = useState<number | null>(null);
  const [variantQ, setVariantQ] = useState<(Question & { variant_of?: number }) | null>(null);
  const [variantDone, setVariantDone] = useState(false);
  const [finish, setFinish] = useState<FinishResult | null>(null);

  const ready = pkg.package_status === 'ready' || pkg.package_status === 'suspect';
  const weakSet = new Set(pkg.weak_tags.map((w) => w.tag));

  function start(tier: string) {
    setFinish(null);
    setResults({});
    setIdx(0);
    setRepairQ(null);
    setRepairDone(false);
    setRepairOrigin(null);
    setVariantQ(null);
    setVariantDone(false);
    setChoice(null);
    setText('');
    api.createAttempt(n.id, tier).then((r) => {
      setAttempt({ id: r.attempt_id, tier, questions: r.questions });
    }).catch((e) => {
      toast(apiMessage(e, '无法开始测验'), true);
    });
  }

  function resetInput() { setChoice(null); setText(''); }

  async function fetchVariant(originId: number) {
    if (!attempt) return;
    try {
      const r = await api.createVariant(attempt.id, originId);
      setVariantQ(r.variant);
    } catch {
      toast('变式题生成失败，跳过检验', true);
      setVariantDone(true); // 跳过变式，不阻塞主流程
    }
  }

  async function submit(q: Question, userAnswer: unknown, isRepair: boolean, isVariant = false) {
    if (!attempt) return;
    let target = q;
    if (isVariant && variantQ) target = variantQ;
    setQState('grading');
    try {
      const r = await api.submitAnswer(attempt.id, {
        question_id: target.id, user_answer: userAnswer, is_repair: isRepair || isVariant,
      });
      setQState('answered');
      if (isVariant) {
        if (r.correct) {
          setVariantDone(true);
          setVariantQ(null);
          toast('变式题通过，真正掌握了 🎯');
        } else {
          setVariantQ(null);
          setVariantDone(false);
          setRepairQ(r.repair_question);
          toast('变式题未通过，回到基础补题', true);
        }
        return;
      }
      if (isRepair) {
        if (r.correct) {
          setRepairDone(true);
          setRepairQ(null);
          if (repairOrigin !== null) await fetchVariant(repairOrigin);
        } else { setRepairQ(r.repair_question); toast('仍未答对，继续练同考点题', true); }
        return;
      }
      setResults((prev) => ({ ...prev, [q.id]: { ...r, userAnswer } }));
      if (!r.correct) {
        setRepairQ(r.repair_question);
        setRepairOrigin(q.id);
        setRepairDone(false);
      }
    } catch {
      setQState('answering');
      toast('判分请求失败，请重试', true);
    }
  }

  function next() {
    if (!attempt) return;
    resetInput();
    setRepairQ(null);
    setRepairDone(false);
    setRepairOrigin(null);
    setVariantQ(null);
    setVariantDone(false);
    setQState('answering');
    setIdx((i) => i + 1);
  }

  async function doFinish() {
    if (!attempt) return;
    const r = await api.finishAttempt(attempt.id);
    setFinish(r);
    reload();
  }

  // ---- 档位选择（未开测）----
  if (!attempt) {
    return (
      <div className="card fade-in">
        {pkg.weak_tags.length > 0 && (
          <div className="weak-banner">
            ⚠ 检测到薄弱知识点：{pkg.weak_tags.map((w) => `${w.tag}（已错 ${w.wrong_count} 次）`).join('、')}
            ，建议先重学讲义再测验。
          </div>
        )}
        <div style={{ display: 'flex', gap: 14 }}>
          <TierCard title="概念记忆档" desc="选择 + 填空 · 考「是什么」" done={n.concept_done}
            disabled={!ready} onClick={() => start('concept')} />
          <TierCard title="基础理解档" desc="选择 + 填空 + 简答 · 考「为什么」" done={n.basic_done}
            locked={!n.concept_done}
            disabled={!ready || !n.concept_done} onClick={() => start('basic')} />
        </div>
        <div className="hint" style={{ marginTop: 12 }}>
          通过线：正确率 ≥ 85%。概念档通过后解锁理解档；理解档通过即<b>节点通过</b>，解锁后继知识点。
          {n.basic_done && <b>（本节点已通过，可任意重测）</b>}
        </div>
      </div>
    );
  }

  // ---- 结算面板 ----
  if (finish) {
    return (
      <div className="card">
        <div className="result-panel">
          <div className="emoji">{finish.passed ? '🎉' : '💪'}</div>
          <h3>{finish.passed
            ? (finish.tier === 'concept' ? '概念记忆档通过！' : '节点通过！')
            : '差一点点，再试一次'}</h3>
          <div className="acc">{Math.round(finish.accuracy * 100)}%</div>
          <div className="sub">
            答对 {finish.correct}/{finish.total} · 通过线 85%
            {finish.node_passed && finish.unlocked_nodes.length > 0 && <> · 已解锁 {finish.unlocked_nodes.length} 个后继节点 🎊</>}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button className="btn ghost" onClick={() => setAttempt(null)}>再测一次</button>
            {finish.node_passed && <button className="btn" onClick={() => window.history.back()}>返回路线图 →</button>}
          </div>
        </div>
      </div>
    );
  }

  // ---- 答题中 ----
  const q = attempt.questions[idx];
  const allAnswered = Object.keys(results).length >= attempt.questions.length;
  if (!q || allAnswered) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 30 }}>
        <div style={{ fontSize: 40 }}>📋</div>
        <div style={{ fontWeight: 700, margin: '6px 0 16px' }}>本档题目已完成</div>
        <button className="btn" onClick={doFinish}>交卷结算</button>
      </div>
    );
  }

  const r = results[q.id];

  return (
    <div className="card fade-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        {attempt.questions.map((_, i) => (
          <span key={i} className="dot-step" data-on={i <= idx} />
        ))}
        <span style={{ fontSize: 13, color: 'var(--ink-2)', marginLeft: 6 }}>
          第 {idx + 1}/{attempt.questions.length} 题 · {attempt.tier === 'concept' ? '概念记忆' : '基础理解'}
        </span>
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4, whiteSpace: 'pre-wrap' }}>
        <Markdown>{q.stem}</Markdown>
      </div>
      <div style={{ marginBottom: 12 }}>
        {q.kp_tags.map((k) => (
          <span key={k} className={`kp-chip ${weakSet.has(k) ? 'weak' : ''}`}>{k}</span>
        ))}
      </div>

      {q.qtype === 'choice' && (
        <div>
          {q.options.map((opt, i) => {
            let cls = 'option';
            if (qState === 'answering') { if (choice === i) cls += ' selected'; }
            else if (r) {
              if (i === (r.userAnswer as number)) cls += r.correct ? ' right' : ' wrong';
              if (i !== (r.userAnswer as number) && opt === r.std_answer) cls += ' right';
            }
            return (
              <div key={i} className={cls} onClick={() => qState === 'answering' && setChoice(i)}>
                <span className="key">{'ABCD'[i]}</span>
                <span>{opt}</span>
                {qState !== 'answering' && r && (i === (r.userAnswer as number)) && (
                  <span className="mark">{r.correct ? '✓' : '✗'}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {q.qtype === 'blank' && (
        <div className="field">
          <input value={text} disabled={qState !== 'answering'} onChange={(e) => setText(e.target.value)}
            placeholder="输入答案…" onKeyDown={(e) => e.key === 'Enter' && text && submit(q, text, false)}
            style={{ maxWidth: 320 }} />
        </div>
      )}

      {q.qtype === 'short' && (
        <div className="field">
          <textarea rows={3} value={text} disabled={qState !== 'answering'}
            onChange={(e) => setText(e.target.value)} placeholder="用一两句话作答…" />
        </div>
      )}

      {qState === 'answering' && (
        <button className="btn" disabled={q.qtype === 'choice' ? choice === null : !text.trim()}
          onClick={() => submit(q, q.qtype === 'choice' ? choice : text, false)}>
          {q.qtype === 'short' ? '提交作答（AI 判分）' : '提交答案'}
        </button>
      )}
      {qState === 'grading' && (
        <button className="btn" disabled><span className="spinner" /> {q.qtype === 'short' ? 'AI 正在核对关键点…' : '判分中…'}</button>
      )}

      {r && (
        <div className={`feedback ${r.correct ? 'ok' : 'bad'}`}>
          <b>{r.correct ? '✓ 回答正确' : '✗ 回答错误'}</b>
          {r.reason && <div style={{ marginTop: 4 }}>{r.reason}</div>}
          {r.hits !== undefined && r.misses !== undefined && (
            <div style={{ marginTop: 6, fontSize: 13 }}>
              命中关键点：{r.hits.length ? r.hits.join('、') : '无'}；
              未命中：{r.misses.length ? r.misses.join('、') : '无'}
            </div>
          )}
          {!r.correct && <div className="std">正确答案：{r.std_answer}</div>}
        </div>
      )}

      {repairQ && (
        <div style={{ marginTop: 14, border: '1.5px dashed var(--amber)', background: 'var(--amber-bg)', borderRadius: 10, padding: 14 }} className="fade-in">
          <div style={{ fontWeight: 700, color: 'var(--amber)', marginBottom: 8 }}>
            🔁 补题 · 同考点基础题（答对后进入变式检验）
          </div>
          <div style={{ fontWeight: 600, marginBottom: 8, whiteSpace: 'pre-wrap' }}>
            <Markdown>{repairQ.stem}</Markdown>
          </div>
          {repairQ.qtype === 'choice' ? (
            <div>
              {repairQ.options.map((opt, i) => (
                <div key={i} className="option" onClick={() => submit(repairQ, i, true)}>
                  <span className="key">{'ABCD'[i]}</span><span>{opt}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="repair-input" placeholder="输入答案…" onKeyDown={(e) => {
                if (e.key === 'Enter' && e.currentTarget.value) submit(repairQ, e.currentTarget.value, true);
              }} style={{ flex: 1, border: '1.5px solid var(--line)', borderRadius: 9, padding: '8px 12px' }} />
              <button className="btn small" onClick={(e) => {
                const input = (e.currentTarget.previousSibling as HTMLInputElement);
                if (input.value.trim()) submit(repairQ, input.value, true);
              }}>提交</button>
            </div>
          )}
        </div>
      )}
      {variantQ && (
        <div className="variant-card fade-in">
          <div className="vt">🎯 变式题检验 · 同考点换情境（防背题）</div>
          <div style={{ fontWeight: 600, marginBottom: 8, whiteSpace: 'pre-wrap' }}>
            <Markdown>{variantQ.stem}</Markdown>
          </div>
          {variantQ.qtype === 'choice' ? (
            <div>
              {variantQ.options.map((opt, i) => (
                <div key={i} className="option" onClick={() => submit(variantQ, i, true, true)}>
                  <span className="key">{'ABCD'[i]}</span><span>{opt}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input placeholder="输入答案…" onKeyDown={(e) => {
                if (e.key === 'Enter' && e.currentTarget.value) submit(variantQ, e.currentTarget.value, true, true);
              }} style={{ flex: 1, border: '1.5px solid var(--line)', borderRadius: 9, padding: '8px 12px' }} />
              <button className="btn small" onClick={(e) => {
                const input = (e.currentTarget.previousSibling as HTMLInputElement);
                if (input.value.trim()) submit(variantQ, input.value, true, true);
              }}>提交</button>
            </div>
          )}
        </div>
      )}
      {repairDone && !variantQ && !variantDone && (
        <div className="feedback ok" style={{ marginTop: 10 }}>✓ 补题通过</div>
      )}
      {variantDone && (
        <div className="feedback ok" style={{ marginTop: 10 }}>🎯 变式检验通过，继续下一题</div>
      )}

      {(r || variantDone || (repairDone && !repairOrigin)) && !repairQ && !variantQ && (
        <button className="btn" style={{ marginTop: 10 }} onClick={next}>
          {idx + 1 >= attempt.questions.length ? '完成本档 →' : '下一题 →'}
        </button>
      )}
    </div>
  );
}

function TierCard({ title, desc, done, locked, disabled, onClick }: {
  title: string; desc: string; done: boolean; locked?: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <div style={{
      flex: 1, border: `1.5px solid ${locked ? 'var(--line)' : 'var(--green-500)'}`,
      borderRadius: 12, padding: '16px 18px', background: locked ? '#f8fafc' : 'var(--green-50)',
      opacity: disabled ? 0.6 : 1,
    }}>
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>
        {locked && '🔒 '}{title} {done && <span className="badge">已通过</span>}
      </div>
      <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 12 }}>{desc}</div>
      <button className="btn small" disabled={disabled} onClick={onClick}>
        {done ? '重新测验' : '开始测验'}
      </button>
      {locked && <div className="hint">需先通过概念记忆档（≥85%）</div>}
    </div>
  );
}

/* ================= Practice ================= */

function PracticePanel({ pkg }: { pkg: PackageData }) {
  const [checked, setChecked] = useState<boolean[]>([]);
  const p = pkg.practice;
  useEffect(() => {
    setChecked(p?.checklist?.map(() => false) ?? []);
  }, [pkg.node.id, p?.checklist?.length]);

  if (!p || !p.checklist) return <div className="card empty">实践任务未就绪（内容生成中或生成失败）</div>;
  const doneCount = checked.filter(Boolean).length;

  return (
    <div className="card fade-in">
      <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--green-700)' }}>🛠 {p.goal}</div>
      <div className="hint" style={{ margin: '4px 0 16px' }}>
        实践任务不判分、不阻塞节点通过——自己动手实现，用清单自查。
      </div>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>任务要求</div>
      <ul style={{ margin: '0 0 16px', paddingLeft: 22 }}>
        {p.requirements.map((r, i) => <li key={i}>{r}</li>)}
      </ul>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>自查清单（{doneCount}/{checked.length}）</div>
      {p.checklist.map((c, i) => (
        <label key={i} style={{
          display: 'flex', gap: 10, alignItems: 'center', padding: '9px 12px',
          border: '1.5px solid var(--line)', borderRadius: 10, marginBottom: 8, cursor: 'pointer',
          background: checked[i] ? 'var(--green-50)' : '#fdfffe', transition: 'all 0.15s',
        }}>
          <input type="checkbox" checked={!!checked[i]} onChange={() => {
            setChecked((prev) => prev.map((v, j) => (j === i ? !v : v)));
          }} style={{ width: 17, height: 17, accentColor: 'var(--green-600)' }} />
          <span style={{ textDecoration: checked[i] ? 'line-through' : 'none', opacity: checked[i] ? 0.7 : 1 }}>{c}</span>
        </label>
      ))}
      {doneCount === checked.length && checked.length > 0 && (
        <div className="feedback ok">🎉 全部自查通过！动手实践是掌握的关键。</div>
      )}
    </div>
  );
}
