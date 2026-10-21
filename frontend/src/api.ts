import type {
  ExtractedProblem,
  HealthResponse,
  SampleQuestions,
  SolveImageResponse,
  SolveRequest,
  SolveResponse,
  APIErrorDetail,
} from './types/cpm';

const DEFAULT_BASE_URL = import.meta.env.VITE_API_URL || '';

export class ApiError extends Error {
  code: string;
  details?: any;
  status?: number;

  constructor(code: string, message: string, details?: any, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export function cleanSolveRequest(req: SolveRequest): SolveRequest {
  const cleanNum = (v: any, fieldName?: string): number | null => {
    if (v === '' || v === undefined || v === null) return null;
    if (typeof v === 'boolean') {
      throw new ApiError('invalid_number', `Invalid value for ${fieldName || 'number'}: boolean not allowed.`);
    }
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed === '') return null;
      const normalized = trimmed.replace(',', '.');
      const n = Number(normalized);
      if (isNaN(n)) {
        throw new ApiError('invalid_number', `Invalid numeric value "${v}" for ${fieldName || 'field'}.`);
      }
      return n;
    }
    const n = Number(v);
    if (isNaN(n)) {
      throw new ApiError('invalid_number', `Invalid numeric value for ${fieldName || 'field'}.`);
    }
    return n;
  };

  const isPredecessorsMode = req.mode === 'predecessors';
  const isNodesMode = req.mode === 'nodes';

  const cleanActs = (req.activities || []).map((act, idx) => {
    const clean: any = {};
    const actLabel = act.name ? `Activity ${act.name}` : `Activity #${idx + 1}`;
    if (act.name !== undefined && act.name !== null && String(act.name).trim() !== '') {
      clean.name = String(act.name).trim();
    }
    if (act.description) clean.description = act.description.trim();

    if (!isNodesMode && act.predecessors !== undefined && act.predecessors !== null) {
      if (Array.isArray(act.predecessors)) {
        clean.predecessors = act.predecessors.map((p) => String(p).trim()).filter(Boolean);
      } else if (typeof act.predecessors === 'string') {
        const parts = act.predecessors
          .split(/[,;]+/)
          .map((p) => p.trim())
          .filter(Boolean);
        clean.predecessors = parts;
      }
    }

    if (!isPredecessorsMode) {
      const i = cleanNum(act.start_node, `${actLabel} start_node`);
      if (i !== null) clean.start_node = i;
      const j = cleanNum(act.end_node, `${actLabel} end_node`);
      if (j !== null) clean.end_node = j;
    }

    const dur = cleanNum(act.duration, `${actLabel} duration`);
    const opt = cleanNum(act.optimistic, `${actLabel} optimistic`);
    const ml = cleanNum(act.most_likely, `${actLabel} most_likely`);
    const pess = cleanNum(act.pessimistic, `${actLabel} pessimistic`);

    const hasPertTrio = opt !== null && ml !== null && pess !== null;

    if (hasPertTrio) {
      clean.optimistic = opt;
      clean.most_likely = ml;
      clean.pessimistic = pess;
    } else if (dur !== null) {
      clean.duration = dur;
    } else {
      if (opt !== null) clean.optimistic = opt;
      if (ml !== null) clean.most_likely = ml;
      if (pess !== null) clean.pessimistic = pess;
    }

    const ncost = cleanNum(act.normal_cost, `${actLabel} normal_cost`);
    if (ncost !== null) clean.normal_cost = ncost;

    const ccost = cleanNum(act.crash_cost, `${actLabel} crash_cost`);
    if (ccost !== null) clean.crash_cost = ccost;

    const ctime = cleanNum(act.crash_time, `${actLabel} crash_time`);
    if (ctime !== null) clean.crash_time = ctime;

    return clean;
  });

  const payload: any = {
    mode: req.mode || 'auto',
    activities: cleanActs,
  };

  if (req.title) payload.title = req.title;
  if (req.round_te) payload.round_te = true;
  if (req.variance_policy) payload.variance_policy = req.variance_policy;
  if (req.target_time !== undefined && cleanNum(req.target_time) !== null) {
    payload.target_time = cleanNum(req.target_time);
  }
  if (req.target_delta !== undefined && cleanNum(req.target_delta) !== null) {
    payload.target_delta = cleanNum(req.target_delta);
  }
  if (req.target_probability !== undefined && cleanNum(req.target_probability) !== null) {
    payload.target_probability = cleanNum(req.target_probability);
  }
  if (req.renumber !== undefined && req.renumber !== null) {
    payload.renumber = Boolean(req.renumber);
  }
  if (req.dangling_policy) payload.dangling_policy = req.dangling_policy;
  if (req.strict_estimates) payload.strict_estimates = true;
  if (req.crash_target !== undefined && cleanNum(req.crash_target) !== null) {
    payload.crash_target = cleanNum(req.crash_target);
  }

  return payload;
}

async function handleResponse<T>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  let data: any = null;

  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    data = await res.text();
  }

  if (!res.ok) {
    if (data && typeof data === 'object' && data.error) {
      const err = data.error as APIErrorDetail;
      throw new ApiError(err.code || 'error', err.message || 'Server returned an error', err.details, res.status);
    }
    throw new ApiError('http_error', `HTTP ${res.status}: ${res.statusText}`, data, res.status);
  }

  return data as T;
}

export function buildHeaders(accessKey?: string, anthropicKey?: string): HeadersInit {
  const headers: Record<string, string> = {};
  if (accessKey && accessKey.trim()) {
    headers['X-Access-Key'] = accessKey.trim();
  }
  if (anthropicKey && anthropicKey.trim()) {
    headers['X-Anthropic-Key'] = anthropicKey.trim();
  }
  return headers;
}

export async function getHealth(baseUrl = DEFAULT_BASE_URL): Promise<HealthResponse> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/health`);
  return handleResponse<HealthResponse>(res);
}

export async function getSamples(
  baseUrl = DEFAULT_BASE_URL,
  accessKey?: string
): Promise<SampleQuestions> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/samples`, {
    headers: buildHeaders(accessKey),
  });
  return handleResponse<SampleQuestions>(res);
}

export async function solve(
  req: SolveRequest,
  baseUrl = DEFAULT_BASE_URL,
  accessKey?: string,
  signal?: AbortSignal
): Promise<SolveResponse> {
  const cleaned = cleanSolveRequest(req);
  const headers = {
    ...buildHeaders(accessKey),
    'Content-Type': 'application/json',
  };

  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/solve`, {
    method: 'POST',
    headers,
    body: JSON.stringify(cleaned),
    signal,
  });

  return handleResponse<SolveResponse>(res);
}

export async function extract(
  file: File,
  anthropicKey?: string,
  baseUrl = DEFAULT_BASE_URL,
  accessKey?: string,
  signal?: AbortSignal
): Promise<ExtractedProblem> {
  const formData = new FormData();
  formData.append('file', file);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s timeout

  const combinedSignal = signal || controller.signal;

  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/extract`, {
      method: 'POST',
      headers: buildHeaders(accessKey, anthropicKey),
      body: formData,
      signal: combinedSignal,
    });
    clearTimeout(timeoutId);
    return await handleResponse<ExtractedProblem>(res);
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new ApiError('timeout', 'Image extraction timed out after 90 seconds. Please try again or use a clearer crop.', null, 408);
    }
    throw err;
  }
}

export async function solveImage(
  file: File,
  anthropicKey?: string,
  baseUrl = DEFAULT_BASE_URL,
  accessKey?: string,
  signal?: AbortSignal
): Promise<SolveImageResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s timeout
  const combinedSignal = signal || controller.signal;

  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/solve-image`, {
      method: 'POST',
      headers: buildHeaders(accessKey, anthropicKey),
      body: formData,
      signal: combinedSignal,
    });
    clearTimeout(timeoutId);
    return await handleResponse<SolveImageResponse>(res);
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new ApiError('timeout', 'Vision solve timed out after 90 seconds. Please try again.', null, 408);
    }
    throw err;
  }
}
