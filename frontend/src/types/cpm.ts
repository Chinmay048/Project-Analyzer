export type InputMode = 'predecessors' | 'nodes' | 'auto';
export type TimeMode = 'duration' | 'pert';
export type VariancePolicy = 'max' | 'min' | 'first';
export type DanglingPolicy = 'connect' | 'error';

export interface ActivityIn {
  id?: string; // Client-side row key
  name?: string | number | null;
  description?: string | null;
  predecessors?: string[] | string | null;
  start_node?: number | null;
  end_node?: number | null;
  duration?: number | null;
  optimistic?: number | null;
  most_likely?: number | null;
  pessimistic?: number | null;
  normal_cost?: number | null;
  crash_cost?: number | null;
  crash_time?: number | null;
}

export interface SolveRequest {
  title?: string | null;
  mode: InputMode;
  activities: ActivityIn[];
  round_te?: boolean;
  variance_policy?: VariancePolicy;
  target_time?: number | null;
  target_delta?: number | null;
  target_probability?: number | null;
  renumber?: boolean | null;
  dangling_policy?: DanglingPolicy;
  strict_estimates?: boolean;
  crash_target?: number | null;
}

export interface GraphNode {
  id: number;
  x: number;
  y: number;
  E: number | null;
  L: number | null;
  slack: number | null;
}

export interface GraphEdge {
  id: number;
  name: string;
  from_: number;
  to: number;
  dummy: boolean;
  critical: boolean;
  duration: number | null;
  path: string;
  label_x: number;
  label_y: number;
}

export interface NetworkGraph {
  width: number;
  height: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  svg: string;
}

export interface StepTable {
  headers: string[];
  rows: (string | number)[][];
}

export interface SolutionStep {
  n: number;
  title: string;
  lines: string[];
  table?: StepTable | null;
}

export interface CriticalPath {
  nodes: number[];
  activities: string[];
  label: string;
  with_dummies: string;
  length: number;
}

export interface PertQuery {
  label: string;
  target_time: number;
  z: number | null;
  z_table?: number | null;
  p_le: number;
  p_ge: number;
  p_le_table?: number | null;
  p_ge_table?: number | null;
}

export interface PertAnalysis {
  expected_duration: number;
  variance: number;
  std_dev: number;
  path_variances: Array<{ path: string; variance: number }>;
  policy: string;
  queries: PertQuery[];
}

export interface CrashSlope {
  activity: string;
  normal_time?: number;
  crash_time?: number;
  normal_cost?: number;
  crash_cost?: number;
  slope: number;
}

export interface CrashIteration {
  step: number;
  crashed: string[];
  by: number;
  duration_before: number;
  duration_after: number;
  cost: number;
}

export interface CrashingResult {
  feasible: boolean;
  message: string;
  iterations: CrashIteration[];
  slopes: CrashSlope[];
  final_duration: number;
  crash_cost: number;
  durations?: Record<string, number>;
}

export interface ScheduledActivity {
  name: string;
  dummy: boolean;
  description?: string | null;
  i: number;
  j: number;
  predecessors?: string[];
  duration?: number | null;
  ES?: number | null;
  EF?: number | null;
  LS?: number | null;
  LF?: number | null;
  total_float?: number | null;
  free_float?: number | null;
  interfering_float?: number | null;
  critical?: boolean;
  optimistic?: number | null;
  most_likely?: number | null;
  pessimistic?: number | null;
  te_raw?: number | null;
  variance?: number | null;
}

export interface EventSummary {
  id: number;
  E: number;
  L: number;
  slack: number;
}

export interface SummaryInfo {
  project_duration?: number | null;
  critical_path_count?: number;
  events: number;
  activities: number;
  dummies: number;
}

export interface SolveResponse {
  title?: string | null;
  mode: 'predecessors' | 'nodes';
  timed: boolean;
  warnings: string[];
  summary: SummaryInfo;
  activities: ScheduledActivity[];
  critical_paths: CriticalPath[];
  pert_analysis: PertAnalysis | null;
  crashing: CrashingResult | null;
  graph: NetworkGraph;
  events?: EventSummary[];
  steps: SolutionStep[];
}

export interface APIErrorDetail {
  code: string;
  message: string;
  details?: any;
}

export interface APIErrorResponse {
  error: APIErrorDetail;
}

export interface HealthResponse {
  status: string;
  vision_key_configured: boolean;
  gemini?: boolean;
  anthropic?: boolean;
  has_access_key?: boolean;
}

export interface ExtractedProblem {
  title?: string | null;
  mode: 'predecessors' | 'nodes';
  activities: ActivityIn[];
  round_te?: boolean;
  target_time?: number | null;
  target_delta?: number | null;
  target_probability?: number | null;
  crash_target?: number | null;
  notes?: string[];
}

export interface SolveImageResponse {
  extracted: ExtractedProblem;
  notes: string[];
  result: SolveResponse | null;
  error: APIErrorDetail | null;
}

export type SampleQuestions = Record<string, Partial<SolveRequest>>;
