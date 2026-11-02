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

export type EvalRunStatus =
  | 'TRACKED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'UNKNOWN';

export interface EvalRun {
  agent: string;
  runName: string;
  configPath: string;
  label?: string;
  startedAt: string;
  checkedAt?: string;
  status: EvalRunStatus;
  startedFromApp?: boolean;
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
    const response = await fetch(`${config.backendUrl}${path}`, init);
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

export const listEvalRuns = async (agentName: string): Promise<EvalRun[]> => {
  const data = await request(`${agentPath(agentName)}/evals/runs`);
  return data.data || [];
};

export const startEvalRun = async (
  agentName: string,
  body: { runName: string; configPath: string; label?: string; start?: boolean }
): Promise<EvalRun> => {
  const data = await request(`${agentPath(agentName)}/evals/runs`, jsonInit('POST', body));
  return data.run;
};

export const untrackEvalRun = (agentName: string, runName: string): Promise<{ removed: boolean }> =>
  request(`${agentPath(agentName)}/evals/runs/${encodeURIComponent(runName)}`, jsonInit('DELETE'));

export const fetchEvalRunStatus = (
  agentName: string,
  runName: string
): Promise<{ status: EvalRunStatus; rows: Record<string, unknown>[] }> =>
  request(`${agentPath(agentName)}/evals/runs/${encodeURIComponent(runName)}/status`);

export const fetchEvalRunResults = (agentName: string, runName: string): Promise<EvalRunResults> =>
  request(`${agentPath(agentName)}/evals/runs/${encodeURIComponent(runName)}`);

export const fetchEvalRunLogs = async (agentName: string, runName: string): Promise<Record<string, unknown>[]> => {
  const data = await request(`${agentPath(agentName)}/evals/runs/${encodeURIComponent(runName)}/logs`);
  return data.data || [];
};

export const fetchEvalRecordTrace = async (agentName: string, recordId: string): Promise<Record<string, unknown>[]> => {
  const data = await request(`${agentPath(agentName)}/evals/records/${encodeURIComponent(recordId)}/trace`);
  return data.data || [];
};
