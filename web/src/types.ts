export interface RoleCfg {
  base_url: string;
  api_key: string;
  model: string;
}

export interface SettingsData {
  planner_cfg: RoleCfg;
  generator_cfg: RoleCfg;
  grader_cfg: RoleCfg;
  assistant_cfg?: RoleCfg;
  mock_mode: { planner: boolean; generator: boolean; grader: boolean; assistant: boolean };
}

export interface RoadmapNode {
  id: number;
  ext_key: string;
  title: string;
  summary: string;
  kp_list: string[];
  est_minutes: number;
  order_index: number;
  status: 'locked' | 'unlocked' | 'learning' | 'passed' | 'mastered';
  concept_done: boolean;
  basic_done: boolean;
  package_status: 'pending' | 'generating' | 'ready' | 'suspect' | 'failed';
}

export interface RoadmapDetail {
  id: number;
  goal: string;
  base: string;
  outcome: string;
  time_budget: string;
  domain: string;
  status: 'planning' | 'learning' | 'done' | 'failed';
  outline: { key: string; title: string; summary: string }[];
  nodes: RoadmapNode[];
  edges: { from: string; to: string }[];
  progress: { done: number; total: number; est_minutes_total: number };
}

export interface RoadmapListItem {
  id: number;
  goal: string;
  domain: string;
  status: string;
  created_at: string;
  total_nodes: number;
  done_nodes: number;
}

export interface Question {
  id: number;
  tier: 'concept' | 'basic';
  qtype: 'choice' | 'blank' | 'short';
  stem: string;
  options: string[];
  kp_tags: string[];
  skill: string;
  difficulty: number;
}

export interface PackageData {
  node: {
    id: number; title: string; summary: string; kp_list: string[];
    status: string; concept_done: boolean; basic_done: boolean;
  };
  package_status: 'pending' | 'generating' | 'ready' | 'suspect' | 'failed';
  lecture: { sections: { title: string; content: string }[] } | null;
  summary: string;
  practice: { goal: string; requirements: string[]; checklist: string[] } | null;
  weak_tags: { tag: string; wrong_count: number }[];
}

export interface AnswerResult {
  correct: boolean;
  is_repair: boolean;
  std_answer?: string;
  key_points?: string[];
  hits?: string[];
  misses?: string[];
  reason?: string;
  repair_question: Question | null;
  weak_tags: { tag: string; wrong_count: number }[];
}

export interface FinishResult {
  attempt_id: number;
  tier: 'concept' | 'basic';
  passed: boolean;
  accuracy: number;
  total: number;
  correct: number;
  node_passed: boolean;
  unlocked_nodes: number[];
}

export interface SseEvent {
  type: 'roadmap.ready' | 'roadmap.failed' | 'node.package' | 'node.status'
      | 'node.deleted' | 'roadmap.updated';
  roadmap_id: number;
  data: Record<string, unknown>;
}

export interface TechRadarItem {
  id: string;
  category: string;
  name: string;
  one_liner: string;
  why: string;
  for_whom: string;
  start_from: string;
  heat: number;
  preset_goal: string;
}

export interface TechRadarData {
  version: string;
  categories: string[];
  items: TechRadarItem[];
}

export interface CostData {
  roadmap_id: number;
  total_calls: number;
  total_tokens: number;
  total_latency_ms: number;
  breakdown: { role: string; purpose: string; calls: number; tokens: number; latency_ms: number }[];
}

export interface ImpactData {
  node: { id: number; title: string };
  rewires: { successor: { id: number; title: string };
             new_predecessors: { id: number; title: string }[] }[];
  has_successors: boolean;
  message: string;
}
