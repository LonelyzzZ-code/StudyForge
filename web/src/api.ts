import type { SseEvent } from './types';

export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(status: number, payload: unknown) {
    super(`API ${status}`);
    this.status = status;
    this.payload = payload;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!resp.ok) {
    let payload: unknown = null;
    try { payload = await resp.json(); } catch { /* non-json error body */ }
    throw new ApiError(resp.status, payload);
  }
  return resp.json() as Promise<T>;
}

export const api = {
  getSettings: () => request<import('./types').SettingsData>('/settings'),
  putSettings: (body: unknown) =>
    request<{ ok: boolean }>('/settings', { method: 'PUT', body: JSON.stringify(body) }),
  testRole: (role: string) =>
    request<{ ok: boolean; error?: string }>('/settings/test', { method: 'POST', body: JSON.stringify({ role }) }),

  createRoadmap: (body: { goal: string; base?: string; outcome?: string; time_budget?: string }) =>
    request<{ id: number; status: string }>('/roadmaps', { method: 'POST', body: JSON.stringify(body) }),
  listRoadmaps: () => request<import('./types').RoadmapListItem[]>('/roadmaps'),
  getRoadmap: (id: number) => request<import('./types').RoadmapDetail>(`/roadmaps/${id}`),
  deleteRoadmap: (id: number) => request<{ ok: boolean }>(`/roadmaps/${id}`, { method: 'DELETE' }),
  masterNode: (rid: number, nid: number) =>
    request<{ ok: boolean; unlocked_nodes: number[] }>(`/roadmaps/${rid}/nodes/${nid}/master`, { method: 'POST' }),

  getPackage: (nid: number) => request<import('./types').PackageData>(`/nodes/${nid}/package`),
  createAttempt: (nid: number, tier: string) =>
    request<{ attempt_id: number; tier: string; questions: import('./types').Question[] }>(
      `/nodes/${nid}/attempts`, { method: 'POST', body: JSON.stringify({ tier }) }),
  submitAnswer: (aid: number, body: { question_id: number; user_answer: unknown; is_repair?: boolean }) =>
    request<import('./types').AnswerResult>(`/attempts/${aid}/answers`, {
      method: 'POST', body: JSON.stringify(body) }),
  finishAttempt: (aid: number) =>
    request<import('./types').FinishResult>(`/attempts/${aid}/finish`, { method: 'POST' }),

  // F3 手动调整
  nodeImpact: (rid: number, nid: number) =>
    request<import('./types').ImpactData>(`/roadmaps/${rid}/nodes/${nid}/impact`),
  deleteNode: (rid: number, nid: number) =>
    request<{ ok: boolean }>(`/roadmaps/${rid}/nodes/${nid}`, { method: 'DELETE' }),
  regenerateBranch: (rid: number, nid: number) =>
    request<{ ok: boolean; regenerated_nodes: number[] }>(
      `/roadmaps/${rid}/nodes/${nid}/regenerate-branch`, { method: 'POST' }),
  createVariant: (aid: number, questionId: number) =>
    request<{ variant: import('./types').Question & { is_variant?: boolean; variant_of?: number };
              origin_id: number }>(
      `/attempts/${aid}/variant`, { method: 'POST', body: JSON.stringify({ question_id: questionId }) }),

  // F4 P1 / F8
  regenerateSection: (nid: number, sectionIndex: number) =>
    request<{ section_index: number; title: string; version: number }>(
      `/nodes/${nid}/regenerate-section`, { method: 'POST', body: JSON.stringify({ section_index: sectionIndex }) }),
  roadmapCost: (rid: number) => request<import('./types').CostData>(`/roadmaps/${rid}/cost`),

  // F9 / F10
  getRadar: () => request<import('./types').TechRadarData>('/tech/radar'),
};

export async function chatAssistantStream(
  body: { node_id: number | null; question: string; history: { role: string; content: string }[] },
  onDelta: (text: string) => void,
): Promise<void> {
  const resp = await fetch('/api/assistant/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) throw new Error('问答服务不可用');
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      try { onDelta(JSON.parse(payload).delta as string); } catch { /* skip */ }
    }
  }
}

type Handler = (e: SseEvent) => void;

export function subscribeSse(handlers: Handler[]): () => void {
  const es = new EventSource('/api/stream');
  es.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data) as SseEvent;
      handlers.forEach((h) => h(event));
    } catch { /* ignore malformed */ }
  };
  return () => es.close();
}
