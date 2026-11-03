/**
 * Snowflake Cortex Agent Evals & Feedback API Service
 *
 * Frontend calls our secure backend proxy. Feedback is submitted through the
 * agents/{name}:feedback REST endpoint; reading feedback and eval runs goes
 * through the Snowflake SQL API on the server. PAT never leaves the server.
 *
 * Reference: cortex_agent_evals_and_feedback.md
 */

import { config } from '../config/env';
import { ERROR_TEXT } from '../constants/textConstants';
import { apiHeaders } from './runAsApi';

export interface FeedbackPayload {
  positive: boolean;
  feedback_message?: string;
  categories?: string[];
  orig_request_id?: string;
  thread_id?: number;
}

export interface FeedbackEvent {
  timestamp: string | null;
  positive: boolean | null;
  feedback_message: string | null;
  categories: string[];
  user: string | null;
  request_id: string | null;
  thread_id: string | number | null;
  raw: Record<string, unknown>;
}

/** What an eval run evaluates: a Cortex Agent, or a semantic view (Cortex Analyst). */
export type EvalKind = 'agent' | 'analyst';

/**
 * Status as reported by EXECUTE_AI_EVALUATION('STATUS'), plus two of our own: TRACKED
 * (registered but never checked) and RUNNING (started from the app, not yet polled).
 */
export type EvalRunStatus =
  | 'TRACKED'
  | 'RUNNING'
  | 'CREATED'
  | 'INVOCATION_IN_PROGRESS'
  | 'INVOCATION_COMPLETED'
  | 'INVOCATION_PARTIALLY_COMPLETED'
  | 'COMPUTATION_IN_PROGRESS'
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
  | 'CANCELLED'
  | 'UNKNOWN';

/** Statuses where results exist and nothing more will change. */
export const FINISHED_STATUSES: EvalRunStatus[] = ['COMPLETED', 'PARTIALLY_COMPLETED', 'CANCELLED'];

/** Statuses worth polling: the run is, or may still be, in progress. */
export const IN_PROGRESS_STATUSES: EvalRunStatus[] = [
  'RUNNING',
  'CREATED',
  'INVOCATION_IN_PROGRESS',
  'INVOCATION_COMPLETED',
  'INVOCATION_PARTIALLY_COMPLETED',
  'COMPUTATION_IN_PROGRESS'
];

export interface EvalRun {
  kind: EvalKind;
  /** Agent name or semantic view name */
  target: string;
  runName: string;
  configPath: string;
  label?: string;
  metricVersion?: string;
  startedAt: string;
  checkedAt?: string;
  status: EvalRunStatus;
  startedFromApp?: boolean;
}

/** Config the backend should generate (semantic view runs only). */
export interface GenerateEvalConfig {
  /** Stage to write to, e.g. @MY_DB.MY_SCHEMA.EVAL_CONFIGS. The file is <stage>/<runName>.yaml */
  stage: string;
  metricVersion?: string;
  /** Verified-query question texts to evaluate. Empty = all of them. */
  questions?: string[];
}

export interface EvalMetricSummary {
  metric: string;
  records: number;
  avgScore: number | null;
  minScore: number | null;
}

/** One row from GET_AI_EVALUATION_DATA (one question × one metric). Column set varies by account. */
export interface EvalRecord {
  RECORD_ID?: string;
  INPUT?: unknown;
  OUTPUT?: unknown;
  GROUND_TRUTH?: unknown;
  METRIC_NAME?: string;
  EVAL_AGG_SCORE?: number | null;
  [key: string]: unknown;
}

export interface EvalRunResults {
  summary: EvalMetricSummary[];
  records: EvalRecord[];
}

const handleResponse = async (response: Response): Promise<any> => {
  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const errorJson = await response.json();
      const errorMessage = errorJson.errorParts
        ? errorJson.errorParts.join('\n\n')
        : (typeof errorJson.error === 'string'
            ? errorJson.error
            : (errorJson.error?.message || errorJson.message || JSON.stringify(errorJson, null, 2)));
      const error = new Error(errorMessage);
      (error as any).fullMessage = errorMessage;
      throw error;
    }
    const errorMessage = `${ERROR_TEXT.ERROR_PREFIX}\n${ERROR_TEXT.HTTP_ERROR_STATUS} ${response.status} ${response.statusText}`;
    const error = new Error(errorMessage);
    (error as any).fullMessage = errorMessage;
    throw error;
  }
  return response.json();
};

const connectionError = (): Error => {
  const errorMessage =
    `${ERROR_TEXT.ERROR_PREFIX}\n\nFailed to connect to the backend server.\n\n` +
    `💡 Tip: The backend server at ${config.backendUrl} is not running or not accessible.`;
  const error = new Error(errorMessage);
  (error as any).fullMessage = errorMessage;
  return error;
};

const request = async (path: string, init?: RequestInit): Promise<any> => {
  try {
    const response = await fetch(`${config.backendUrl}${path}`, {
      ...init,
      headers: { ...apiHeaders(), ...((init && init.headers) as Record<string, string> | undefined) },
    });
    return await handleResponse(response);
  } catch (error: any) {
    if (error.fullMessage) throw error;
    throw connectionError();
  }
};

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const agentPath = (agentName: string) => `/api/agents/${encodeURIComponent(agentName)}`;

// ---- Feedback ---------------------------------------------------------------

// Sent as the role that produced the answer (apiHeaders carries it); that role needs USAGE on the agent.
export const submitAgentFeedback = (agentName: string, payload: FeedbackPayload): Promise<{ status?: string }> =>
  request(`${agentPath(agentName)}/feedback`, jsonInit('POST', payload));

export const fetchAgentFeedback = async (
  agentName: string,
  params: { since?: string; until?: string } = {}
): Promise<FeedbackEvent[]> => {
  const qs = new URLSearchParams();
  if (params.since) qs.set('since', params.since);
  if (params.until) qs.set('until', params.until);
  const query = qs.toString();
  const data = await request(`${agentPath(agentName)}/feedback${query ? `?${query}` : ''}`);
  return data.data || [];
};

// ---- Eval runs --------------------------------------------------------------

const evalBase = (kind: EvalKind, target: string) =>
  kind === 'agent'
    ? `${agentPath(target)}/evals`
    : `/api/semantic-views/${encodeURIComponent(target)}/evals`;

export const listEvalRuns = async (kind: EvalKind, target: string): Promise<EvalRun[]> => {
  const data = await request(`${evalBase(kind, target)}/runs`);
  return data.data || [];
};

export const startEvalRun = async (
  kind: EvalKind,
  target: string,
  body: { runName: string; configPath?: string; label?: string; start?: boolean; generate?: GenerateEvalConfig }
): Promise<{ run: EvalRun; config?: string }> =>
  request(`${evalBase(kind, target)}/runs`, jsonInit('POST', body));

export const untrackEvalRun = (kind: EvalKind, target: string, runName: string): Promise<{ removed: boolean }> =>
  request(`${evalBase(kind, target)}/runs/${encodeURIComponent(runName)}`, jsonInit('DELETE'));

export const fetchEvalRunStatus = (
  kind: EvalKind,
  target: string,
  runName: string
): Promise<{ status: EvalRunStatus; statusDetails: string[]; rows: Record<string, unknown>[] }> =>
  request(`${evalBase(kind, target)}/runs/${encodeURIComponent(runName)}/status`);

export const cancelEvalRun = (kind: EvalKind, target: string, runName: string): Promise<unknown> =>
  request(`${evalBase(kind, target)}/runs/${encodeURIComponent(runName)}/cancel`, jsonInit('POST'));

export const fetchEvalRunResults = (kind: EvalKind, target: string, runName: string): Promise<EvalRunResults> =>
  request(`${evalBase(kind, target)}/runs/${encodeURIComponent(runName)}`);

// Run logs and record traces exist for agent evals only.
export const fetchEvalRunLogs = async (agentName: string, runName: string): Promise<Record<string, unknown>[]> => {
  const data = await request(`${evalBase('agent', agentName)}/runs/${encodeURIComponent(runName)}/logs`);
  return data.data || [];
};

export const fetchEvalRecordTrace = async (agentName: string, recordId: string): Promise<Record<string, unknown>[]> => {
  const data = await request(`${evalBase('agent', agentName)}/records/${encodeURIComponent(recordId)}/trace`);
  return data.data || [];
};
